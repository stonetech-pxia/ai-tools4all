import { randomBytes } from "node:crypto";
import type { StepHandler } from "../core/flow";
import { keyName } from "../core/commonSteps";
import { log } from "../core/log";
import type { Step } from "../core/stateMachine";
import { t } from "../i18n";
import { buildAuthUrl, createPkce, exchangeCode, startCallbackServer, type CallbackServer } from "../providers/openrouter/oauth";
import type { ProviderConfig } from "../providers/types";

const OAUTH_TIMEOUT_MS = 10 * 60_000; // OpenRouter codes expire after 10 minutes anyway

// OpenRouter: the user approves in their own default browser; nothing is automated.
export function oauthHandlers(p: ProviderConfig, openExternal: (url: string) => Promise<void>): Partial<Record<Step, StepHandler>> {
  if (!p.oauth) throw new Error(`${p.id} has no oauth config`);
  const exchangeUrl = p.oauth.exchangeUrl;
  let pkce: { verifier: string; challenge: string } | null = null;
  let server: CallbackServer | null = null;
  let authUrl = "";

  const begin = async () => {
    cleanup();
    pkce = createPkce();
    const state = randomBytes(16).toString("hex");
    server = await startCallbackServer(state, { done: t("callback.done"), error: t("callback.error") });
    authUrl = buildAuthUrl(p.urls.signup, { callbackUrl: server.callbackUrl, challenge: pkce.challenge, state, keyLabel: keyName() });
    await openExternal(authUrl);
  };

  const cleanup = () => {
    server?.close();
    server = null;
    pkce = null;
  };

  return {
    CONFIRM_CREATE: async (ctx) => {
      const answer = await ctx.bus.wait(["confirm"], ctx.signal);
      return answer.yes ? { type: "NEXT" } : { type: "SKIP" };
    },

    OPEN_SIGNUP: async () => {
      await begin();
      return { type: "NEXT" };
    },

    CREATE_AND_CAPTURE: async (ctx) => {
      // Retrying from manual mode lands here with no pending authorization.
      if (!server || !pkce) await begin();
      const srv = server!;
      const verifier = pkce!.verifier;
      try {
        const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("reason.oauthFailed")), OAUTH_TIMEOUT_MS).unref());
        const aborted = new Promise<never>((_, rej) => ctx.signal.addEventListener("abort", () => rej(ctx.signal.reason), { once: true }));
        // "Open the browser again" while waiting.
        const reopen = async (): Promise<never> => {
          for (;;) {
            await ctx.bus.wait(["done"], ctx.signal);
            await openExternal(authUrl);
          }
        };
        const code = await Promise.race([srv.code, timeout, aborted, reopen()]);
        ctx.key = await exchangeCode(exchangeUrl, code, verifier);
        log("info", `${p.id}: key received via OAuth`);
        return { type: "NEXT" };
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        log("warn", `${p.id}: OAuth failed`, err);
        return { type: "FAIL", reason: "reason.oauthFailed" };
      } finally {
        cleanup();
      }
    },
  };
}
