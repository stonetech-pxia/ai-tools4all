import { t } from "../i18n";
import type { AutostartView, FlowView, HomeView, ProviderOption, ResultView, StartingView, UiAction, UiState } from "./types";

declare global {
  interface Window {
    onboard: { send(a: UiAction): void; onState(cb: (s: UiState) => void): void };
  }
}

const app = document.getElementById("app")!;
const send = (a: UiAction) => window.onboard.send(a);
let revealKey = false;
let selected: Set<string> | null = null; // initialised from the first provider list

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {}, ...children: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const { dataset, ...rest } = props;
  const e = Object.assign(document.createElement(tag), rest);
  if (dataset) Object.assign(e.dataset, dataset);
  for (const c of children) if (c) e.append(c);
  return e;
}

function button(label: string, onClick: () => void, primary = false, disabled = false): HTMLButtonElement {
  const b = h("button", { textContent: label, className: primary ? "primary" : "", disabled });
  b.addEventListener("click", onClick);
  return b;
}

// Text field + submit; keeps what the user typed across re-renders.
function secretInput(id: string, placeholder: string, submitLabel: string, onSubmit: (v: string) => void): HTMLElement {
  const input = h("input", { type: "password", placeholder, autocomplete: "off", dataset: { keep: id } });
  const go = () => {
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    onSubmit(v);
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  return h("div", { className: "row" }, input, button(submitLabel, go, true));
}

function copyButton(onCopy: () => void): HTMLButtonElement {
  const b = button(t("result.copy"), () => {
    onCopy();
    b.textContent = t("result.copied");
    setTimeout(() => (b.textContent = t("result.copy")), 1500);
  });
  return b;
}

function secretRow(value: string, masked: boolean, onCopy: () => void, revealable: boolean): HTMLElement {
  const shown = masked ? value.slice(0, 6) + "•".repeat(Math.max(8, value.length - 10)) + value.slice(-4) : value;
  const row = h("div", { className: "row" }, h("span", { className: "secret", textContent: shown }), copyButton(onCopy));
  if (revealable)
    row.append(
      button(revealKey ? t("result.hide") : t("result.show"), () => {
        revealKey = !revealKey;
        render(state);
      }),
    );
  return row;
}

function autostartCard(a: AutostartView): HTMLElement {
  const card = h("div", { className: "card" });
  if (!a.available) {
    card.append(h("p", { className: "muted", textContent: t("autostart.devOnly") }));
    return card;
  }
  const box = h("input", { type: "checkbox", checked: a.on });
  box.addEventListener("change", () => send({ type: "setAutostart", on: box.checked }));
  card.append(h("label", { className: "choice" }, box, h("span", {}, h("b", { textContent: t("autostart.label") }), h("br"), h("span", { className: "muted", textContent: t("autostart.why") }))));
  return card;
}

function starting(s: StartingView): Node[] {
  const card = h("div", { className: "card" });
  if (s.status === "starting") {
    card.append(h("p", { textContent: t("starting.body") }));
    if (s.firstRun) card.append(h("p", { className: "muted", textContent: t("starting.firstRun") }));
  } else {
    card.append(h("p", { className: "error", textContent: s.message ?? t("starting.failed") }), h("div", { className: "row" }, button(t("env.retry"), () => send({ type: "starting:retry" }), true)));
  }
  return [h("h1", { textContent: t("app.title") }), card];
}

function welcome(): Node[] {
  return [
    h("h1", { textContent: t("welcome.title") }),
    h("div", { className: "card" }, h("p", { textContent: t("welcome.body") }), h("p", { className: "muted", textContent: t("welcome.howItWorks") }), h("div", { className: "row" }, button(t("welcome.start"), () => send({ type: "start" }), true))),
  ];
}

function select(providers: ProviderOption[], notices: string[]): Node[] {
  if (!selected) selected = new Set(providers.filter((p) => !p.connected).map((p) => p.id));
  const sel = selected;
  const list = h("div", { className: "card" }, h("p", { textContent: t("select.body") }));
  for (const p of providers) {
    const box = h("input", { type: "checkbox", checked: !p.connected && sel.has(p.id), disabled: p.connected });
    box.addEventListener("change", () => {
      if (box.checked) sel.add(p.id);
      else sel.delete(p.id);
      render(state);
    });
    list.append(h("label", { className: "choice" }, box, h("span", {}, h("b", { textContent: p.name }), p.connected && h("span", { className: "ok", textContent: `  ${t("select.connected")}` }), h("br"), h("span", { className: "muted", textContent: p.blurb }))));
  }
  const ids = providers.filter((p) => !p.connected && sel.has(p.id)).map((p) => p.id);
  list.append(
    h(
      "div",
      { className: "row" },
      button(t("select.continue"), () => send({ type: "select:go", ids }), true, ids.length === 0),
      button(t("select.back"), () => send({ type: "select:back" })),
      ids.length === 0 && h("span", { className: "muted", textContent: t("select.none") }),
    ),
  );
  const noticeCard = h("div", { className: "card" }, h("h2", { textContent: t("notice.title") }), h("ul", {}, ...notices.map((n) => h("li", { textContent: n }))));
  return [h("h1", { textContent: t("select.title") }), noticeCard, list];
}

function flow(f: FlowView): Node[] {
  const card = h("div", { className: "card" });
  card.append(h("h2", { textContent: `${f.provider} · ${f.progress}` }), h("p", { textContent: f.hint }));
  if (f.reason) card.append(h("p", { className: "error", textContent: f.reason }));
  if (f.overlayOk === false) card.append(h("p", { className: "muted", textContent: t("flow.overlayMissing") }));

  const row = h("div", { className: "row" });
  if (f.buttons.includes("confirm")) row.append(button(t("btn.confirmYes"), () => send({ type: "flow:confirm", yes: true }), true), button(t("btn.confirmNo"), () => send({ type: "flow:confirm", yes: false })));
  if (f.buttons.includes("clipboardYes")) row.append(button(t("btn.clipboardYes"), () => send({ type: "flow:clipboard", allow: true }), true), button(t("btn.clipboardNo"), () => send({ type: "flow:clipboard", allow: false })));
  if (f.buttons.includes("done")) row.append(button(t("btn.done"), () => send({ type: "flow:done" }), true));
  if (f.buttons.includes("reopen")) row.append(button(t("btn.openBrowserAgain"), () => send({ type: "flow:done" })));
  if (f.buttons.includes("retry")) row.append(button(t("btn.retry"), () => send({ type: "flow:retry" })));
  if (f.buttons.includes("switch")) row.append(button(t("btn.switch"), () => send({ type: "flow:switch" })));
  if (f.buttons.includes("skip")) row.append(button(t("btn.skip"), () => send({ type: "flow:skip" })));
  card.append(row);
  if (f.buttons.includes("paste")) card.append(secretInput("providerKey", t("paste.placeholder"), t("btn.submitKey"), (key) => send({ type: "flow:paste", key })));

  const steps = h("ul", { className: "steps" }, ...f.steps.map((s) => h("li", { className: s.status, textContent: s.label })));
  const queue = h("p", { className: "muted queue", textContent: f.queue.map((q) => `${q.name}: ${q.status === "done" ? "✓" : q.status === "skipped" ? t("result.skipped") : q.status === "current" ? "…" : "·"}`).join("   ") });
  return [h("h1", { textContent: f.provider }), card, h("div", { className: "card" }, steps, queue)];
}

function result(r: ResultView): Node[] {
  const out: Node[] = [h("h1", { textContent: t("result.title") })];
  const connected = r.services.some((s) => s.status !== "skipped");
  if (!connected) out.push(h("div", { className: "card" }, h("p", { textContent: t("result.noneConnected") })));
  else {
    const card = h("div", { className: "card" }, h("h2", { textContent: t("result.baseUrl") }), secretRow(r.baseUrl, false, () => send({ type: "result:copy", what: "baseUrl" }), false), h("h2", { textContent: t("result.apiKey") }));
    if (r.apiKey) card.append(secretRow(r.apiKey, !revealKey, () => send({ type: "result:copy", what: "apiKey" }), true), h("p", { className: "warn", textContent: t("result.keyOnce") }));
    if (r.keyError) card.append(h("p", { className: "error", textContent: r.keyError }));
    card.append(h("p", { className: "muted", textContent: t("result.howToUse") }));
    out.push(card);
  }
  out.push(
    h(
      "div",
      { className: "card" },
      h("h2", { textContent: t("result.services") }),
      h("ul", {}, ...r.services.map((s) => h("li", { textContent: `${s.name}: ${s.status === "ok" ? t("result.testOk") : s.status === "failed" ? t("result.testFailed") : t("result.skipped")}` }))),
      ...r.notes.map((n) => h("p", { className: "muted", textContent: n })),
    ),
  );
  if (connected) out.push(autostartCard(r.autostart));
  const cleanup = h("div", { className: "card" });
  if (r.cleanup === "ask") cleanup.append(h("p", { textContent: t("result.cleanupQuestion") }), h("div", { className: "row" }, button(t("result.cleanupYes"), () => send({ type: "result:cleanup", yes: true })), button(t("result.cleanupNo"), () => send({ type: "result:cleanup", yes: false }))));
  else {
    if (r.cleanup === "done") cleanup.append(h("p", { className: "muted", textContent: t("result.cleanupDone") }));
    cleanup.append(h("div", { className: "row" }, button(t("result.close"), () => send({ type: "result:done" }), true)));
  }
  out.push(cleanup);
  return out;
}

function home(v: HomeView): Node[] {
  const status = h("div", { className: "card" });
  const running = v.omniroute === "running";
  status.append(h("p", { className: running ? "ok" : v.omniroute === "failed" ? "error" : "", textContent: t(`home.status.${v.omniroute}`) }));
  if (running) {
    status.append(h("h2", { textContent: t("result.baseUrl") }), secretRow(v.baseUrl, false, () => send({ type: "home:copy", what: "baseUrl" }), false), h("p", { className: "muted", textContent: t("home.keyHint") }));
  } else if (v.omniroute === "failed" || v.omniroute === "stopped") {
    status.append(h("div", { className: "row" }, button(t("home.restart"), () => send({ type: "home:restart" }), true)));
  }

  const keyCard = h("div", { className: "card" }, h("h2", { textContent: t("result.apiKey") }));
  if (v.newKey) keyCard.append(secretRow(v.newKey, !revealKey, () => send({ type: "home:copy", what: "newKey" }), true), h("p", { className: "warn", textContent: t("result.keyOnce") }));
  if (v.keyError) keyCard.append(h("p", { className: "error", textContent: v.keyError }));
  keyCard.append(h("div", { className: "row" }, button(t("home.newKey"), () => send({ type: "home:newKey" }), !v.newKey, !running)));

  const services = h(
    "div",
    { className: "card" },
    h("h2", { textContent: t("result.services") }),
    h("ul", {}, ...v.services.map((s) => h("li", { textContent: `${s.name}: ${t(`home.service.${s.status}`)}` }))),
    h("div", { className: "row" }, button(t("home.addServices"), () => send({ type: "home:addServices" }), false, !running)),
  );

  const dashboard = h(
    "div",
    { className: "card" },
    h("h2", { textContent: t("home.dashboard") }),
    h("p", { className: "muted", textContent: t("home.dashboardHint") }),
    h("div", { className: "row" }, button(t("home.openDashboard"), () => send({ type: "home:openDashboard" }), false, !running), copyButton(() => send({ type: "home:copy", what: "password" }))),
  );
  const quit = h("div", { className: "row" }, button(t("home.quit"), () => send({ type: "quit" })));
  return [h("h1", { textContent: t("app.title") }), status, keyCard, services, autostartCard(v.autostart), dashboard, quit];
}

let state: UiState = { screen: "starting", starting: { status: "starting", firstRun: false } };

function render(s: UiState): void {
  if (s.screen !== state.screen) revealKey = false;
  if (s.screen === "select" && state.screen !== "select") selected = null;
  state = s;
  const kept = new Map<string, string>();
  app.querySelectorAll<HTMLInputElement>("input[data-keep]").forEach((i) => kept.set(i.dataset.keep!, i.value));
  const focused = (document.activeElement as HTMLInputElement | null)?.dataset?.keep;

  const nodes =
    s.screen === "starting"
      ? starting(s.starting)
      : s.screen === "welcome"
        ? welcome()
        : s.screen === "select"
          ? select(s.providers, s.notices)
          : s.screen === "flow"
            ? flow(s.flow)
            : s.screen === "result"
              ? result(s.result)
              : home(s.home);
  app.replaceChildren(...nodes);

  app.querySelectorAll<HTMLInputElement>("input[data-keep]").forEach((i) => {
    i.value = kept.get(i.dataset.keep!) ?? "";
    if (i.dataset.keep === focused) i.focus();
  });
}

document.title = t("app.title");
window.onboard.onState(render);
render(state);
