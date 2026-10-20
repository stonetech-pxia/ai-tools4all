import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateSecrets, SecretsUnreadableError, type SecretBox } from "../../src/main/secrets";

// Stand-in for Electron's safeStorage: reversible, but not plain text.
const box = (available = true): SecretBox => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(s, "utf8").reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString("utf8"),
});
const file = () => join(mkdtempSync(join(tmpdir(), "secrets-")), "secrets.json");

describe("secrets", () => {
  it("creates strong secrets once and returns the same ones afterwards", () => {
    const f = file();
    const first = loadOrCreateSecrets(f, box());
    expect(first.created).toBe(true);
    expect(first.secrets.storageKey).toMatch(/^[0-9a-f]{64}$/);
    expect(first.secrets.cliSalt).toMatch(/^[0-9a-f]{64}$/);
    expect(first.secrets.password.length).toBeGreaterThanOrEqual(20);
    const again = loadOrCreateSecrets(f, box());
    expect(again.created).toBe(false);
    expect(again.secrets).toEqual(first.secrets);
  });

  it("stores them encrypted when the OS keychain is available", () => {
    const f = file();
    const { secrets } = loadOrCreateSecrets(f, box(true));
    const raw = readFileSync(f, "utf8");
    expect(raw).not.toContain(secrets.storageKey);
    expect(Buffer.from(JSON.parse(raw).data, "base64").toString("utf8")).not.toContain(secrets.storageKey);
  });

  it("falls back to an unencrypted file when no keychain exists", () => {
    const f = file();
    const r = loadOrCreateSecrets(f, box(false));
    expect(r.encrypted).toBe(false);
    expect(loadOrCreateSecrets(f, box(false)).secrets).toEqual(r.secrets);
  });

  it("never replaces secrets it cannot read (that would orphan stored keys)", () => {
    const f = file();
    loadOrCreateSecrets(f, box());
    const before = readFileSync(f, "utf8");
    const broken: SecretBox = { ...box(), decryptString: () => { throw new Error("wrong user"); } };
    expect(() => loadOrCreateSecrets(f, broken)).toThrow(SecretsUnreadableError);
    expect(readFileSync(f, "utf8")).toBe(before);
    writeFileSync(f, "not json");
    expect(() => loadOrCreateSecrets(f, box())).toThrow(SecretsUnreadableError);
  });
});
