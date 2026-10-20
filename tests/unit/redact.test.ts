import { describe, expect, it } from "vitest";
import { redact } from "../../src/core/redact";

describe("redact", () => {
  it.each([
    ["sk-or-v1-0123456789abcdef0123456789abcdef"],
    ["gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"],
    ["AIzaSyA-1234567890abcdefghijklmnopqrs"],
    ["oma_abcdefghijklmnop"],
    ["sk-abcdefghijklmnop1234"],
    ["0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
  ])("hides %s", (secret) => {
    const out = redact(`key=${secret} done`);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  it("leaves ordinary log text alone", () => {
    const line = "groq: added to OmniRoute {\"connectionId\":\"3f1c\",\"path\":\"C:\\\\Users\\\\me\\\\AppData\"}";
    expect(redact(line)).toBe(line);
  });
});
