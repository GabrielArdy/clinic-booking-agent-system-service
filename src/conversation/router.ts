import type { AIProviderAdapter } from "../ai/provider.js";
import { DomainError } from "../domain/types.js";
import {
  MIN_CANCEL_LEAD_HOURS,
  type BookingLookup,
  type BookingService,
} from "../services/booking-service.js";
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
const FREE_TEXT_STAGES: Stage[] = [
  "collect_patient_name",
  "collect_patient_phone",
  "check_collect_reference",
  "check_collect_phone",
];
const TERMINAL_STAGES: Stage[] = [
  "booking_complete",
  "cancellation_complete",
  "cancelled",
  "handoff_pending",
];

interface StageOption {
  label: string;
  disabled?: boolean;
}

interface StagePrompt {
  message: string;
  options: StageOption[];
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
      const turn = await this.enterStage(session.id, "select_purpose", {}, [
        "Hello! Welcome to the clinic. I can help you book an appointment or check an existing one.",
      ]);
      await this.persist(turn, message);
      return turn;
    }

    const stage = session.stage as Stage;
    const state = session.state as ConversationState;

    // Terminal stages: any message restarts the flow.
    if (TERMINAL_STAGES.includes(stage)) {
      const turn = await this.enterStage(session.id, "select_purpose", {}, ["Starting over."]);
      await this.persist(turn, message);
      return turn;
    }

    const prompt = await this.promptFor(session.id, stage, state);
    const expectsFreeText = FREE_TEXT_STAGES.includes(stage);
    const interpretation = await interpret(
      this.ai,
      stage,
      message,
      prompt.options.map((o) => o.label),
      expectsFreeText,
    );

    let turn: AssistantTurn;
    if (interpretation.kind === "cancel") {
      await this.releaseHeldSlot(session.id, state);
      turn = await this.enterStage(session.id, "cancelled", state, [
        "No problem, I've cancelled this booking flow. Send any message to start again.",
      ]);
    } else if (interpretation.kind === "restart") {
      await this.releaseHeldSlot(session.id, state);
      turn = await this.enterStage(session.id, "select_purpose", {}, ["Starting over."]);
    } else {
      turn = await this.advance(session.id, stage, state, interpretation, message);
    }

    await this.persist(turn, message);
    return turn;
  }

  getHistory(sessionId: string): Promise<{ role: string; content: string; createdAt: string }[]> {
    return this.sessions.messages(sessionId);
  }

  /** Releases the session's slot hold, if it holds one. */
  private async releaseHeldSlot(sessionId: string, state: ConversationState): Promise<void> {
    if (state.doctorId === undefined || !state.date || !state.slotStart) return;
    await this.booking.releaseHold(state.doctorId, state.date, state.slotStart, sessionId);
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
      case "select_purpose":
        return this.handleSelectPurpose(sessionId, state, interpretation);
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
      case "check_collect_reference":
        return this.handleCollectReference(sessionId, state, interpretation);
      case "check_collect_phone":
        return this.handleCollectLookupPhone(sessionId, state, interpretation);
      case "check_result":
        return this.handleCheckResult(sessionId, state, interpretation);
      case "confirm_cancellation":
        return this.handleConfirmCancellation(sessionId, state, interpretation);
      default:
        return this.invalidInput(sessionId, stage, state);
    }
  }

  private async handleSelectPurpose(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    if (interpretation.kind !== "option") {
      return this.invalidInput(sessionId, "select_purpose", state);
    }
    if (interpretation.index === 0) {
      return this.enterStage(sessionId, "select_specialty", { invalidCount: 0 });
    }
    if (interpretation.index === 1) {
      return this.enterStage(sessionId, "check_collect_reference", { invalidCount: 0 });
    }
    return this.invalidInput(sessionId, "select_purpose", state);
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

    const slots = await this.booking.getAvailableSlots(state.doctorId, date, sessionId);
    if (slots.length === 0) {
      return this.enterStage(sessionId, "select_date", state, [
        `Sorry, ${state.doctorName} has no available slots on ${date}. Please pick another date.`,
      ]);
    }
    if (!slots.some((s) => s.available)) {
      return this.enterStage(sessionId, "select_date", state, [
        `Sorry, ${state.doctorName} is fully booked on ${date}. Please pick another date.`,
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
    const slots = await this.booking.getAvailableSlots(state.doctorId, state.date, sessionId);
    const slot = slots[interpretation.index];
    if (!slot) return this.invalidInput(sessionId, "select_slot", state);
    if (!slot.available) {
      const reason =
        slot.unavailableReason === "lead_time"
          ? "can no longer be booked (bookings close 6 hours before the appointment)"
          : slot.unavailableReason === "held"
            ? "is currently being booked by someone else"
            : "is already full";
      return this.enterStage(sessionId, "select_slot", state, [
        `Sorry, the ${slot.startTime} - ${slot.endTime} slot ${reason}. Please pick another time.`,
      ]);
    }

    // Lock a seat for this session while it finishes the flow (TTL 5 min).
    try {
      await this.booking.holdSlot(state.doctorId, state.date, slot.startTime, sessionId);
    } catch (err) {
      if (err instanceof DomainError && err.code === "SLOT_TAKEN") {
        return this.enterStage(sessionId, "select_slot", state, [
          `Sorry, the ${slot.startTime} - ${slot.endTime} slot ${
            /being booked/.test(err.message)
              ? "is currently being booked by someone else"
              : "is no longer available"
          }. Please pick another time.`,
        ]);
      }
      throw err;
    }

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
      await this.releaseHeldSlot(sessionId, state);
      return this.enterStage(
        sessionId,
        "select_slot",
        { ...state, invalidCount: 0, slotStart: undefined, slotEnd: undefined },
        ["Sure, let's pick a different time."],
      );
    }
    if (choice === 2) {
      await this.releaseHeldSlot(sessionId, state);
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
        holderId: sessionId, // hold is released by the service on success
      });
      return this.enterStage(sessionId, "booking_complete", {
        ...state,
        invalidCount: 0,
        bookingReference: result.booking.reference,
      });
    } catch (err) {
      if (err instanceof DomainError && err.code === "SLOT_TAKEN") {
        await this.releaseHeldSlot(sessionId, state);
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

  // ---- check / cancel appointment flow ----

  /** Re-verifies the looked-up booking; null when it can't be loaded anymore. */
  private async lookupForState(state: ConversationState): Promise<BookingLookup | null> {
    if (!state.lookupReference || !state.lookupPhone) return null;
    try {
      return await this.booking.findBookingForPatient(state.lookupReference, state.lookupPhone);
    } catch {
      return null;
    }
  }

  private async handleCollectReference(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    if (interpretation.kind !== "text") {
      return this.invalidInput(sessionId, "check_collect_reference", state);
    }
    const reference = interpretation.value.trim().toUpperCase();
    if (reference.length < 4 || reference.length > 20) {
      return this.enterStage(sessionId, "check_collect_reference", state, [
        "That doesn't look like a booking reference (e.g. BK-A1B2C3). Please try again.",
      ]);
    }
    return this.enterStage(sessionId, "check_collect_phone", {
      ...state,
      invalidCount: 0,
      lookupReference: reference,
    });
  }

  private async handleCollectLookupPhone(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    if (!state.lookupReference) {
      return this.invalidInput(sessionId, "check_collect_phone", state);
    }
    const raw = interpretation.kind === "text" ? interpretation.value : "";
    const phone = normalizePhone(raw);
    if (!phone) {
      return this.enterStage(sessionId, "check_collect_phone", state, [
        "That doesn't look like a valid phone number. Please enter the phone number used for the booking.",
      ]);
    }
    try {
      await this.booking.findBookingForPatient(state.lookupReference, phone);
    } catch (err) {
      if (
        err instanceof DomainError &&
        (err.code === "NOT_FOUND" || err.code === "PHONE_MISMATCH")
      ) {
        return this.enterStage(
          sessionId,
          "check_collect_reference",
          { ...state, lookupReference: undefined },
          ["I couldn't find a booking with that reference and phone number. Let's try again."],
        );
      }
      throw err;
    }
    return this.enterStage(sessionId, "check_result", {
      ...state,
      invalidCount: 0,
      lookupPhone: phone,
    });
  }

  private async handleCheckResult(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    if (interpretation.kind !== "option") {
      return this.invalidInput(sessionId, "check_result", state);
    }
    // Option order mirrors promptFor: [Cancel this appointment,] Main menu.
    const lookup = await this.lookupForState(state);
    const choices = lookup?.canCancel ? ["cancel", "menu"] : ["menu"];
    const choice = choices[interpretation.index];
    if (choice === "cancel") {
      return this.enterStage(sessionId, "confirm_cancellation", { ...state, invalidCount: 0 });
    }
    if (choice === "menu") {
      return this.enterStage(sessionId, "select_purpose", { invalidCount: 0 }, [
        "Back to the main menu.",
      ]);
    }
    return this.invalidInput(sessionId, "check_result", state);
  }

  private async handleConfirmCancellation(
    sessionId: string,
    state: ConversationState,
    interpretation: Interpretation,
  ): Promise<AssistantTurn> {
    // Options offered: 1. Yes, cancel it 2. No, keep it
    const choice =
      interpretation.kind === "confirm"
        ? 0
        : interpretation.kind === "deny"
          ? 1
          : interpretation.kind === "option"
            ? interpretation.index
            : -1;

    if (choice === 1) {
      return this.enterStage(sessionId, "check_result", { ...state, invalidCount: 0 }, [
        "Okay, keeping your appointment.",
      ]);
    }
    if (choice !== 0 || !state.lookupReference || !state.lookupPhone) {
      return this.invalidInput(sessionId, "confirm_cancellation", state);
    }

    try {
      await this.booking.cancelBooking(state.lookupReference, state.lookupPhone);
    } catch (err) {
      if (
        err instanceof DomainError &&
        (err.code === "TOO_LATE_TO_CANCEL" || err.code === "ALREADY_CANCELLED")
      ) {
        return this.enterStage(sessionId, "check_result", state, [
          `Sorry, I couldn't cancel it: ${err.message}.`,
        ]);
      }
      throw err;
    }
    return this.enterStage(sessionId, "cancellation_complete", { ...state, invalidCount: 0 });
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
    const prompt = await this.promptFor(sessionId, stage, state);
    const quickReplies: QuickReply[] = prompt.options.map((option, i) => ({
      label: option.label,
      value: String(i + 1),
      ...(option.disabled ? { disabled: true } : {}),
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

  private async promptFor(
    sessionId: string,
    stage: Stage,
    state: ConversationState,
  ): Promise<StagePrompt> {
    switch (stage) {
      case "greeting":
      case "select_purpose":
        return {
          message: "What would you like to do?",
          options: [{ label: "Book an appointment" }, { label: "Check or cancel an appointment" }],
        };
      case "select_specialty": {
        const options = (await this.booking.listSpecialties()).map((s) => ({ label: s.name }));
        return { message: "Which specialty do you need?", options };
      }
      case "select_doctor": {
        const options =
          state.specialtyId !== undefined
            ? (await this.booking.listDoctorsBySpecialty(state.specialtyId)).map((d) => ({
                label: d.fullName,
              }))
            : [];
        return { message: `Here are our ${state.specialtyName} doctors. Who would you like to see?`, options };
      }
      case "select_date": {
        const options =
          state.doctorId !== undefined
            ? (await this.booking.getAvailableDates(state.doctorId)).map((d) => ({ label: d }))
            : [];
        const message =
          options.length > 0
            ? `When would you like to see ${state.doctorName}? Pick a date or type one as YYYY-MM-DD.`
            : `${state.doctorName} has no open dates in the next month. Type a date as YYYY-MM-DD to check, or 'restart' to pick another doctor.`;
        return { message, options };
      }
      case "select_slot": {
        const options =
          state.doctorId !== undefined && state.date
            ? (await this.booking.getAvailableSlots(state.doctorId, state.date, sessionId)).map(
                (s) => ({
                  label: s.available
                    ? `${s.startTime} - ${s.endTime}`
                    : `${s.startTime} - ${s.endTime} ${
                        s.unavailableReason === "full"
                          ? "(Full)"
                          : s.unavailableReason === "held"
                            ? "(Being booked)"
                            : "(Booking closed)"
                      }`,
                  ...(s.available ? {} : { disabled: true }),
                }),
              )
            : [];
        const hasUnavailable = options.some((o) => o.disabled);
        return {
          message: hasUnavailable
            ? `Available times on ${state.date} (marked slots cannot be booked):`
            : `Available times on ${state.date}:`,
          options,
        };
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
          options: [{ label: "Confirm" }, { label: "Change slot" }, { label: "Cancel" }],
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
      case "check_collect_reference":
        return {
          message: "What's your booking reference? (e.g. BK-A1B2C3)",
          options: [],
        };
      case "check_collect_phone":
        return {
          message: "And the phone number used for the booking?",
          options: [],
        };
      case "check_result": {
        const lookup = await this.lookupForState(state);
        if (!lookup) {
          return {
            message: "I couldn't load that booking anymore.",
            options: [{ label: "Main menu" }],
          };
        }
        const { booking, doctor, canCancel } = lookup;
        const lines = [
          `Here is your appointment (${booking.reference}):`,
          `- Doctor: ${doctor.fullName}`,
          `- Date: ${booking.date}`,
          `- Time: ${booking.startTime} - ${booking.endTime}`,
          `- Status: ${booking.status}`,
        ];
        if (booking.status === "active" && !canCancel) {
          lines.push(
            `Cancellation is closed within ${MIN_CANCEL_LEAD_HOURS} hours of the appointment.`,
          );
        }
        const options = canCancel
          ? [{ label: "Cancel this appointment" }, { label: "Main menu" }]
          : [{ label: "Main menu" }];
        return { message: lines.join("\n"), options };
      }
      case "confirm_cancellation": {
        const lookup = await this.lookupForState(state);
        const summary = lookup
          ? ` with ${lookup.doctor.fullName} on ${lookup.booking.date} at ${lookup.booking.startTime}`
          : "";
        return {
          message: `Cancel appointment ${state.lookupReference}${summary}? This cannot be undone and the slot will be released.`,
          options: [{ label: "Yes, cancel it" }, { label: "No, keep it" }],
        };
      }
      case "cancellation_complete":
        return {
          message: [
            `Your appointment ${state.lookupReference} has been cancelled and the slot has been released.`,
            "Send any message to return to the main menu.",
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
