// Picks up a key the user copies in their own browser. Only runs while a flow
// is waiting for a key, only after the user agreed, and only accepts clipboard
// text that is exactly one key of the expected format. Clipboard contents are
// never logged.

export interface ClipboardAccess {
  read(): string;
  write(text: string): void;
}

export async function watchClipboardForKey(pattern: string, clipboard: ClipboardAccess, signal: AbortSignal, intervalMs = 700): Promise<string> {
  const exact = new RegExp(`^(?:${pattern})$`);
  // Whatever was on the clipboard before we started is not the new key.
  let last = clipboard.read();
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (signal.aborted) throw signal.reason;
    const now = clipboard.read();
    if (now === last) continue;
    last = now;
    const candidate = now.trim();
    if (exact.test(candidate)) {
      // Don't leave the key sitting on the clipboard (only if it's still ours).
      if (clipboard.read() === now) clipboard.write("");
      return candidate;
    }
  }
}
