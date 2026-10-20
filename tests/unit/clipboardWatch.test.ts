import { describe, expect, it } from "vitest";
import { watchClipboardForKey } from "../../src/core/clipboardWatch";

const KEY = "gsk_abcdefghijklmnopqrstuvwx12";
const PATTERN = "gsk_[A-Za-z0-9]{20,}";

function fakeClipboard(initial: string) {
  const c = { text: initial, read: () => c.text, write: (t: string) => void (c.text = t) };
  return c;
}
const later = (ms: number, fn: () => void) => setTimeout(fn, ms);

describe("watchClipboardForKey", () => {
  it("ignores what was already on the clipboard", async () => {
    const clip = fakeClipboard(KEY);
    const ac = new AbortController();
    const watching = watchClipboardForKey(PATTERN, clip, ac.signal, 5);
    later(40, () => ac.abort(new Error("stop")));
    await expect(watching).rejects.toThrow("stop");
    expect(clip.text).toBe(KEY); // untouched
  });

  it("takes a newly copied key (trimmed) and clears it from the clipboard", async () => {
    const clip = fakeClipboard("some earlier text");
    const watching = watchClipboardForKey(PATTERN, clip, new AbortController().signal, 5);
    later(20, () => clip.write(`  ${KEY}\n`));
    await expect(watching).resolves.toBe(KEY);
    expect(clip.text).toBe("");
  });

  it("does not take text that merely contains a key, or other providers' keys", async () => {
    const clip = fakeClipboard("");
    const ac = new AbortController();
    const watching = watchClipboardForKey(PATTERN, clip, ac.signal, 5);
    later(15, () => clip.write(`my key is ${KEY}`));
    later(30, () => clip.write("sk-or-v1-0123456789abcdef0123456789"));
    later(60, () => ac.abort(new Error("stop")));
    await expect(watching).rejects.toThrow("stop");
    expect(clip.text).toBe("sk-or-v1-0123456789abcdef0123456789");
  });
});
