import type { DB } from "../db/connection.js";

export class AuditRepository {
  constructor(private readonly db: DB) {}

  record(eventType: string, payload: Record<string, unknown>): void {
    this.db
      .prepare("INSERT INTO audit_events (event_type, payload_json) VALUES (?, ?)")
      .run(eventType, JSON.stringify(payload));
  }
}
