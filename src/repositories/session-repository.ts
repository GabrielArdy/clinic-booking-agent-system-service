import { randomUUID } from "node:crypto";
import type { DB } from "../db/connection.js";

export interface SessionRecord {
  id: string;
  stage: string;
  state: Record<string, unknown>;
}

interface Row {
  id: string;
  stage: string;
  state_json: string;
}

export class SessionRepository {
  constructor(private readonly db: DB) {}

  create(stage: string): SessionRecord {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO conversation_sessions (id, stage, state_json) VALUES (?, ?, '{}')")
      .run(id, stage);
    return { id, stage, state: {} };
  }

  find(id: string): SessionRecord | null {
    const row = this.db
      .prepare("SELECT id, stage, state_json FROM conversation_sessions WHERE id = ?")
      .get(id) as Row | undefined;
    if (!row) return null;
    return { id: row.id, stage: row.stage, state: JSON.parse(row.state_json) };
  }

  save(session: SessionRecord): void {
    this.db
      .prepare(
        `UPDATE conversation_sessions
         SET stage = ?, state_json = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(session.stage, JSON.stringify(session.state), session.id);
  }

  appendMessage(sessionId: string, role: "user" | "assistant", content: string): void {
    this.db
      .prepare("INSERT INTO conversation_messages (session_id, role, content) VALUES (?, ?, ?)")
      .run(sessionId, role, content);
  }

  messages(sessionId: string): { role: string; content: string; createdAt: string }[] {
    const rows = this.db
      .prepare(
        `SELECT role, content, created_at FROM conversation_messages
         WHERE session_id = ? ORDER BY id`,
      )
      .all(sessionId) as { role: string; content: string; created_at: string }[];
    return rows.map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at }));
  }
}
