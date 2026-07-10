import type { z } from "zod";
import type { AIProviderAdapter } from "./provider.js";
import { logger } from "../logging/logger.js";

export interface AgentRouterConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs?: number;
}

/**
 * AgentRouter (https://docs.agentrouter.org/) adapter. AgentRouter exposes an
 * OpenAI-compatible surface: POST {baseUrl}/chat/completions with a Bearer
 * token, so the wire format matches OpenRouterAdapter. Kept as a separate
 * class so the two providers can be swapped by config without touching callers.
 */
export class AgentRouterAdapter implements AIProviderAdapter {
  constructor(private readonly config: AgentRouterConfig) {}

  async extractStructured<T>(params: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
  }): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          messages: [
            { role: "system", content: params.system },
            { role: "user", content: params.user },
          ],
        }),
      });
      clearTimeout(timer);

      if (!response.ok) {
        logger.warn("agentrouter request failed", { status: response.status });
        return null;
      }

      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) return null;

      // Model may wrap JSON in a code fence; extract the first JSON object.
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return null;

      const parsed = params.schema.safeParse(JSON.parse(match[0]));
      if (!parsed.success) {
        logger.warn("agentrouter output failed schema validation", {
          issues: parsed.error.issues.map((i) => i.message),
        });
        return null;
      }
      return parsed.data;
    } catch (err) {
      logger.warn("agentrouter call errored", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
