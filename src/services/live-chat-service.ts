import { randomBytes } from "node:crypto";
import {
  DomainError,
  type AuthUser,
  type LiveChatMessage,
  type LiveChatSession,
  type LiveChatStatus,
  type PatientTitle,
} from "../domain/types.js";
import type { Repositories } from "../repositories/ports.js";

/** Auto-close an open session this long after the patient's last event. */
export const CHAT_IDLE_CLOSE_MS = 3 * 60 * 1000;
/** Warn the patient this long after their last event (60s before close). */
export const CHAT_IDLE_WARN_MS = 2 * 60 * 1000;

/** Broadcast events; the WebSocket hub subscribes and fans them out. */
export type LiveChatEvent =
  | { type: "session_created"; session: LiveChatSession }
  | { type: "session_claimed"; session: LiveChatSession }
  | { type: "message"; session: LiveChatSession; message: LiveChatMessage }
  | { type: "idle_warning"; session: LiveChatSession; secondsLeft: number }
  | { type: "session_closed"; session: LiveChatSession };

export type LiveChatListener = (event: LiveChatEvent) => void;

export interface LiveChatRequestInput {
  patientTitle: PatientTitle;
  patientName: string;
  patientPhone: string;
  conversationSessionId?: string;
}

/**
 * Patient <-> staff live chat. Persistence in chat_sessions/chat_session_messages;
 * realtime delivery is the ChatHub's job (it subscribes to events here so REST
 * actions broadcast too). One staff user handles at most one active session
 * (service check + partial unique index).
 */
export class LiveChatService {
  private readonly listeners: LiveChatListener[] = [];
  /** Sessions already idle-warned since the patient's last event. */
  private readonly warned = new Set<number>();

  constructor(
    private readonly repos: Repositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  subscribe(listener: LiveChatListener): void {
    this.listeners.push(listener);
  }

  private emit(event: LiveChatEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Patient asks to talk to staff. Returns the secret key exactly once. */
  async requestChat(
    input: LiveChatRequestInput,
  ): Promise<{ session: LiveChatSession; patientKey: string }> {
    const patientKey = randomBytes(24).toString("hex");
    const session = await this.repos.liveChat.createSession({
      patientKey,
      conversationSessionId: input.conversationSessionId ?? null,
      patientTitle: input.patientTitle,
      patientName: input.patientName,
      patientPhone: input.patientPhone,
    });
    await this.repos.liveChat.touchPatient(session.id, this.now().toISOString());
    this.emit({ type: "session_created", session });
    return { session, patientKey };
  }

  /** Patient WebSocket auth: resolves the secret key to its session. */
  findByPatientKey(key: string): Promise<LiveChatSession | null> {
    return this.repos.liveChat.findByPatientKey(key);
  }

  async getSession(id: number): Promise<LiveChatSession> {
    const session = await this.repos.liveChat.findById(id);
    if (!session) throw new DomainError("NOT_FOUND", "Chat session not found");
    return session;
  }

  listSessions(opts?: { status?: LiveChatStatus }): Promise<LiveChatSession[]> {
    return this.repos.liveChat.listSessions(opts);
  }

  messages(sessionId: number): Promise<LiveChatMessage[]> {
    return this.repos.liveChat.messages(sessionId);
  }

  /**
   * Staff/admin takes a waiting session. Sends the connection template message
   * to the patient. Fails with STAFF_BUSY while the user already handles an
   * active session.
   */
  async claim(sessionId: number, user: AuthUser): Promise<LiveChatSession> {
    const session = await this.getSession(sessionId);
    if (session.status === "closed") {
      throw new DomainError("CHAT_CLOSED", "This chat session is already closed");
    }
    if (session.status === "active") {
      throw new DomainError(
        "SLOT_TAKEN",
        `This chat is already handled by ${session.staffName ?? "another staff member"}`,
      );
    }
    const busy = await this.repos.liveChat.activeSessionForStaff(user.id);
    if (busy) {
      throw new DomainError(
        "STAFF_BUSY",
        `You are already handling chat session #${busy.id} — complete it first`,
      );
    }
    const claimed = await this.repos.liveChat.claim(sessionId, user.id, user.fullName);
    if (!claimed) {
      // Lost the race to another staff member between the check and the update.
      throw new DomainError("SLOT_TAKEN", "This chat was just taken by another staff member");
    }
    const message = await this.repos.liveChat.appendMessage(
      sessionId,
      "system",
      `You are connected with Staff ${user.fullName}. ` +
        "Please describe what you need help with — they are reading your chat now.",
    );
    await this.repos.audit.record("live_chat_claimed", {
      sessionId,
      staffUserId: user.id,
      staffName: user.fullName,
    });
    this.emit({ type: "session_claimed", session: claimed });
    this.emit({ type: "message", session: claimed, message });
    return claimed;
  }

  /**
   * Appends a chat message. Patients may write while waiting (staff sees the
   * backlog after claiming); staff only while active. Closed = nobody.
   */
  async sendMessage(
    sessionId: number,
    sender: "patient" | "staff",
    body: string,
    opts?: { staffUserId?: number },
  ): Promise<LiveChatMessage> {
    const text = body.trim().slice(0, 2000);
    if (text.length === 0) throw new DomainError("INVALID_INPUT", "Empty message");
    const session = await this.getSession(sessionId);
    if (session.status === "closed") {
      throw new DomainError("CHAT_CLOSED", "This chat session has been completed");
    }
    if (sender === "staff") {
      if (session.status !== "active") {
        throw new DomainError("INVALID_INPUT", "Claim the chat before sending messages");
      }
      if (opts?.staffUserId !== undefined && session.staffUserId !== opts.staffUserId) {
        throw new DomainError("FORBIDDEN", "This chat is handled by another staff member");
      }
    }
    const message = await this.repos.liveChat.appendMessage(sessionId, sender, text);
    if (sender === "patient") await this.touchPatient(sessionId);
    this.emit({ type: "message", session, message });
    return message;
  }

  /** Any patient-side event (message/typing) resets the idle auto-close. */
  async touchPatient(sessionId: number): Promise<void> {
    this.warned.delete(sessionId);
    await this.repos.liveChat.touchPatient(sessionId, this.now().toISOString());
  }

  /** Either side hits the "complete chat" trigger; after this nobody can chat. */
  async complete(sessionId: number, by: "staff" | "patient"): Promise<LiveChatSession> {
    const session = await this.getSession(sessionId);
    if (session.status === "closed") {
      throw new DomainError("CHAT_CLOSED", "This chat session is already closed");
    }
    const closed = await this.repos.liveChat.close(
      sessionId,
      by === "staff" ? "completed_by_staff" : "completed_by_patient",
    );
    if (!closed) throw new DomainError("CHAT_CLOSED", "This chat session is already closed");
    await this.repos.liveChat.appendMessage(
      sessionId,
      "system",
      `Chat completed by ${by === "staff" ? "staff" : "the customer"}. This conversation is now closed.`,
    );
    await this.repos.audit.record("live_chat_completed", { sessionId, by });
    this.warned.delete(sessionId);
    this.emit({ type: "session_closed", session: closed });
    return closed;
  }

  /**
   * Idle sweep, run periodically by the hub: warns the patient at 2 minutes
   * of inactivity and auto-closes (reason "timeout") at 3. Applies to waiting
   * sessions too, so abandoned queue entries do not pile up.
   */
  async sweepIdle(): Promise<void> {
    const nowMs = this.now().getTime();
    const open = [
      ...(await this.repos.liveChat.listSessions({ status: "active" })),
      ...(await this.repos.liveChat.listSessions({ status: "waiting" })),
    ];
    for (const session of open) {
      const idleMs = nowMs - new Date(session.lastPatientEventAt).getTime();
      if (idleMs >= CHAT_IDLE_CLOSE_MS) {
        const closed = await this.repos.liveChat.close(session.id, "timeout");
        if (!closed) continue;
        await this.repos.liveChat.appendMessage(
          session.id,
          "system",
          "Chat closed automatically due to inactivity.",
        );
        this.warned.delete(session.id);
        this.emit({ type: "session_closed", session: closed });
      } else if (idleMs >= CHAT_IDLE_WARN_MS && !this.warned.has(session.id)) {
        this.warned.add(session.id);
        const secondsLeft = Math.max(1, Math.round((CHAT_IDLE_CLOSE_MS - idleMs) / 1000));
        this.emit({ type: "idle_warning", session, secondsLeft });
      }
    }
  }
}
