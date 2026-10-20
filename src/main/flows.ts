import { BrowserWindow, screen } from "electron";
import type { ClipboardAccess } from "../core/clipboardWatch";
import { keyName, registerStep, validateStep } from "../core/commonSteps";
import { ActionBus, runFlow, type FlowResult, type UserAction } from "../core/flow";
import { log } from "../core/log";
import type { OmniRouteClient, TestResult } from "../core/omniroute/client";
import type { State } from "../core/stateMachine";
import { has, t } from "../i18n";
import type { OverlayButton } from "../overlay/protocol";
import { getProvider } from "../providers";
import type { ProviderConfig } from "../providers/types";
import type { FlowView, ResultView, UiState } from "../ui/types";
import { browserHandlers } from "./browserDriver";
import { guidedHandlers } from "./guidedDriver";
import { GuidedWindow } from "./guidedWindow";
import { oauthHandlers } from "./oauthDriver";
import { hasPurchasedCredits } from "../providers/openrouter/account";
import type { TestOverrides } from "./testOverrides";

type Mode = "oauth" | "browser" | "guided";
type Queue = { id: string; name: string; status: "done" | "skipped" | "current" | "todo" }[];

export interface FlowEnv {
  push(s: UiState): void;
  wizard(): BrowserWindow | null;
  overrides: TestOverrides;
  clipboard: ClipboardAccess;
  openExternal(url: string): Promise<void>;
}

export interface FlowsOutcome {
  services: ResultView["services"];
  done: ProviderConfig[];
  warnings: string[]; // localized, shown on the result page
}

export function providerConfig(id: string, overrides: TestOverrides): ProviderConfig {
  const base = getProvider(id);
  const o = overrides.providers?.[id];
  return o ? { ...base, ...o, urls: { ...base.urls, ...o.urls }, validate: { ...base.validate, ...o.validate }, oauth: base.oauth && { ...base.oauth, ...o.oauth }, guided: base.guided && { ...base.guided, ...o.guided } } : base;
}

// Runs the selected providers one after another and reports what happened.
export class Flows {
  private bus: ActionBus | null = null;
  private allowReopen: () => void = () => undefined;
  // Asked once per run, the first time a key is to be picked up from the clipboard.
  private clipboardConsent: boolean | null = null;
  private normalBounds: Electron.Rectangle | null = null;
  private warnings: string[] = [];

  constructor(private env: FlowEnv) {}

  action(a: UserAction): void {
    if (a.type === "retry") this.allowReopen();
    this.bus?.emit(a);
  }

  async run(ids: string[], omni: OmniRouteClient): Promise<FlowsOutcome> {
    const queue: Queue = ids.map((id) => ({ id, name: providerConfig(id, this.env.overrides).displayName, status: "todo" }));
    const services: ResultView["services"] = [];
    const done: ProviderConfig[] = [];
    this.warnings = [];

    for (const item of queue) {
      const p = providerConfig(item.id, this.env.overrides);
      item.status = "current";
      let outcome = await this.runProvider(p, p.kind, omni, queue);
      if (outcome.status === "switched" && p.guidedSteps) {
        log("info", `${p.id}: switching to the helper window`);
        outcome = await this.runProvider(p, "guided", omni, queue);
      }
      item.status = outcome.status === "done" ? "done" : "skipped";
      const test = outcome.test;
      services.push({ name: p.displayName, status: outcome.status !== "done" ? "skipped" : test && !test.valid && !test.skipped ? "failed" : "ok" });
      if (outcome.status === "done") done.push(p);
    }
    return { services, done, warnings: this.warnings };
  }

  // While the user works in their own browser, the wizard becomes a small
  // window that stays on top, next to it.
  private setCompact(on: boolean): void {
    const wizard = this.env.wizard();
    if (!wizard || on === !!this.normalBounds) return;
    if (on) {
      this.normalBounds = wizard.getBounds();
      const area = screen.getDisplayMatching(this.normalBounds).workArea;
      const width = 400;
      const height = Math.min(640, area.height - 40);
      wizard.setBounds({ x: area.x + area.width - width - 20, y: area.y + area.height - height - 20, width, height });
      wizard.setAlwaysOnTop(true, "floating");
    } else {
      wizard.setAlwaysOnTop(false);
      wizard.setBounds(this.normalBounds!);
      this.normalBounds = null;
    }
  }

  private buttonsFor(p: ProviderConfig, mode: Mode, state: State): FlowView["buttons"] {
    const canSwitch = mode === "browser" && !!p.guidedSteps ? (["switch"] as const) : [];
    switch (state) {
      case "CONFIRM_CREATE":
        return ["confirm", "paste", "skip"];
      case "WAIT_USER_AUTH":
        return ["done", "paste", "skip"];
      case "CREATE_AND_CAPTURE":
        if (mode === "browser" && this.clipboardConsent === null) return ["clipboardYes", "clipboardNo", ...canSwitch, "skip"];
        return mode === "guided" ? ["paste", "skip"] : ["reopen", "paste", ...canSwitch, "skip"];
      case "VALIDATE":
      case "REGISTER":
        return ["skip"];
      case "FAILED_MANUAL":
        return ["paste", "retry", ...canSwitch, "skip"];
      default:
        return ["paste", "skip"];
    }
  }

  private hintFor(p: ProviderConfig, mode: Mode, state: State): string {
    const vars = { keyName: keyName(), provider: p.displayName, keysUrl: p.urls.keys };
    if (state === "FAILED_MANUAL") return t(`hint.manual.${p.id}`, vars);
    if (mode === "browser" && state === "CREATE_AND_CAPTURE") {
      if (this.clipboardConsent === null) return t("clipboard.ask", vars);
      return `${t(`hint.${p.id}.browser`, vars)} ${t(this.clipboardConsent ? "hint.browser.watching" : "hint.browser.pasteBelow")}`;
    }
    const keys = mode === "guided" ? [`hint.${p.id}.${state}`, `hint.${state}`] : [`hint.${p.id}.${mode}.${state}`, `hint.${p.id}.${state}`, `hint.${state}`];
    for (const k of keys) if (has(k)) return t(k, vars);
    return t(`step.${state}`);
  }

  private async runProvider(p: ProviderConfig, mode: Mode, omni: OmniRouteClient, queue: Queue): Promise<{ status: FlowResult["status"]; test: TestResult | null }> {
    const steps = mode === "guided" ? p.guidedSteps! : p.steps;
    const flowBus = (this.bus = new ActionBus());
    let guided: GuidedWindow | null = null;
    let overlayOk: boolean | null = mode === "guided" ? false : null;
    let test: TestResult | null = null;
    let current: { state: State; index: number; reason?: string } = { state: steps[0], index: 0 };

    const render = () => {
      const { state, index, reason } = current;
      const reasonText = reason ? (has(reason) ? t(reason) : reason) : undefined;
      const buttons = this.buttonsFor(p, mode, state);
      const progress = t("overlay.stepOf", { index: Math.min(index + 1, steps.length), total: steps.length });
      const hint = this.hintFor(p, mode, state);
      this.env.push({
        screen: "flow",
        flow: {
          provider: p.displayName,
          progress,
          hint,
          reason: reasonText,
          buttons,
          overlayOk,
          queue: queue.map((q) => ({ name: q.name, status: q.status })),
          steps: steps.map((s, i) => ({
            label: has(`step.${mode}.${s}`) ? t(`step.${mode}.${s}`) : t(`step.${s}`),
            status: state === "FAILED_MANUAL" ? (i < index ? "done" : i === index ? "failed" : "todo") : i < index ? "done" : i === index ? "current" : "todo",
          })),
        },
      });
      if (guided && !guided.closed) {
        guided.setOverlay({
          title: p.displayName,
          progress,
          hint,
          reason: reasonText,
          buttons: buttons.filter((b) => ["done", "skip", "paste", "confirm", "retry"].includes(b)) as OverlayButton[],
          labels: {
            done: t("btn.done"),
            skip: t("btn.skip"),
            paste: t("btn.paste"),
            confirmYes: t("btn.confirmYes"),
            confirmNo: t("btn.confirmNo"),
            retry: t("btn.retry"),
            submitKey: t("btn.submitKey"),
            pastePlaceholder: t("paste.placeholder"),
            minimize: t("btn.minimize"),
            expand: t("btn.expand"),
          },
        });
      }
    };

    // A window the user closed is only reopened when they ask (retry), never behind their back.
    let reopenAllowed = false;
    this.allowReopen = () => (reopenAllowed = true);
    const getWindow = () => {
      if (!guided || guided.closed) {
        if (guided && !reopenAllowed) throw new Error("reason.windowClosed");
        reopenAllowed = false;
        guided = new GuidedWindow(
          (a) => flowBus.emit(a),
          (ok) => {
            overlayOk = ok;
            render();
          },
        );
        // The window was just created; show the current step in its panel.
        render();
      }
      return guided;
    };

    const modeHandlers =
      mode === "oauth"
        ? oauthHandlers(p, this.env.openExternal)
        : mode === "browser"
          ? browserHandlers(p, {
              openExternal: this.env.openExternal,
              clipboard: this.env.clipboard,
              consent: { get: () => this.clipboardConsent, set: (v) => (this.clipboardConsent = v) },
              rerender: render,
            })
          : guidedHandlers(p, getWindow);
    const validate = validateStep(p);
    const handlers = {
      ...modeHandlers,
      VALIDATE:
        p.id === "openrouter"
          ? async (ctx: Parameters<typeof validate>[0]) => {
              const ev = await validate(ctx);
              if (ev.type === "NEXT" && ctx.key && (await hasPurchasedCredits(p.validate.url, ctx.key))) {
                log("warn", "openrouter: account has purchased credits");
                this.warnings.push(t("provider.openrouter.creditsWarning", { url: p.urls.keys }));
              }
              return ev;
            }
          : validate,
      REGISTER: registerStep(p, () => omni, (r) => (test = r)),
    };

    this.setCompact(mode !== "guided");
    try {
      const outcome = await runFlow(steps, handlers, flowBus, {
        state(state, info) {
          // FAILED_MANUAL keeps the index of the step that failed.
          current = { state, index: state === "FAILED_MANUAL" ? current.index : info.index, reason: info.reason };
          render();
          log("info", `${p.id} (${mode}): ${state}`, info.reason ? { reason: info.reason } : undefined);
        },
      });
      return { status: outcome.status, test };
    } finally {
      this.allowReopen = () => undefined;
      (guided as GuidedWindow | null)?.close();
      this.bus = null;
      this.setCompact(false);
    }
  }
}
