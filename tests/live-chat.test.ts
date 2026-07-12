import { beforeEach, describe, expect, it } from "vitest";
import { liveChatService, testDb, testRepos } from "./helpers.js";
import type { Database } from "../src/db/executor.js";
import { DomainError, type AuthUser } from "../src/domain/types.js";
import type { Repositories } from "../src/repositories/ports.js";
import {
  CHAT_IDLE_CLOSE_MS,
  CHAT_IDLE_WARN_MS,
  LiveChatService,
  type LiveChatEvent,
} from "../src/services/live-chat-service.js";

let db: Database;
let repos: Repositories;

beforeEach(async () => {
  db = await testDb();
  repos = testRepos(db);
});

async function staffUser(email = "staff@clinic.test"): Promise<AuthUser> {
  const record = await repos.auth.findUserByEmail(email);
  const roles = await repos.auth.rolesForUser(record!.id);
  return {
    id: record!.id,
    email: record!.email,
    fullName: record!.fullName,
    positionCode: record!.positionCode,
    doctorId: record!.doctorId,
    staffId: record!.staffId,
    status: record!.status,
    roles,
  };
}

const REQUEST = { patientTitle: "Mr" as const, patientName: "Andi Wijaya", patientPhone: "+628123456789" };

describe("LiveChatService", () => {
  it("creates a waiting session, returns the secret key once, emits session_created", async () => {
    const chat = liveChatService(db);
    const events: LiveChatEvent[] = [];
    chat.subscribe((e) => events.push(e));

    const { session, patientKey } = await chat.requestChat(REQUEST);
    expect(session.status).toBe("waiting");
    expect(session.patientName).toBe("Andi Wijaya");
    expect(patientKey).toHaveLength(48);
    expect(events.map((e) => e.type)).toEqual(["session_created"]);

    const byKey = await chat.findByPatientKey(patientKey);
    expect(byKey?.id).toBe(session.id);
    // The key is never exposed on the session shape (staff/admin lists).
    expect(JSON.stringify(session)).not.toContain(patientKey);
  });

  it("claim activates the session and sends the connection template message", async () => {
    const chat = liveChatService(db);
    const user = await staffUser();
    const { session } = await chat.requestChat(REQUEST);

    const claimed = await chat.claim(session.id, user);
    expect(claimed.status).toBe("active");
    expect(claimed.staffUserId).toBe(user.id);
    expect(claimed.staffName).toBe(user.fullName);

    const messages = await chat.messages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.sender).toBe("system");
    expect(messages[0]!.body).toContain(`You are connected with Staff ${user.fullName}`);
  });

  it("one staff can only handle one active session (STAFF_BUSY)", async () => {
    const chat = liveChatService(db);
    const user = await staffUser();
    const a = await chat.requestChat(REQUEST);
    const b = await chat.requestChat({ ...REQUEST, patientName: "Budi Raharjo" });

    await chat.claim(a.session.id, user);
    await expect(chat.claim(b.session.id, user)).rejects.toMatchObject({ code: "STAFF_BUSY" });

    // Completing the first frees the staff member for the next one.
    await chat.complete(a.session.id, "staff");
    const claimed = await chat.claim(b.session.id, user);
    expect(claimed.status).toBe("active");
  });

  it("claiming an already-claimed session fails", async () => {
    const chat = liveChatService(db);
    const user = await staffUser();
    const { session } = await chat.requestChat(REQUEST);
    await chat.claim(session.id, user);
    await expect(chat.claim(session.id, user)).rejects.toMatchObject({ code: "SLOT_TAKEN" });
  });

  it("message rules: patient may write while waiting, staff only after claiming", async () => {
    const chat = liveChatService(db);
    const user = await staffUser();
    const { session } = await chat.requestChat(REQUEST);

    await chat.sendMessage(session.id, "patient", "Hello, anyone there?");
    await expect(chat.sendMessage(session.id, "staff", "hi")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });

    await chat.claim(session.id, user);
    await chat.sendMessage(session.id, "staff", "Hi! How can I help?", { staffUserId: user.id });
    await expect(
      chat.sendMessage(session.id, "staff", "intruding", { staffUserId: user.id + 999 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const bodies = (await chat.messages(session.id)).map((m) => m.sender);
    expect(bodies).toEqual(["patient", "system", "staff"]);
  });

  it("complete closes the chat for both sides and emits session_closed", async () => {
    const chat = liveChatService(db);
    const user = await staffUser();
    const events: LiveChatEvent[] = [];
    chat.subscribe((e) => events.push(e));
    const { session } = await chat.requestChat(REQUEST);
    await chat.claim(session.id, user);

    const closed = await chat.complete(session.id, "patient");
    expect(closed.status).toBe("closed");
    expect(closed.closedReason).toBe("completed_by_patient");

    await expect(chat.sendMessage(session.id, "patient", "hello?")).rejects.toMatchObject({
      code: "CHAT_CLOSED",
    });
    await expect(
      chat.sendMessage(session.id, "staff", "hello?", { staffUserId: user.id }),
    ).rejects.toMatchObject({ code: "CHAT_CLOSED" });
    await expect(chat.complete(session.id, "staff")).rejects.toMatchObject({
      code: "CHAT_CLOSED",
    });
    expect(events.at(-1)?.type).toBe("session_closed");
  });

  it("idle sweep warns at 2 minutes and auto-closes at 3 (reason timeout)", async () => {
    let nowMs = Date.parse("2026-07-12T09:00:00.000Z");
    const chat = new LiveChatService(repos, () => new Date(nowMs));
    const user = await staffUser();
    const events: LiveChatEvent[] = [];
    chat.subscribe((e) => events.push(e));

    const { session } = await chat.requestChat(REQUEST);
    await chat.claim(session.id, user);

    // Just before the warn threshold: nothing happens.
    nowMs += CHAT_IDLE_WARN_MS - 1000;
    await chat.sweepIdle();
    expect(events.some((e) => e.type === "idle_warning")).toBe(false);

    // Past the warn threshold: exactly one warning, session still open.
    nowMs += 2000;
    await chat.sweepIdle();
    await chat.sweepIdle();
    expect(events.filter((e) => e.type === "idle_warning")).toHaveLength(1);
    expect((await chat.getSession(session.id)).status).toBe("active");

    // Patient activity (e.g. typing) resets both the warning and the clock.
    await chat.touchPatient(session.id);
    nowMs += CHAT_IDLE_WARN_MS + 1000;
    await chat.sweepIdle();
    expect(events.filter((e) => e.type === "idle_warning")).toHaveLength(2);

    // Past the close threshold: closed with reason timeout.
    nowMs += CHAT_IDLE_CLOSE_MS;
    await chat.sweepIdle();
    const closed = await chat.getSession(session.id);
    expect(closed.status).toBe("closed");
    expect(closed.closedReason).toBe("timeout");
    expect(events.at(-1)?.type).toBe("session_closed");
  });

  it("abandoned waiting sessions are timed out by the sweep too", async () => {
    let nowMs = Date.parse("2026-07-12T09:00:00.000Z");
    const chat = new LiveChatService(repos, () => new Date(nowMs));
    const { session } = await chat.requestChat(REQUEST);

    nowMs += CHAT_IDLE_CLOSE_MS + 1000;
    await chat.sweepIdle();
    const closed = await chat.getSession(session.id);
    expect(closed.status).toBe("closed");
    expect(closed.closedReason).toBe("timeout");
  });

  it("rejects unknown sessions", async () => {
    const chat = liveChatService(db);
    await expect(chat.getSession(9999)).rejects.toBeInstanceOf(DomainError);
  });
});
