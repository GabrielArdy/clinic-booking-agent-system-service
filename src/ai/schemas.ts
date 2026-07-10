import { z } from "zod";

export const intentSchema = z.object({
  intent: z.enum([
    "select_option", // user picked one of the offered options
    "provide_name",
    "provide_phone",
    "confirm",
    "deny",
    "cancel",
    "restart",
    "off_topic",
    "unknown",
  ]),
  // 1-based index into the offered options, when intent is select_option
  optionIndex: z.number().int().positive().nullable().optional(),
  // free-text value for provide_name / provide_phone
  value: z.string().nullable().optional(),
});

export type IntentExtraction = z.infer<typeof intentSchema>;
