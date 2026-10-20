import type { FlowContext, StepHandler } from "../core/flow";
import { keyName } from "../core/commonSteps";
import { log } from "../core/log";
import type { Step } from "../core/stateMachine";
import type { ProviderConfig } from "../providers/types";
import { waitUntil, type GuidedWindow } from "./guidedWindow";

// Step handlers for services driven in the guided window, built from the
// provider's config file (URLs, element specs, timeouts).
export function guidedHandlers(p: ProviderConfig, getWindow: () => GuidedWindow): Partial<Record<Step, StepHandler>> {
  const g = p.guided;
  if (!g) throw new Error(`${p.id} has no guided config`);
  const loggedIn = new RegExp(g.loggedInUrl);
  const loggedOut = new RegExp(g.loggedOutUrl);
  const isLoggedIn = (w: GuidedWindow) => loggedIn.test(w.url()) && !loggedOut.test(w.url());

  const fail = (reason: string) => ({ type: "FAIL" as const, reason });
  const open = (w: GuidedWindow) => {
    if (w.closed) throw new Error("reason.windowClosed");
    return w;
  };
  // After a retry the window may be new and empty; put it on the right page.
  const ensurePage = async (w: GuidedWindow, url: string) => {
    if (!w.url() || w.url() === "about:blank") await w.load(url);
  };

  return {
    OPEN_SIGNUP: async () => {
      await getWindow().load(p.urls.signup);
      return { type: "NEXT" };
    },

    // Wait for the user to sign in. We only look at the URL; the user can also
    // tell us with "I'm done". Past the time limit we switch to manual mode,
    // which still offers "Try again", "Skip" and "Paste key".
    WAIT_USER_AUTH: async (ctx: FlowContext) => {
      const w = getWindow();
      await ensurePage(w, p.urls.signup);
      const done = ctx.bus.wait(["done"], ctx.signal).then(() => "done" as const);
      done.catch(() => undefined);
      const detected = waitUntil(() => isLoggedIn(open(w)) && !w.url().startsWith(p.urls.signup), g.timeouts.authMs, ctx.signal).then((ok) => (ok ? ("detected" as const) : ("timeout" as const)));
      const how = await Promise.race([done, detected]);
      if (how === "timeout") return fail("reason.authTimeout");
      log("info", `${p.id}: sign-in ${how === "done" ? "confirmed by user" : "detected"}`);
      return { type: "NEXT" };
    },

    GOTO_KEYS: async (ctx) => {
      const w = getWindow();
      await w.load(p.urls.keys);
      // "I'm done" was pressed but the site sent us back to sign-in: not signed in yet.
      if (loggedOut.test(w.url())) return fail("reason.notSignedIn");
      const found = await waitUntil(() => open(w).exists(g.createButton), g.timeouts.elementMs, ctx.signal);
      return found ? { type: "NEXT" } : fail("reason.elementNotFound");
    },

    CONFIRM_CREATE: async (ctx) => {
      const answer = await ctx.bus.wait(["confirm"], ctx.signal);
      return answer.yes ? { type: "NEXT" } : { type: "SKIP" };
    },

    CREATE_AND_CAPTURE: async (ctx) => {
      const w = getWindow();
      await ensurePage(w, p.urls.keys);
      if (!(await waitUntil(() => open(w).exists(g.createButton), g.timeouts.elementMs, ctx.signal))) return fail("reason.elementNotFound");
      if (!(await w.click(g.createButton))) return fail("reason.elementNotFound");
      if (!(await waitUntil(() => open(w).exists(g.nameInput), g.timeouts.elementMs, ctx.signal))) return fail("reason.elementNotFound");
      await w.type(g.nameInput, keyName());
      if (!(await w.click(g.submitButton))) return fail("reason.elementNotFound");

      let key: string | null = null;
      await waitUntil(async () => !!(key = await open(w).scanKey(p.keyPattern)), g.timeouts.keyMs, ctx.signal);
      if (!key) return fail("reason.keyNotFound");
      ctx.key = key;
      log("info", `${p.id}: key captured from page`);
      return { type: "NEXT" };
    },
  };
}
