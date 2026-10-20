import { app, BrowserWindow, clipboard, ipcMain, Menu, safeStorage, session, shell, Tray } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ClipboardAccess } from "../core/clipboardWatch";
import { todayStamp } from "../core/commonSteps";
import { log, setLogFile } from "../core/log";
import { FREE_COMBO, freeComboTargets } from "../core/freeModels";
import { isComboOnly, OmniRouteClient, OmniRouteError } from "../core/omniroute/client";
import { OmniRouteHost, PortInUseError, type ServerSecrets } from "../core/omniroute/host";
import { deriveToken, readMachineId } from "../core/omniroute/machineToken";
import { OUTBOUND_OFF } from "../core/omniroute/outbound";
import { has, t } from "../i18n";
import { PROVIDERS } from "../providers";
import type { ProviderConfig } from "../providers/types";
import type { AutostartView, HomeView, ResultView, UiAction, UiState } from "../ui/types";
import { loadState, saveState, type AppState } from "./appState";
import { Flows, providerConfig } from "./flows";
import { GUIDED_PARTITION } from "./guidedWindow";
import { loadOrCreateSecrets, SecretsUnreadableError } from "./secrets";
import { loadTestOverrides, type TestOverrides } from "./testOverrides";
import { trayIcon } from "./trayIcon";

let overrides: TestOverrides = {};
let wizard: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let ui: UiState = { screen: "starting", starting: { status: "starting", firstRun: true } };
let state: AppState;
let stateFile = "";
let host: OmniRouteHost | null = null;
let secrets: ServerSecrets | null = null;
let client: OmniRouteClient | null = null;
let flows: Flows;
let result: ResultView | null = null;
let homeExtras: Pick<HomeView, "newKey" | "keyError"> = {};
let busy = false;

// ---------- windows and tray ----------

function push(next: UiState): void {
  ui = next;
  wizard?.webContents.send("ui:state", ui);
}

function showWindow(): void {
  if (!wizard) return;
  if (wizard.isMinimized()) wizard.restore();
  wizard.show();
  wizard.focus();
}

function createWizard(show: boolean): void {
  wizard = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 360,
    show,
    title: t("app.title"),
    webPreferences: { preload: join(__dirname, "ui-preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  wizard.setMenuBarVisibility(false);
  const wc = wizard.webContents;
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: "deny" };
  });
  wc.on("did-finish-load", () => wc.send("ui:state", ui));
  // Closing the window keeps OmniRoute running in the background (tray).
  wizard.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    wizard?.hide();
    dropShownSecrets();
    if (!state.trayHintShown && tray && process.platform === "win32") {
      tray.displayBalloon({ title: t("app.title"), content: t("tray.stillRunning") });
      state.trayHintShown = true;
      saveState(stateFile, state);
    }
  });
  void wizard.loadFile(join(__dirname, "index.html"));
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip(t("app.title"));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t("tray.open"), click: showWindow },
      { type: "separator" },
      { label: t("tray.quit"), click: () => app.quit() },
    ]),
  );
  tray.on("click", showWindow);
}

// Keys shown once (gateway key) are forgotten when the window is hidden.
function dropShownSecrets(): void {
  if (result) result.apiKey = undefined;
  homeExtras = {};
  if (ui.screen === "result" || ui.screen === "home") void showHome();
}

function openLink(url: string): void {
  if (/^https:\/\//.test(url)) void shell.openExternal(url);
}

// ---------- OmniRoute ----------

function serverDir(): string {
  const base = app.isPackaged ? join(process.resourcesPath, "omniroute") : join(app.getAppPath(), "vendor", "omniroute");
  return join(base, "node_modules", "omniroute", "dist");
}

// The port our OmniRoute listens on (tests may move it).
function omniPort(): number {
  return overrides.external ? Number(new URL(overrides.external.baseUrl).port) : (overrides.port ?? state.port);
}

function baseUrlForTools(): string {
  return `http://localhost:${omniPort()}/v1`;
}

function failStart(message: string): void {
  log("error", "OmniRoute start failed", { message });
  push({ screen: "starting", starting: { status: "failed", firstRun: !state.setupDone, message } });
}

async function startOmniRoute(): Promise<void> {
  push({ screen: "starting", starting: { status: "starting", firstRun: !state.setupDone } });
  const machineId = readMachineId();
  if (!machineId) return failStart(t("starting.noMachineId"));

  if (overrides.external) {
    client = new OmniRouteClient(overrides.external.baseUrl, { kind: "cli-token", token: deriveToken(machineId, overrides.external.cliSalt) });
  } else {
    if (!existsSync(serverDir())) return failStart(t("starting.filesMissing"));
    try {
      const loaded = loadOrCreateSecrets(join(app.getPath("userData"), "secrets.json"), safeStorage);
      secrets = loaded.secrets;
      if (loaded.created) log("info", "settings created", { encrypted: loaded.encrypted });
      if (!loaded.encrypted) log("warn", "OS keychain unavailable; settings stored without encryption");
    } catch (err) {
      return failStart(err instanceof SecretsUnreadableError ? t("starting.secretsUnreadable") : String(err));
    }
    const userData = app.getPath("userData");
    host?.stop();
    host = new OmniRouteHost({
      serverDir: serverDir(),
      dataDir: join(userData, "omniroute-data"),
      port: omniPort(),
      nodeBinary: process.execPath,
      secrets,
      logFile: join(userData, "logs", "omniroute.log"),
      pidFile: join(userData, "omniroute.pid"),
      extraEnv: OUTBOUND_OFF,
    });
    host.on("status", (s) => {
      log("info", `OmniRoute ${s}`);
      if (ui.screen === "home") void showHome();
    });
    host.on("crashed", (info) => log("error", "OmniRoute stopped unexpectedly; restarting", info));
    const started = Date.now();
    try {
      await host.start();
    } catch (err) {
      return failStart(err instanceof PortInUseError ? t("starting.portInUse", { port: err.port }) : t("starting.failed"));
    }
    log("info", "OmniRoute running", { seconds: Math.round((Date.now() - started) / 1000) });
    client = new OmniRouteClient(host.baseUrl, { kind: "cli-token", token: deriveToken(machineId, secrets.cliSalt) });
  }

  // Tests reach the client through this hook (test builds only: overrides are ignored when packaged).
  if (Object.keys(overrides).length) (globalThis as { __onboardTestClient?: OmniRouteClient }).__onboardTestClient = client;

  // Prove we can manage it (this is where an auth problem would show up).
  try {
    await client.listConnections();
  } catch (err) {
    return failStart(err instanceof OmniRouteError && err.isAuth ? t("starting.authFailed") : t("starting.unreachable"));
  }
  await lockDownGatewayKeys();
  if ((await connectedProviders()).size > 0) await syncFreeCombo();
  if (state.setupDone) await showHome();
  else push({ screen: "welcome" });
}

// ---------- no-cost guarantee ----------

// Keys made by this app may only call the "free" combo. Keys from earlier
// versions (or changed in the dashboard) are put back under that rule.
async function lockDownGatewayKeys(): Promise<void> {
  if (!client) return;
  try {
    const loose = (await client.listGatewayKeys()).filter((k) => k.name?.startsWith("omniroute-onboard-") && !isComboOnly(k, FREE_COMBO));
    for (const k of loose) await client.restrictGatewayKey(k.id, FREE_COMBO);
    if (loose.length) log("info", "restricted gateway keys to the free combo", { count: loose.length });
  } catch (err) {
    log("error", "could not check gateway keys", err);
  }
}

// (Re)builds the "free" combo from the connected providers' confirmed-free
// models. Returns false when there is nothing that is certainly free.
async function syncFreeCombo(): Promise<boolean> {
  if (!client) return false;
  const connected = await connectedProviders();
  const providers = PROVIDERS.map((p) => providerConfig(p.id, overrides)).filter((p) => connected.has(p.omnirouteId));
  const { targets, problems } = await freeComboTargets(providers);
  if (problems.length) log("warn", "free model list incomplete", { problems });
  if (targets.length === 0) return false;
  try {
    await client.saveCombo(FREE_COMBO, targets);
    log("info", "free combo updated", { models: targets.length });
    return true;
  } catch (err) {
    log("error", "could not update the free combo", err);
    return false;
  }
}

// Errors returned here are ready to show to the user.
async function createFreeKey(): Promise<{ key?: string; error?: string }> {
  if (!client) return { error: t("starting.unreachable") };
  if ((await connectedProviders()).size === 0) return { error: t("free.connectFirst") };
  if (!(await syncFreeCombo())) return { error: t("free.noModels") };
  try {
    const created = await client.createGatewayKey(`omniroute-onboard-${todayStamp()}`, FREE_COMBO);
    log("info", "gateway key created", { id: created.id });
    return { key: created.key };
  } catch (err) {
    log("error", "could not create gateway key", err);
    return { error: t("env.error", { message: err instanceof Error ? err.message : String(err) }) };
  }
}

// ---------- screens ----------

function autostartView(): AutostartView {
  return { available: app.isPackaged, on: state.autostart };
}

async function connectedProviders(): Promise<Map<string, boolean>> {
  // provider id -> has an active connection
  const map = new Map<string, boolean>();
  try {
    for (const c of (await client?.listConnections()) ?? []) map.set(c.provider, (map.get(c.provider) ?? false) || c.isActive === true);
  } catch (err) {
    log("warn", "could not list OmniRoute connections", err);
  }
  return map;
}

async function showHome(): Promise<void> {
  const connected = await connectedProviders();
  push({
    screen: "home",
    home: {
      omniroute: host ? host.status : "running",
      baseUrl: baseUrlForTools(),
      services: PROVIDERS.map((p) => {
        const c = connected.get(providerConfig(p.id, overrides).omnirouteId);
        return { id: p.id, name: p.displayName, status: c === undefined ? "none" : c ? "active" : "inactive" };
      }),
      ...homeExtras,
      autostart: autostartView(),
    },
  });
}

async function showSelect(): Promise<void> {
  const connected = await connectedProviders();
  push({
    screen: "select",
    providers: PROVIDERS.map((p) => ({ id: p.id, name: p.displayName, blurb: t(`provider.${p.id}.blurb`), connected: connected.get(providerConfig(p.id, overrides).omnirouteId) === true })),
    notices: [t("notice.noCost"), t("notice.limits"), t("notice.personal"), t("notice.developer"), t("notice.oneAccount")],
  });
}

async function showResult(services: ResultView["services"], done: ProviderConfig[], warnings: string[]): Promise<void> {
  result = {
    baseUrl: baseUrlForTools(),
    services,
    notes: [
      ...warnings,
      ...done.map((p) => (has(`provider.${p.id}.privacy`) ? t(`provider.${p.id}.privacy`, { url: p.urls.privacySettings ?? "" }) : "")).filter(Boolean),
    ],
    cleanup: "ask",
    autostart: autostartView(),
  };
  if (done.length > 0) {
    const { key, error } = await createFreeKey();
    result.apiKey = key;
    result.keyError = error;
  }
  if (!state.setupDone) {
    state.setupDone = true;
    saveState(stateFile, state);
  }
  push({ screen: "result", result });
}

function setAutostart(on: boolean): void {
  if (!app.isPackaged) return; // a dev build would register the bare Electron binary
  app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"] });
  state.autostart = on;
  saveState(stateFile, state);
  log("info", `start at login ${on ? "on" : "off"}`);
  if (result) result.autostart = autostartView();
  if (ui.screen === "result" && result) push({ screen: "result", result });
  if (ui.screen === "home") void showHome();
}

// ---------- actions from the wizard ----------

// Tests use an in-memory clipboard so they never touch the real one.
const testClipboard = { text: "" };
(globalThis as { __onboardTestClipboard?: typeof testClipboard }).__onboardTestClipboard = testClipboard;
const appClipboard: ClipboardAccess = {
  read: () => (overrides.fakeClipboard ? testClipboard.text : clipboard.readText()),
  write: (text) => (overrides.fakeClipboard ? void (testClipboard.text = text) : clipboard.writeText(text)),
};

async function openExternal(url: string): Promise<void> {
  if (overrides.externalInWindow) {
    const w = new BrowserWindow({ width: 900, height: 700, webPreferences: { sandbox: true, contextIsolation: true } });
    await w.loadURL(url).catch(() => undefined);
    return;
  }
  if (!/^https:\/\//.test(url)) throw new Error("refusing to open a non-https URL");
  await shell.openExternal(url);
}

async function handle(action: UiAction): Promise<void> {
  switch (action.type) {
    case "start":
    case "home:addServices":
      return showSelect();
    case "starting:retry":
    case "home:restart":
      return startOmniRoute();
    case "select:back":
      return state.setupDone ? showHome() : push({ screen: "welcome" });
    case "select:go": {
      const ids = action.ids.filter((id) => PROVIDERS.some((p) => p.id === id));
      if (ids.length === 0 || busy || !client) return;
      busy = true;
      try {
        const { services, done, warnings } = await flows.run(ids, client);
        await showResult(services, done, warnings);
      } finally {
        busy = false;
      }
      return;
    }
    case "flow:done":
      return flows.action({ type: "done" });
    case "flow:confirm":
      return flows.action({ type: "confirm", yes: action.yes });
    case "flow:skip":
      return flows.action({ type: "skip" });
    case "flow:paste":
      return flows.action({ type: "paste", key: action.key });
    case "flow:retry":
      return flows.action({ type: "retry" });
    case "flow:clipboard":
      return flows.action({ type: "clipboard", allow: action.allow });
    case "flow:switch":
      return flows.action({ type: "switch" });
    case "result:copy":
      if (!result) return;
      appClipboard.write(action.what === "apiKey" ? (result.apiKey ?? "") : result.baseUrl);
      return;
    case "result:cleanup":
      if (!result) return;
      if (action.yes) {
        const s = session.fromPartition(GUIDED_PARTITION);
        await s.clearStorageData();
        await s.clearCache();
        log("info", "guided browser profile cleared");
      }
      result.cleanup = action.yes ? "done" : "kept";
      push({ screen: "result", result });
      return;
    case "result:done":
      result = null; // drop the gateway key
      return showHome();
    case "home:newKey": {
      const { key, error } = await createFreeKey();
      homeExtras = { newKey: key, keyError: error };
      return showHome();
    }
    case "home:copy":
      if (action.what === "baseUrl") appClipboard.write(baseUrlForTools());
      if (action.what === "newKey" && homeExtras.newKey) appClipboard.write(homeExtras.newKey);
      if (action.what === "password" && secrets) appClipboard.write(secrets.password);
      return;
    case "home:openDashboard":
      if (host) await shell.openExternal(`http://localhost:${omniPort()}/`);
      return;
    case "setAutostart":
      return setAutostart(action.on);
    case "openLink":
      openLink(action.url);
      return;
    case "quit":
      app.quit();
      return;
  }
}

// ---------- startup ----------

overrides = loadTestOverrides(app.isPackaged);
if (overrides.userDataDir) app.setPath("userData", overrides.userDataDir);

if (!app.requestSingleInstanceLock()) {
  // Already running (maybe hidden in the tray): that instance shows itself.
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    const userData = app.getPath("userData");
    setLogFile(join(userData, "logs", "onboard.log"));
    log("info", `OmniRoute Setup ${app.getVersion()} starting`, { platform: process.platform, arch: process.arch });
    stateFile = join(userData, "state.json");
    state = loadState(stateFile);
    flows = new Flows({ push, wizard: () => wizard, overrides, clipboard: appClipboard, openExternal });

    ipcMain.on("ui:action", (e, action: UiAction) => {
      if (!wizard || e.sender !== wizard.webContents || !action || typeof action.type !== "string") return;
      handle(action).catch((err) => log("error", `action ${action.type} failed`, err));
    });
    createTray();
    createWizard(!process.argv.includes("--hidden"));
    void startOmniRoute();
  });

  app.on("before-quit", () => {
    quitting = true;
    host?.stop();
  });
  // Stay in the tray when the window is closed.
  app.on("window-all-closed", () => undefined);
}
