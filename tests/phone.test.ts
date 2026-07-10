import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/services/phone.js";

describe("normalizePhone", () => {
  it("normalizes formatted numbers to digits", () => {
    expect(normalizePhone("+62 812-3456-7890")).toBe("6281234567890");
    expect(normalizePhone("(0812) 3456 7890")).toBe("6281234567890");
  });

  it("converts local 08 prefix to 62", () => {
    expect(normalizePhone("081234567890")).toBe("6281234567890");
  });

  it("rejects garbage and wrong lengths", () => {
    expect(normalizePhone("hello")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("1234567890123456")).toBeNull();
  });
});
