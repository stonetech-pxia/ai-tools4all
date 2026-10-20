import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveToken } from "../../src/core/omniroute/machineToken";

describe("machine token", () => {
  it("is HMAC-SHA256 keyed by the machine id over the salt, hex (docs/security/CLI_TOKEN.md)", () => {
    const salt = "a".repeat(64);
    expect(deriveToken("machine-123", salt)).toBe(createHmac("sha256", "machine-123").update(salt).digest("hex"));
    expect(deriveToken("machine-123", salt)).toHaveLength(64);
  });
});
