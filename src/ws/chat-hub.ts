import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AuthUser } from "../domain/types.js";
import { logger } from "../logging/logger.js";
import { ROLES, type AuthService } from "../services/auth-service.js";
import type { LiveChatEvent, LiveChatService } from "../services/live-chat-service.js";

/** How often the idle sweep runs (warn at 2 min, close at 3). */
const SWEEP_INTERVAL_MS = 15_000;

interface PatientSocket {
  kind: "patient";
  sessionId: number;
}
interface StaffSocket {
  kind: "staff";
  user: AuthUser;
  /** Chat room the socket joined (null = dashboard/notification-only). */
  sessionId: number | null;
}
type SocketCtx = PatientSocket | StaffSocket;

/** Client -> server frames. */
interface InboundFrame {
  type?: string;
  body?: unknown;
}

/**
 * WebSocket fan-out for the live chat, mounted on the HTTP server at /ws.
 *
 * Connections:
 *   /ws?role=patient&key=<patientKey>            patient chat room
 *   /ws?role=staff&token=<bearer>[&session=<id>] staff/admin; with session =
 *     chat room, without = dashboard notifications (new_session toasts)
 *
 * Frames in : {type:"message", body} | {type:"typing"} | {type:"complete"}
 * Frames out: history | message | session_claimed | idle_warning |
 *             session_closed | new_session | error
 */
export class ChatHub {
  private readonly wss: WebSocketServer;
  private readonly ctx = new Map<WebSocket, SocketCtx>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    server: Server,
    private readonly auth: AuthService,
    private readonly chat: LiveChatService,
  ) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (socket, req) => {
      void this.onConnection(socket, req).catch((err) => {
        logger.error("ws connection error", { error: err instanceof Error ? err.message : String(err) });
        socket.close(1011, "internal error");
      });
    });
    this.chat.subscribe((event) => this.onChatEvent(event));
    this.sweeper = setInterval(() => {
      void this.chat.sweepIdle().catch((err) => {
        logger.error("chat idle sweep failed", { error: err instanceof Error ? err.message : String(err) });
      });
    }, SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  close(): void {
    clearInterval(this.sweeper);
    for (const socket of this.ctx.keys()) socket.close(1001, "server shutting down");
    this.wss.close();
  }

  // ---- connection setup ----

  private async onConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const role = url.searchParams.get("role");

    if (role === "patient") {
      const key = url.searchParams.get("key") ?? "";
      const session = key ? await this.chat.findByPatientKey(key) : null;
      if (!session) return socket.close(4401, "invalid patient key");
      this.attach(socket, { kind: "patient", sessionId: session.id });
      return this.sendHistory(socket, session.id);
    }

    if (role === "staff") {
      // Browsers cannot set headers on WebSocket connects — token via query.
      const token = url.searchParams.get("token") ?? "";
      const user = await this.auth.authenticate(token);
      const allowed =
        user && (user.roles.includes(ROLES.STF_CHAT) || user.roles.includes(ROLES.ADM_DASHBOARD));
      if (!user || !allowed) return socket.close(4403, "not authorized for live chat");
      const rawSession = url.searchParams.get("session");
      const sessionId = rawSession ? Number(rawSession) : null;
      if (sessionId !== null && !Number.isInteger(sessionId)) {
        return socket.close(4400, "invalid session id");
      }
      this.attach(socket, { kind: "staff", user, sessionId });
      if (sessionId !== null) return this.sendHistory(socket, sessionId);
      return;
    }

    socket.close(4400, "role query parameter required (patient|staff)");
  }

  private attach(socket: WebSocket, ctx: SocketCtx): void {
    this.ctx.set(socket, ctx);
    socket.on("close", () => this.ctx.delete(socket));
    socket.on("message", (data) => {
      void this.onFrame(socket, ctx, data.toString()).catch((err) => {
        this.send(socket, {
          type: "error",
          error: err instanceof Error ? err.message : "invalid frame",
          code: err instanceof Error && "code" in err ? (err as { code: string }).code : undefined,
        });
      });
    });
  }

  private async sendHistory(socket: WebSocket, sessionId: number): Promise<void> {
    const [session, messages] = await Promise.all([
      this.chat.getSession(sessionId),
      this.chat.messages(sessionId),
    ]);
    this.send(socket, { type: "history", session, messages });
  }

  // ---- inbound frames ----

  private async onFrame(socket: WebSocket, ctx: SocketCtx, raw: string): Promise<void> {
    let frame: InboundFrame;
    try {
      frame = JSON.parse(raw) as InboundFrame;
    } catch {
      return this.send(socket, { type: "error", error: "frames must be JSON" });
    }
    const sessionId = ctx.sessionId;
    if (sessionId === null) {
      return this.send(socket, { type: "error", error: "this connection has no chat room" });
    }

    switch (frame.type) {
      case "message": {
        const body = typeof frame.body === "string" ? frame.body : "";
        if (ctx.kind === "patient") {
          await this.chat.sendMessage(sessionId, "patient", body);
        } else {
          await this.chat.sendMessage(sessionId, "staff", body, { staffUserId: ctx.user.id });
        }
        return;
      }
      case "typing": {
        // Patient typing counts as activity so the idle close never fires mid-typing.
        if (ctx.kind === "patient") await this.chat.touchPatient(sessionId);
        return;
      }
      case "complete": {
        await this.chat.complete(sessionId, ctx.kind === "patient" ? "patient" : "staff");
        return;
      }
      default:
        return this.send(socket, { type: "error", error: `unknown frame type: ${frame.type}` });
    }
  }

  // ---- outbound fan-out ----

  private onChatEvent(event: LiveChatEvent): void {
    switch (event.type) {
      case "session_created":
        // Toast for every connected staff/admin dashboard.
        return this.toStaffDashboards({ type: "new_session", session: event.session });
      case "session_claimed":
        return this.toRoom(event.session.id, { type: "session_claimed", session: event.session });
      case "message":
        return this.toRoom(event.session.id, { type: "message", message: event.message });
      case "idle_warning":
        // Warning is for the customer side only.
        return this.toRoom(
          event.session.id,
          { type: "idle_warning", secondsLeft: event.secondsLeft },
          { patientsOnly: true },
        );
      case "session_closed":
        return this.toRoom(event.session.id, {
          type: "session_closed",
          reason: event.session.closedReason,
          session: event.session,
        });
    }
  }

  private toRoom(
    sessionId: number,
    payload: Record<string, unknown>,
    opts?: { patientsOnly?: boolean },
  ): void {
    for (const [socket, ctx] of this.ctx) {
      if (ctx.sessionId !== sessionId) continue;
      if (opts?.patientsOnly && ctx.kind !== "patient") continue;
      this.send(socket, payload);
    }
  }

  private toStaffDashboards(payload: Record<string, unknown>): void {
    for (const [socket, ctx] of this.ctx) {
      if (ctx.kind === "staff") this.send(socket, payload);
    }
  }

  private send(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }
}
