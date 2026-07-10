/**
 * Normalizes a phone number to a digits-only canonical form.
 * Accepts local formats with spaces, dashes, parentheses, and leading '+'.
 * Returns null when the input cannot be a valid phone number.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!/^[+\d][\d\s\-().]*$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  // Indonesian convention: local '08xx' -> international '628xx'.
  if (digits.startsWith("08")) {
    digits = "62" + digits.slice(1);
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}
