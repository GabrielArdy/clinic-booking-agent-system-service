import type { AIProviderAdapter } from "../ai/provider.js";
import { DomainError } from "../domain/types.js";
import type { BookingService } from "../services/booking-service.js";
import { normalizePhone } from "../services/phone.js";
import type { SessionRepo } from "../repositories/ports.js";
import { interpret } from "./interpret.js";
import type {
  AssistantTurn,
  ConversationState,
  Interpretation,
  QuickReply,
  Stage,
} from "./types.js";

const MAX_INVALID_BEFORE_HANDOFF = 3;
const FREE_TEXT_STAGES: Stage[] = ["collect_patient_name", "collect_patient_phone"];

interface StagePrompt {
  message: string;
  options: string[];
}

/**
 * Deterministic conversation state machine. Each stage accepts a limited set
 * of transitions; the AI adapter only helps map free text onto them.
 */
export class ConversationRouter {
  constructor(
    private readonly booking: BookingService,
    private readonly sessions: SessionRepo,
    private readonly ai: AIProviderAdapter,
  ) {}

  async handle(sessionId: string | undefined, rawMessage: string): Promise<AssistantTurn> {
    const message = rawMessage.trim().slice(0, 500);

    let session = sessionId ? await this.sessions.find(sessionId) : null;
    if (!session) {
      session = await this.sessions.create("greeting");
      const turn = await this.enterStage(session.id, "select_specialty", {}, [
        "Hello! Welcome to the clinic. I can help you book an appointment.",
      ]);
      await this.persist(turn, message);
      return turn;
    }

    const stage = session.stage as Stage;
    const state = session.state as ConversationState;

    // Terminal stages: any message restarts the flow.
    if (stage === "booking_complete" || stage === "cancelled" || stage === "handoff_pending") {
      const turn = await this.enterStage(session.id, "select_specialty", {}, [
        "Starting a new booking.",
      ]);
      await this.persist(turn, message);
      return turn;
    }

    const prompt = await this.promptFor(stage, state);
    const expectsFreeText = FREE_TEXT_STAGES.includes(stage);
    const interpretation = await interpret(this.ai, stage, message, prompt.options, expectsFreeText);

    let turn: AssistantTurn;
    if (interpretation.kind === "cancel") {
      turn = await this.enterStage(session.id, "cancelled", state, [
        "No problem, I've cancelled this booking flow. Send any message to start again.",
      ]);
    } else if (interpretation.kind === "restart") {
      turn = await this.enterStage(session.id, "select_specialty", {}, ["Starting over."]);
    } else {
      turn = await this.advance(session.id, stage, state, interpretation, message);
    }

    await this.persist(turn, message);
    return turn;
  }

  getHistory(sessionId: string): Promise<{ role: string; content: string; createdAt: string }[]> {
    return this.sessions.messages(sessionId);
  }

  private async persist(turn: AssistantTurn, userMessage: string): Promise<void> {
    const session = await this.sessions.find(turn.sessionId);
    if (!session) return;
    session.stage = turn.stage;
    session.state = turn.collectedEntities as Record<string, unknown>;
    await this.sessions.save(session);
    if (userMessage.length > 0) await this.sessions.appendMessage(turn.sessionId, "user", userMessage);
    await this.sessions.appendMessage(turn.sessionId, "assistant", turn.message);
  }

  private advance(
    sessionId: string,
    stage: Stage,
    state: ConversationState,
    interpretation: Interpretation,
    rawMessage: string,
  ): Promise<AssistantTurn> {
    switch (stage) {
      case "greeting":
      case "select_specialty":
        return this.handleSelectSpecialty(sessionId, state, interpretation);
      case "select_doctor":
        return this.handleSelectDoctor(sessionId, state, interpretation);
      case "select_date":
        return this.handleSelectDate(sessionId, state, interpretation, rawMessage);
      case "select_slot":
        return this.handleSelectSlot(sessionId, state, interpretation);
      case "collect_patient_name":
        return this.handleCollectName(sessionId, state, interpretation);
      case "collect_patient_phone":
        return this.handleCollectPhone(sessionId, state, interpretation);
      case "confirm_booking":
        return this.handleConfirm(sessionId, state, interpretation);
      default:
        return this.invalidInput(sessionId, stage, state);
    }
  }

  private async handleSelectSpecialty(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    if (interpretation.kind !== "option") {
      return this.invalidInput(sessionId, "select_specialty", state);
    }
    const specialties = await this.booking.listSpecialties();
    const specialty = specialties[interpretation.index];
    if (!specialty) return this.invalidInput(sessionId, "select_specialty", state);

    return this.enterStage(sessionId, "select_doctor", {
      ...state,
      invalidCount: 0,
      specialtyId: specialty.id,
      specialtyName: specialty.name,
    });
  }

  private async handleSelectDoctor(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    if (interpretation.kind !== "option" || state.specialtyId === undefined) {
      return this.invalidInput(sessionId, "select_doctor", state);
    }
    const doctors = await this.booking.listDoctorsBySpecialty(state.specialtyId);
    const doctor = doctors[interpretation.index];
    if (!doctor) return this.invalidInput(sessionId, "select_doctor", state);

    return this.enterStage(sessionId, "select_date", {
      ...state,
      invalidCount: 0,
      doctorId: doctor.id,
      doctorName: doctor.fullName,
    });
  }

  private async handleSelectDate(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
    rawMessage: string,
  ): Promise<AssistantTurn> {
    if (state.doctorId === undefined) return this.invalidInput(sessionId, "select_date", state);

    let date: string | undefined;
    const typedDate = rawMessage.trim().match(/^\d{4}-\d{2}-\d{2}$/);
    if (typedDate) {
      date = typedDate[0];
    } else if (interpretation.kind === "option") {
      date = (await this.booking.getAvailableDates(state.doctorId))[interpretation.index];
    }
    if (!date) return this.invalidInput(sessionId, "select_date", state);

    const slots = await this.booking.getAvailableSlots(state.doctorId, date);
    if (slots.length === 0) {
      return this.enterStage(sessionId, "select_date", state, [
        `Sorry, ${state.doctorName} has no available slots on ${date}. Please pick another date.`,
      ]);
    }
    return this.enterStage(sessionId, "select_slot", { ...state, invalidCount: 0, date });
  }

  private async handleSelectSlot(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    if (
      interpretation.kind !== "option" ||
      state.doctorId === undefined ||
      state.date === undefined
    ) {
      return this.invalidInput(sessionId, "select_slot", state);
    }
    const slots = await this.booking.getAvailableSlots(state.doctorId, state.date);
    const slot = slots[interpretation.index];
    if (!slot) return this.invalidInput(sessionId, "select_slot", state);

    const next: ConversationState = {
      ...state,
      invalidCount: 0,
      slotStart: slot.startTime,
      slotEnd: slot.endTime,
    };
    // Returning user changing slot from confirmation keeps name/phone.
    if (next.patientName && next.patientPhone) {
      return this.enterStage(sessionId, "confirm_booking", next);
    }
    return this.enterStage(sessionId, "collect_patient_name", next);
  }

  private async handleCollectName(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    if (interpretation.kind !== "text") {
      return this.invalidInput(sessionId, "collect_patient_name", state);
    }
    const name = interpretation.value.trim();
    if (name.length < 2 || name.length > 100 || /\d/.test(name)) {
      return this.enterStage(sessionId, "collect_patient_name", state, [
        "That doesn't look like a valid name. Please enter your full name.",
      ]);
    }
    return this.enterStage(sessionId, "collect_patient_phone", {
      ...state,
      invalidCount: 0,
      patientName: name,
    });
  }

  private async handleCollectPhone(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    const raw = interpretation.kind === "text" ? interpretation.value : "";
    const phone = normalizePhone(raw);
    if (!phone) {
      return this.enterStage(sessionId, "collect_patient_phone", state, [
        "That doesn't look like a valid phone number. Please enter it again, e.g. 0812-3456-7890.",
      ]);
    }
    return this.enterStage(sessionId, "confirm_booking", {
      ...state,
      invalidCount: 0,
      patientPhone: phone,
    });
  }

  private async handleConfirm(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    // Options offered at confirm: 1. Confirm 2. Change slot 3. Cancel
    const choice =
      interpretation.kind === "confirm"
        ? 0
        : interpretation.kind === "deny"
          ? 1
          : interpretation.kind === "option"
            ? interpretation.index
            : -1;

    if (choice === 1) {
      return this.enterStage(
        sessionId,
        "select_slot",
        { ...state, invalidCount: 0, slotStart: undefined, slotEnd: undefined },
        ["Sure, let's pick a different time."],
      );
    }
    if (choice === 2) {
      return this.enterStage(sessionId, "cancelled", state, [
        "Booking cancelled. Send any message to start again.",
      ]);
    }
    if (choice !== 0) return this.invalidInput(sessionId, "confirm_booking", state);

    if (
      state.doctorId === undefined ||
      !state.date ||
      !state.slotStart ||
      !state.patientName ||
      !state.patientPhone
    ) {
      return this.invalidInput(sessionId, "confirm_booking", state);
    }

    try {
      const result = await this.booking.createBooking({
        doctorId: state.doctorId,
        date: state.date,
        startTime: state.slotStart,
        patientName: state.patientName,
        patientPhone: state.patientPhone,
      });
      return this.enterStage(sessionId, "booking_complete", {
        ...state,
        invalidCount: 0,
        bookingReference: result.booking.reference,
      });
    } catch (err) {
      if (err instanceof DomainError && err.code === "SLOT_TAKEN") {
        return this.enterStage(
          sessionId,
          "select_slot",
          { ...state, slotStart: undefined, slotEnd: undefined },
          ["Sorry, that slot was just taken by someone else. Please pick another time."],
        );
      }
      throw err;
    }
  }

  private async invalidInput(
    sessionId: string,
    stage: Stage,
    state: ConversationState,
  ): Promise<AssistantTurn> {
    const invalidCount = (state.invalidCount ?? 0) + 1;
    if (invalidCount >= MAX_INVALID_BEFORE_HANDOFF) {
      return this.enterStage(
        sessionId,
        "handoff_pending",
        { ...state, invalidCount },
        [
          "I'm having trouble understanding. Our staff will help you — please call the clinic front desk, or send any message to start over.",
        ],
      );
    }
    return this.enterStage(sessionId, stage, { ...state, invalidCount }, [
      "Sorry, I didn't understand that. Please pick one of the options below, or type 'cancel' to stop.",
    ]);
  }

  /** Builds the assistant turn for a stage: prompt text + quick replies. */
  private async enterStage(
    sessionId: string,
    stage: Stage,
    state: ConversationState,
    prefixLines: string[] = [],
  ): Promise<AssistantTurn> {
    const prompt = await this.promptFor(stage, state);
    const quickReplies: QuickReply[] = prompt.options.map((label, i) => ({
      label,
      value: String(i + 1),
    }));
    const message = [...prefixLines, prompt.message].filter(Boolean).join("\n\n");
    return {
      sessionId,
      stage,
      message,
      quickReplies,
      collectedEntities: state,
      errors: [],
    };
  }

  private async promptFor(stage: Stage, state: ConversationState): Promise<StagePrompt> {
    switch (stage) {
      case "greeting":
      case "select_specialty": {
        const options = (await this.booking.listSpecialties()).map((s) => s.name);
        return { message: "Which specialty do you need?", options };
      }
      case "select_doctor": {
        const options =
          state.specialtyId !== undefined
            ? (await this.booking.listDoctorsBySpecialty(state.specialtyId)).map((d) => d.fullName)
            : [];
        return { message: `Here are our ${state.specialtyName} doctors. Who would you like to see?`, options };
      }
      case "select_date": {
        const options =
          state.doctorId !== undefined ? await this.booking.getAvailableDates(state.doctorId) : [];
        const message =
          options.length > 0
            ? `When would you like to see ${state.doctorName}? Pick a date or type one as YYYY-MM-DD.`
            : `${state.doctorName} has no open dates in the next month. Type a date as YYYY-MM-DD to check, or 'restart' to pick another doctor.`;
        return { message, options };
      }
      case "select_slot": {
        const options =
          state.doctorId !== undefined && state.date
            ? (await this.booking.getAvailableSlots(state.doctorId, state.date)).map(
                (s) => `${s.startTime} - ${s.endTime}`,
              )
            : [];
        return { message: `Available times on ${state.date}:`, options };
      }
      case "collect_patient_name":
        return { message: "May I have your full name?", options: [] };
      case "collect_patient_phone":
        return { message: `Thanks, ${state.patientName}. What's your phone number?`, options: [] };
      case "confirm_booking":
        return {
          message: [
            "Please confirm your appointment:",
            `- Specialty: ${state.specialtyName}`,
            `- Doctor: ${state.doctorName}`,
            `- Date: ${state.date}`,
            `- Time: ${state.slotStart} - ${state.slotEnd}`,
            `- Name: ${state.patientName}`,
            `- Phone: ${state.patientPhone}`,
          ].join("\n"),
          options: ["Confirm", "Change slot", "Cancel"],
        };
      case "booking_complete":
        return {
          message: [
            `Your appointment is booked! Reference: ${state.bookingReference}`,
            `${state.doctorName} on ${state.date} at ${state.slotStart}.`,
            "Keep this reference for any changes. Send any message to book another appointment.",
          ].join("\n"),
          options: [],
        };
      case "cancelled":
        return { message: "Booking flow cancelled.", options: [] };
      case "handoff_pending":
        return { message: "Waiting for staff assistance.", options: [] };
    }
  }
}
