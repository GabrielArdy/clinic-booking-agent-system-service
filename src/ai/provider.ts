import type { z } from "zod";

/**
 * Provider-agnostic AI boundary. The conversation router only depends on
 * this interface — never on OpenRouter or any concrete vendor. AI output
 * assists interpretation only; booking validity stays in BookingService.
 */
export interface AIProviderAdapter {
  /**
   * Ask the model to produce JSON matching `schema`. Returns null on any
   * failure (network, refusal, schema mismatch) so callers always have a
   * deterministic fallback path.
   */
  extractStructured<T>(params: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
  }): Promise<T | null>;
}

/** Used when no API key is configured — router runs fully deterministic. */
export class DisabledAIProvider implements AIProviderAdapter {
  async extractStructured<T>(): Promise<T | null> {
    return null;
  }
}
