import { watchClipboardForKey, type ClipboardAccess } from "../core/clipboardWatch";
import type { StepHandler } from "../core/flow";
import { log } from "../core/log";
import type { Step } from "../core/stateMachine";
import type { ProviderConfig } from "../providers/types";

export interface ClipboardConsent {
  get(): boolean | null; // null: not asked yet
  set(allow: boolean): void;
}

// The user works in their own everyday browser (their sign-ins, password
// manager and passkeys all apply). We open the keys page and wait for the key:
// picked up from the clipboard if the user agreed, otherwise pasted.
export function browserHandlers(
  p: ProviderConfig,
  deps: { openExternal: (url: string) => Promise<void>; clipboard: ClipboardAccess; consent: ClipboardConsent; rerender: () => void },
): Partial<Record<Step, StepHandler>> {
  return {
    OPEN_SIGNUP: async () => {
      await deps.openExternal(p.urls.keys);
      return { type: "NEXT" };
    },

    CREATE_AND_CAPTURE: async (ctx) => {
      if (deps.consent.get() === null) {
        const answer = await ctx.bus.wait(["clipboard"], ctx.signal);
        deps.consent.set(answer.allow);
        log("info", `clipboard detection ${answer.allow ? "allowed" : "declined"}`);
        deps.rerender();
      }

      // "Open the page again" while waiting.
      const reopen = (async (): Promise<never> => {
        for (;;) {
          await ctx.bus.wait(["done"], ctx.signal);
          await deps.openExternal(p.urls.keys);
        }
      })();
      reopen.catch(() => undefined);

      if (!deps.consent.get()) {
        // Wait for the pasted key; the flow runner handles "paste" and "skip".
        await new Promise<never>((_, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true }));
      }
      ctx.key = await watchClipboardForKey(p.keyPattern, deps.clipboard, ctx.signal);
      log("info", `${p.id}: key picked up from the clipboard`);
      return { type: "NEXT" };
    },
  };
}
