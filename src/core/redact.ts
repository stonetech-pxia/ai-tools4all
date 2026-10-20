// Safety net for anything that reaches a log or an error message. Keys should
// never be passed to the logger in the first place; this catches mistakes.
const PATTERNS: RegExp[] = [
  /sk-or-[A-Za-z0-9_-]{8,}/g, // OpenRouter
  /gsk_[A-Za-z0-9_-]{8,}/g, // Groq
  /AIza[0-9A-Za-z_-]{20,}/g, // Google
  /oma_[A-Za-z0-9_-]{8,}/g, // OmniRoute access token
  /sk-[A-Za-z0-9_-]{16,}/g, // generic OpenAI-style (incl. OmniRoute gateway keys)
  /\b[A-Za-z0-9_-]{32,}\b/g, // any other long opaque token
];

export function redact(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}
