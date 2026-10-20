import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from "electron";
import { join } from "node:path";
import type { UserAction } from "../core/flow";
import { CH, type OverlayCommandBody, type OverlayCommandResult, type OverlayState } from "../overlay/protocol";
import type { ElementSpec } from "../providers/types";

export const GUIDED_PARTITION = "persist:omniroute-onboard";

// A visible browser window for one service, with the help panel injected into
// every page. Uses its own session partition: no cookies from the user's
// everyday browser, and nothing shared with it.
export class GuidedWindow {
  readonly win: BrowserWindow;
  private readonly wc: WebContents;
  private isClosed = false;
  private nextId = 1;
  private pending = new Map<number, (r: OverlayCommandResult) => void>();
  private overlayState: OverlayState | null = null;
  overlayReady = false;

  constructor(onAction: (a: UserAction) => void, onOverlayHealth: (ok: boolean) => void) {
    this.win = new BrowserWindow({
      width: 1200,
      height: 860,
      title: "OmniRoute Setup",
      webPreferences: {
        partition: GUIDED_PARTITION,
        preload: join(__dirname, "overlay-preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const wc = (this.wc = this.win.webContents);
    wc.once("destroyed", () => (this.isClosed = true));
    // Pop-ups (e.g. "Sign in with GitHub") open as normal child windows in the same session.
    wc.setWindowOpenHandler(() => ({ action: "allow" }));

    const fromMe = (e: IpcMainEvent) => e.sender === wc;
    const onResult = (e: IpcMainEvent, r: OverlayCommandResult) => {
      if (!fromMe(e)) return;
      this.pending.get(r.id)?.(r);
      this.pending.delete(r.id);
    };
    const onUserAction = (e: IpcMainEvent, a: UserAction) => {
      if (fromMe(e) && isUserAction(a)) onAction(a);
    };
    const onReady = (e: IpcMainEvent) => {
      if (!fromMe(e)) return;
      this.overlayReady = true;
      onOverlayHealth(true);
      if (this.overlayState) wc.send(CH.state, this.overlayState);
    };
    ipcMain.on(CH.cmdResult, onResult);
    ipcMain.on(CH.action, onUserAction);
    ipcMain.on(CH.ready, onReady);

    let readyTimer: NodeJS.Timeout | undefined;
    wc.on("did-start-navigation", (_e, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) this.overlayReady = false;
    });
    wc.on("dom-ready", () => {
      clearTimeout(readyTimer);
      // If the panel hasn't reported in shortly after the page is ready, the
      // wizard window shows the same controls instead.
      readyTimer = setTimeout(() => onOverlayHealth(this.overlayReady), 4000);
    });

    this.win.on("close", () => (this.isClosed = true));
    this.win.on("closed", () => {
      this.isClosed = true;
      clearTimeout(readyTimer);
      ipcMain.off(CH.cmdResult, onResult);
      ipcMain.off(CH.action, onUserAction);
      ipcMain.off(CH.ready, onReady);
      for (const resolve of this.pending.values()) resolve({ id: -1, ok: false });
      this.pending.clear();
    });
  }

  // Set as soon as closing starts: the webContents goes away before the
  // window object does, and touching it then throws.
  get closed(): boolean {
    return this.isClosed || this.win.isDestroyed() || this.wc.isDestroyed();
  }

  async load(url: string): Promise<void> {
    this.assertOpen();
    this.win.show();
    // Navigation errors (e.g. aborted redirects) are fine; we check the URL afterwards.
    await this.win.loadURL(url).catch(() => undefined);
  }

  url(): string {
    return this.closed ? "" : this.wc.getURL();
  }

  setOverlay(s: OverlayState): void {
    this.overlayState = s;
    if (!this.closed) this.wc.send(CH.state, s);
  }

  private command(c: OverlayCommandBody, timeoutMs = 3000): Promise<OverlayCommandResult> {
    this.assertOpen();
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, ok: false });
      }, timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.wc.send(CH.cmd, { ...c, id });
    });
  }

  async exists(spec: ElementSpec): Promise<boolean> {
    return (await this.command({ cmd: "find", spec })).ok;
  }

  async click(spec: ElementSpec): Promise<boolean> {
    return (await this.command({ cmd: "click", spec })).ok;
  }

  // Types like a user would (real input events), so sites built with React etc. notice.
  async type(spec: ElementSpec, text: string): Promise<boolean> {
    if (!(await this.command({ cmd: "focus", spec })).ok) return false;
    if (this.closed) return false;
    await this.wc.insertText(text);
    return true;
  }

  async scanKey(pattern: string): Promise<string | null> {
    const r = await this.command({ cmd: "scanKey", pattern });
    return r.ok && r.value ? r.value : null;
  }

  close(): void {
    if (!this.closed) this.win.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("reason.windowClosed");
  }
}

export async function waitUntil(check: () => Promise<boolean> | boolean, timeoutMs: number, signal: AbortSignal, intervalMs = 750): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason;
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function isUserAction(a: unknown): a is UserAction {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  switch (x.type) {
    case "done":
    case "skip":
    case "retry":
      return true;
    case "confirm":
      return typeof x.yes === "boolean";
    case "paste":
      return typeof x.key === "string" && x.key.length < 4096;
    default:
      return false;
  }
}

export { isUserAction };
