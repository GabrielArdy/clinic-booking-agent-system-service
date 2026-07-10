import type { AIProviderAdapter } from "../ai/provider.js";
import { intentSchema } from "../ai/schemas.js";
import { intentSystemPrompt, intentUserPrompt } from "../ai/prompts.js";
import type { Interpretation, Stage } from "./types.js";

const CANCEL_WORDS = new Set(["cancel", "stop", "quit", "exit", "batal", "nevermind"]);
const RESTART_WORDS = new Set(["restart", "start over", "reset", "ulang", "menu"]);
const CONFIRM_WORDS = new Set(["yes", "y", "ok", "okay", "sure", "confirm", "correct", "ya", "yup", "yeah"]);
const DENY_WORDS = new Set(["no", "n", "nope", "wrong", "change", "tidak", "nah"]);

/**
 * Deterministic interpretation. Handles numbered selection, exact and
 * substring option matching, and control keywords. Free text passes through
 * for name/phone collection stages.
 */
export function interpretDeterministic(
  message: string,
  options: string[],
  expectsFreeText: boolean,
): Interpretation {
  const text = message.trim();
  const lower = text.toLowerCase();

  if (CANCEL_WORDS.has(lower)) return { kind: "cancel" };
  if (RESTART_WORDS.has(lower)) return { kind: "restart" };

  if (!expectsFreeText) {
    if (CONFIRM_WORDS.has(lower)) return { kind: "confirm" };
    if (DENY_WORDS.has(lower)) return { kind: "deny" };

    // "2" or "2." picks option 2
    const numeric = lower.match(/^(\d{1,2})\.?$/);
    if (numeric) {
      const index = Number(numeric[1]) - 1;
      if (index >= 0 && index < options.length) return { kind: "option", index };
    }

    const exact = options.findIndex((o) => o.toLowerCase() === lower);
    if (exact >= 0) return { kind: "option", index: exact };

    const contains = options
      .map((o, i) => ({ i, match: o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase()) }))
      .filter((x) => x.match);
    if (lower.length >= 3 && contains.length === 1) {
      return { kind: "option", index: contains[0]!.i };
    }

    return { kind: "unknown" };
  }

  if (text.length > 0) return { kind: "text", value: text };
  return { kind: "unknown" };
}

/**
 * Full interpretation: deterministic first, AI assist only when the
 * deterministic pass cannot resolve the message.
 */
export async function interpret(
  ai: AIProviderAdapter,
  stage: Stage,
  message: string,
  options: string[],
  expectsFreeText: boolean,
): Promise<Interpretation> {
  const deterministic = interpretDeterministic(message, options, expectsFreeText);
  if (deterministic.kind !== "unknown") return deterministic;

  const extraction = await ai.extractStructured({
    system: intentSystemPrompt(),
    user: intentUserPrompt({ stage, options, message }),
    schema: intentSchema,
  });
  if (!extraction) return { kind: "unknown" };

  switch (extraction.intent) {
    case "select_option": {
      const index = (extraction.optionIndex ?? 0) - 1;
      if (index >= 0 && index < options.length) return { kind: "option", index };
      return { kind: "unknown" };
    }
    case "provide_name":
    case "provide_phone":
      return extraction.value ? { kind: "text", value: extraction.value } : { kind: "unknown" };
    case "confirm":
      return { kind: "confirm" };
    case "deny":
      return { kind: "deny" };
    case "cancel":
      return { kind: "cancel" };
    case "restart":
      return { kind: "restart" };
    default:
      return { kind: "unknown" };
  }
}
