// Preload for the guided service window. It runs in Electron's isolated world:
// it shares the page's DOM but not its JavaScript, and nothing here is exposed
// to the page, so the site's scripts can't talk to the main process.
import { ipcRenderer } from "electron";
import type { ElementSpec } from "../providers/types";
import { CH, type OverlayCommand, type OverlayCommandResult, type OverlayState } from "./protocol";

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let state: OverlayState | null = null;
let minimized = false;
let pasteOpen = false;
let position: { right: number; bottom: number } = { right: 16, bottom: 16 };

const CSS = `
  :host { all: initial; }
  .panel { position: fixed; z-index: 2147483647; width: 320px; font: 14px/1.45 system-ui, sans-serif;
    color: #1d1d1f; background: #fff; border: 1px solid #c9c9d1; border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,.18); overflow: hidden; }
  .head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #2b4acb; color: #fff; cursor: move; user-select: none; }
  .head b { flex: 1; font-size: 13px; }
  .head button { all: unset; cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,.2); }
  .body { padding: 12px; display: grid; gap: 10px; }
  .progress { font-size: 12px; color: #5a5a66; }
  .reason { color: #a3261b; background: #fdeceb; padding: 6px 8px; border-radius: 6px; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; }
  .btn { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 6px; border: 1px solid #c9c9d1; background: #f4f4f7; font-size: 13px; }
  .btn.primary { background: #2b4acb; border-color: #2b4acb; color: #fff; }
  input { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid #c9c9d1; border-radius: 6px; font: inherit; }
  @media (prefers-color-scheme: dark) {
    .panel { color: #ececf1; background: #1e1e24; border-color: #3a3a44; }
    .progress { color: #a6a6b3; }
    .btn { background: #2a2a33; border-color: #3a3a44; color: #ececf1; }
    .reason { color: #ffb4ab; background: #3b1d1a; }
    input { background: #2a2a33; color: #ececf1; border-color: #3a3a44; }
  }
`;

function ensureHost(): void {
  if (host?.isConnected) return;
  host = document.createElement("omniroute-onboard-overlay");
  root = host.attachShadow({ mode: "closed" });
  document.documentElement.appendChild(host);
  render();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function send(action: { type: string; yes?: boolean; key?: string }): void {
  ipcRenderer.send(CH.action, action);
}

function render(): void {
  if (!root || !state) return;
  const s = state;
  const L = (k: string) => s.labels[k] ?? k;
  root.replaceChildren();
  root.append(el("style", { textContent: CSS }));

  const panel = el("div", { className: "panel" });
  panel.style.right = `${position.right}px`;
  panel.style.bottom = `${position.bottom}px`;

  const toggle = el("button", { textContent: minimized ? L("expand") : L("minimize") });
  toggle.addEventListener("click", () => {
    minimized = !minimized;
    render();
  });
  const head = el("div", { className: "head" }, el("b", { textContent: `${s.title} · ${s.progress}` }), toggle);
  makeDraggable(head, panel);
  panel.append(head);

  if (!minimized) {
    const body = el("div", { className: "body" });
    body.append(el("div", { textContent: s.hint }));
    if (s.reason) body.append(el("div", { className: "reason", textContent: s.reason }));

    const row = el("div", { className: "row" });
    const button = (label: string, onClick: () => void, primary = false) => {
      const b = el("button", { className: primary ? "btn primary" : "btn", textContent: label });
      b.addEventListener("click", onClick);
      row.append(b);
    };
    if (s.buttons.includes("confirm")) {
      button(L("confirmYes"), () => send({ type: "confirm", yes: true }), true);
      button(L("confirmNo"), () => send({ type: "confirm", yes: false }));
    }
    if (s.buttons.includes("done")) button(L("done"), () => send({ type: "done" }), true);
    if (s.buttons.includes("retry")) button(L("retry"), () => send({ type: "retry" }));
    if (s.buttons.includes("paste")) button(L("paste"), () => ((pasteOpen = !pasteOpen), render()));
    if (s.buttons.includes("skip")) button(L("skip"), () => send({ type: "skip" }));
    body.append(row);

    if (pasteOpen && s.buttons.includes("paste")) {
      const input = el("input", { type: "password", placeholder: L("pastePlaceholder"), autocomplete: "off" });
      const submit = el("button", { className: "btn primary", textContent: L("submitKey") });
      const go = () => {
        const key = input.value.trim();
        input.value = "";
        if (key) {
          pasteOpen = false;
          send({ type: "paste", key });
        }
      };
      submit.addEventListener("click", go);
      input.addEventListener("keydown", (e) => e.key === "Enter" && go());
      body.append(input, submit);
    }
    panel.append(body);
  }
  root.append(panel);
}

function makeDraggable(handle: HTMLElement, panel: HTMLElement): void {
  handle.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    const start = { x: e.clientX, y: e.clientY, ...position };
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      position = {
        right: Math.max(0, Math.min(window.innerWidth - 80, start.right - (ev.clientX - start.x))),
        bottom: Math.max(0, Math.min(window.innerHeight - 40, start.bottom - (ev.clientY - start.y))),
      };
      panel.style.right = `${position.right}px`;
      panel.style.bottom = `${position.bottom}px`;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}

// ---- page commands (run in the isolated world, against the page's DOM) ----

function visible(e: Element): boolean {
  const r = (e as HTMLElement).getClientRects();
  return r.length > 0 && getComputedStyle(e).visibility !== "hidden";
}

function textOf(e: Element): string {
  return ((e as HTMLElement).innerText || e.getAttribute("aria-label") || (e as HTMLInputElement).value || "").trim().toLowerCase();
}

function findElement(spec: ElementSpec): HTMLElement | null {
  const nodes = document.querySelectorAll(spec.selector || "button, a, input");
  const wanted = spec.text?.map((t) => t.toLowerCase());
  for (const n of Array.from(nodes)) {
    if (n === host || !visible(n)) continue;
    if (!wanted) return n as HTMLElement;
    const txt = textOf(n);
    if (wanted.some((w) => txt === w || txt.startsWith(w))) return n as HTMLElement;
  }
  return null;
}

function scanKey(pattern: string): string | null {
  const re = new RegExp(pattern);
  for (const f of Array.from(document.querySelectorAll("input, textarea"))) {
    const m = re.exec((f as HTMLInputElement).value || "");
    if (m) return m[0];
  }
  for (const n of Array.from(document.querySelectorAll("[value]"))) {
    const m = re.exec(n.getAttribute("value") || "");
    if (m) return m[0];
  }
  const m = re.exec(document.body?.innerText || "");
  return m ? m[0] : null;
}

function runCommand(c: OverlayCommand): OverlayCommandResult {
  switch (c.cmd) {
    case "find":
      return { id: c.id, ok: !!findElement(c.spec) };
    case "click": {
      const e = findElement(c.spec);
      e?.click();
      return { id: c.id, ok: !!e };
    }
    case "focus": {
      const e = findElement(c.spec);
      e?.focus();
      return { id: c.id, ok: !!e && document.activeElement === e };
    }
    case "scanKey": {
      const key = scanKey(c.pattern);
      return { id: c.id, ok: !!key, value: key ?? undefined };
    }
  }
}

ipcRenderer.on(CH.state, (_e, s: OverlayState) => {
  state = s;
  if (!s.buttons.includes("paste")) pasteOpen = false;
  ensureHost();
  render();
});

ipcRenderer.on(CH.cmd, (_e, c: OverlayCommand) => {
  let result: OverlayCommandResult;
  try {
    result = runCommand(c);
  } catch {
    result = { id: c.id, ok: false };
  }
  ipcRenderer.send(CH.cmdResult, result);
});

function boot(): void {
  ensureHost();
  // Some sites rebuild <html> children; put the panel back if it gets removed.
  new MutationObserver(() => {
    if (host && !host.isConnected) ensureHost();
  }).observe(document.documentElement, { childList: true });
  ipcRenderer.send(CH.ready);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
