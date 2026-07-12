import http from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { liveChatService, testDb, testRepos } from "./helpers.js";
import type { Database } from "../src/db/executor.js";
import { AuthService } from "../src/services/auth-service.js";
import type { LiveChatService } from "../src/services/live-chat-service.js";
import { ChatHub } from "../src/ws/chat-hub.js";

let db: Database;
let auth: AuthService;
let chat: LiveChatService;
let server: http.Server;
let hub: ChatHub;
let baseUrl: string;

beforeEach(async () => {
  db = await testDb();
  const repos = testRepos(db);
  auth = new AuthService(repos);
  chat = liveChatService(db);
  server = http.createServer();
  hub = new ChatHub(server, auth, chat);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});

afterEach(async () => {
  hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
});

/** WS client that buffers every frame so none are lost between awaits. */
class Client {
  readonly socket: WebSocket;
  private readonly frames: Record<string, unknown>[] = [];
  private readonly waiters: (() => void)[] = [];

  constructor(query: string) {
    this.socket = new WebSocket(`${baseUrl}?${query}`);
    this.socket.on("message", (data) => {
      this.frames.push(JSON.parse(data.toString()) as Record<string, unknown>);
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
  }

  /** Close code; the server accepts the handshake before auth, so a rejected
   *  connection shows up as open-then-close. */
  closed(): Promise<number> {
    return new Promise((resolve) => this.socket.once("close", resolve));
  }

  send(frame: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(frame));
  }

  /** Next (or already buffered) frame of the given type. */
  async next(type: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const i = this.frames.findIndex((f) => f.type === type);
      if (i >= 0) return this.frames.splice(i, 1)[0]!;
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${type}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

async function connect(query: string): Promise<Client> {
  const client = new Client(query);
  await client.opened();
  return client;
}

describe("ChatHub", () => {
  it("rejects unauthenticated connections", async () => {
    expect(await new Client("role=patient&key=wrong").closed()).toBe(4401);
    expect(await new Client("role=staff&token=wrong").closed()).toBe(4403);
    expect(await new Client("role=alien").closed()).toBe(4400);
  });

  it("full flow: toast, claim template, message exchange, complete blocks both", async () => {
    const { token } = await auth.login("staff@clinic.test", "Staff123!");

    // Staff dashboard (no room) gets the new_session toast.
    const dashboard = await connect(`role=staff&token=${token}`);
    const { session, patientKey } = await chat.requestChat({
      patientTitle: "Mr",
      patientName: "Andi Wijaya",
      patientPhone: "628123456789",
    });
    const toast = await dashboard.next("new_session");
    expect((toast.session as { id: number }).id).toBe(session.id);

    // Patient joins their room via the secret key and gets history.
    const patient = await connect(`role=patient&key=${patientKey}`);
    const history = await patient.next("history");
    expect((history.session as { status: string }).status).toBe("waiting");

    // Staff opens the chat room and claims -> template message reaches the patient.
    const room = await connect(`role=staff&token=${token}&session=${session.id}`);
    await room.next("history");
    const user = await auth.authenticate(token);
    await chat.claim(session.id, user!);
    const template = await patient.next("message");
    expect((template.message as { body: string }).body).toContain(
      "You are connected with Staff Sari Wulandari",
    );
    await room.next("message"); // drain the same template frame on the staff side

    // Typing indicator: relayed to the other side only (sender excluded).
    patient.send({ type: "typing" });
    expect((await room.next("typing")).from).toBe("patient");
    room.send({ type: "typing" });
    expect((await patient.next("typing")).from).toBe("staff");

    // Patient message -> staff room (and echoed back to the sender).
    patient.send({ type: "message", body: "Hi, I need help" });
    expect(((await room.next("message")).message as { body: string }).body).toBe(
      "Hi, I need help",
    );
    await patient.next("message"); // own echo

    room.send({ type: "message", body: "Sure, go ahead" });
    expect(((await patient.next("message")).message as { body: string }).body).toBe(
      "Sure, go ahead",
    );

    // Staff hits the complete trigger: both sides see the close, then nobody can chat.
    room.send({ type: "complete" });
    expect((await patient.next("session_closed")).reason).toBe("completed_by_staff");
    expect((await room.next("session_closed")).reason).toBe("completed_by_staff");

    patient.send({ type: "message", body: "still there?" });
    expect((await patient.next("error")).code).toBe("CHAT_CLOSED");

    for (const c of [dashboard, patient, room]) c.socket.close();
  });
});
