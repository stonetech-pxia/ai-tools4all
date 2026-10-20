import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redact } from "./redact";

type Level = "info" | "warn" | "error";

let logFile: string | null = null;

export function setLogFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  logFile = path;
}

function describe(detail: unknown): string {
  if (detail === undefined) return "";
  if (detail instanceof Error) return ` ${detail.name}: ${detail.message}`;
  try {
    return " " + JSON.stringify(detail);
  } catch {
    return " " + String(detail);
  }
}

export function log(level: Level, message: string, detail?: unknown): void {
  const line = redact(`${new Date().toISOString()} [${level}] ${message}${describe(detail)}`);
  if (level === "error") console.error(line);
  else console.log(line);
  if (logFile) {
    try {
      appendFileSync(logFile, line + "\n");
    } catch {
      // Logging must never break the wizard.
    }
  }
}
