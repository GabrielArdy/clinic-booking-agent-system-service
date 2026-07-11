import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/services/password.js";

describe("password hashing", () => {
  it("round-trips a password", () => {
    const stored = hashPassword("S3cret-pass!");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("S3cret-pass!", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("S3cret-pass!");
    expect(verifyPassword("wrong-pass", stored)).toBe(false);
  });

  it("produces unique salts", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects malformed stored values", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "scrypt$bad")).toBe(false);
  });
});
