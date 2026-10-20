import { createHmac } from "node:crypto";
import { machineIdSync } from "node-machine-id";

// OmniRoute's local machine token (docs/security/CLI_TOKEN.md):
// HMAC-SHA256(key = raw machine id, data = salt), hex, accepted only from
// loopback. We start OmniRoute with our own salt (OMNIROUTE_CLI_SALT), and the
// OmniRoute version is pinned, so a change to this scheme can't surprise users.

export const CLI_TOKEN_HEADER = "x-omniroute-cli-token";

export function deriveToken(machineId: string, salt: string): string {
  return createHmac("sha256", machineId).update(salt).digest("hex");
}

export function readMachineId(): string | null {
  try {
    // Same library and call OmniRoute uses, so both sides see the same id.
    return machineIdSync(true) || null;
  } catch {
    return null;
  }
}
