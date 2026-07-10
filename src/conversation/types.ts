export const STAGES = [
  "greeting",
  "select_specialty",
  "select_doctor",
  "select_date",
  "select_slot",
  "collect_patient_name",
  "collect_patient_phone",
  "confirm_booking",
  "booking_complete",
  "cancelled",
  "handoff_pending",
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
  invalidCount?: number;
}

export interface QuickReply {
  label: string;
  value: string;
}

export interface AssistantTurn {
  sessionId: string;
  stage: Stage;
  message: string;
  quickReplies: QuickReply[];
  collectedEntities: ConversationState;
  errors: string[];
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
