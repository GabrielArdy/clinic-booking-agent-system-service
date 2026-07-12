export const STAGES = [
  "greeting",
  "select_purpose",
  "select_specialty",
  "select_doctor",
  "select_date",
  "select_slot",
  "collect_patient_name",
  "collect_patient_phone",
  "confirm_booking",
  "booking_complete",
  "check_collect_reference",
  "check_collect_phone",
  "check_result",
  "confirm_cancellation",
  "cancellation_complete",
  "cancelled",
  "handoff_pending",
  "connect_collect_name",
  "connect_collect_title",
  "connect_collect_phone",
  "connect_waiting",
] as const;

export type Stage = (typeof STAGES)[number];

/** Entities collected across the conversation, persisted as session state. */
export interface ConversationState {
  specialtyId?: number;
  specialtyName?: string;
  doctorId?: number;
  doctorName?: string;
  date?: string;
  slotStart?: string;
  slotEnd?: string;
  patientName?: string;
  patientPhone?: string;
  bookingReference?: string;
  /** Check/cancel flow: reference + phone the user is looking up. */
  lookupReference?: string;
  lookupPhone?: string;
  /** Connect-with-staff flow: personal info + the created live chat session. */
  connectTitle?: "Mr" | "Mrs" | "Ms";
  connectName?: string;
  connectPhone?: string;
  liveChatSessionId?: number;
  liveChatPatientKey?: string;
  invalidCount?: number;
}

export interface QuickReply {
  label: string;
  value: string;
  /** true = shown but not selectable, e.g. a fully booked timeslot. */
  disabled?: boolean;
}

export interface AssistantTurn {
  sessionId: string;
  stage: Stage;
  message: string;
  quickReplies: QuickReply[];
  collectedEntities: ConversationState;
  errors: string[];
  /**
   * Present once the connect-with-staff flow created a live chat session.
   * The FE should switch to the WebSocket: /ws?role=patient&key=<patientKey>.
   */
  liveChat?: { sessionId: number; patientKey: string; wsPath: string };
}

/** What the interpreter decided the user meant. */
export type Interpretation =
  | { kind: "option"; index: number } // 0-based index into offered options
  | { kind: "text"; value: string }
  | { kind: "confirm" }
  | { kind: "deny" }
  | { kind: "cancel" }
  | { kind: "restart" }
  | { kind: "unknown" };
