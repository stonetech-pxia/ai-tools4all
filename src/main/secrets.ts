import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ServerSecrets } from "../core/omniroute/host";

// The secrets our OmniRoute runs with. Created once, then kept for good:
// a new storage key would make every saved provider key unreadable.
// Encrypted with the OS keychain (Windows DPAPI, macOS Keychain, Linux
// libsecret) when available.

export interface SecretBox {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

export class SecretsUnreadableError extends Error {
  constructor(cause: unknown) {
    super(`saved settings could not be read (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = "SecretsUnreadableError";
  }
}

interface FileFormat {
  v: 1;
  encrypted: boolean;
  data: string; // base64 of (encrypted) JSON
}

export function generateSecrets(): ServerSecrets {
  const hex = (n: number) => randomBytes(n).toString("hex");
  return {
    jwtSecret: hex(64),
    storageKey: hex(32),
    apiKeySecret: hex(32),
    cliSalt: hex(32),
    password: randomBytes(18).toString("base64url"),
  };
}

export function loadOrCreateSecrets(file: string, box: SecretBox): { secrets: ServerSecrets; encrypted: boolean; created: boolean } {
  if (existsSync(file)) {
    // Never silently regenerate: that would orphan everything OmniRoute stored.
    try {
      const f = JSON.parse(readFileSync(file, "utf8")) as FileFormat;
      const raw = Buffer.from(f.data, "base64");
      const json = f.encrypted ? box.decryptString(raw) : raw.toString("utf8");
      return { secrets: JSON.parse(json) as ServerSecrets, encrypted: f.encrypted, created: false };
    } catch (err) {
      throw new SecretsUnreadableError(err);
    }
  }
  const secrets = generateSecrets();
  const encrypted = box.isEncryptionAvailable();
  const json = JSON.stringify(secrets);
  const data = (encrypted ? box.encryptString(json) : Buffer.from(json, "utf8")).toString("base64");
  mkdirSync(dirname(file), { recursive: true });
  // Write-then-rename so a crash can't leave a half-written file behind.
  writeFileSync(file + ".tmp", JSON.stringify({ v: 1, encrypted, data } satisfies FileFormat), { mode: 0o600 });
  renameSync(file + ".tmp", file);
  return { secrets, encrypted, created: true };
}
