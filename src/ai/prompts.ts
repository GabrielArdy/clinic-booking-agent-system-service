export function intentSystemPrompt(): string {
  return [
    "You classify a patient's chat message inside a clinic appointment booking flow.",
    "Respond ONLY with a JSON object, no prose, matching this shape:",
    '{"intent": "select_option|provide_name|provide_phone|confirm|deny|cancel|restart|off_topic|unknown", "optionIndex": number|null, "value": string|null}',
    "Rules:",
    "- If the message clearly matches one of the numbered options, use select_option with its 1-based optionIndex.",
    "- If the current step asks for a name and the message looks like a person's name, use provide_name with value.",
    "- If the current step asks for a phone number and the message contains one, use provide_phone with value.",
    "- Affirmations (yes, ok, sure, correct) => confirm. Negations => deny.",
    "- Requests to stop or cancel => cancel. Requests to start over => restart.",
    "- Anything unrelated to booking => off_topic.",
    "- Never invent an optionIndex that was not offered.",
  ].join("\n");
}

export function intentUserPrompt(params: {
  stage: string;
  options: string[];
  message: string;
}): string {
  const optionsBlock =
    params.options.length > 0
      ? params.options.map((o, i) => `${i + 1}. ${o}`).join("\n")
      : "(none)";
  return [
    `Current step: ${params.stage}`,
    `Offered options:\n${optionsBlock}`,
    `Patient message: "${params.message}"`,
  ].join("\n\n");
}
