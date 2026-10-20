// State the main process pushes to the wizard window, and actions it accepts back.
// All dynamic text is already localized by the main process.

export interface StartingView {
  status: "starting" | "failed";
  firstRun: boolean;
  message?: string;
}

export interface FlowView {
  provider: string;
  progress: string;
  hint: string;
  reason?: string;
  buttons: ("done" | "reopen" | "confirm" | "skip" | "paste" | "retry" | "clipboardYes" | "clipboardNo" | "switch")[];
  steps: { label: string; status: "done" | "current" | "todo" | "failed" }[];
  overlayOk: boolean | null; // null: this provider doesn't use the guided window
  queue: { name: string; status: "done" | "skipped" | "current" | "todo" }[];
}

export interface AutostartView {
  available: boolean; // only in the installed app
  on: boolean;
}

export interface ResultView {
  baseUrl: string;
  apiKey?: string;
  keyError?: string;
  services: { name: string; status: "ok" | "failed" | "skipped" }[];
  notes: string[];
  cleanup: "ask" | "done" | "kept";
  autostart: AutostartView;
}

export interface HomeView {
  omniroute: "starting" | "running" | "stopped" | "failed";
  baseUrl: string;
  services: { id: string; name: string; status: "active" | "inactive" | "none" }[];
  newKey?: string; // shown once, right after "Create a new key"
  keyError?: string;
  autostart: AutostartView;
}

export interface ProviderOption {
  id: string;
  name: string;
  blurb: string;
  connected: boolean;
}

export type UiState =
  | { screen: "starting"; starting: StartingView }
  | { screen: "welcome" }
  | { screen: "select"; providers: ProviderOption[]; notices: string[] }
  | { screen: "flow"; flow: FlowView }
  | { screen: "result"; result: ResultView }
  | { screen: "home"; home: HomeView };

export type UiAction =
  | { type: "start" }
  | { type: "starting:retry" }
  | { type: "select:go"; ids: string[] }
  | { type: "select:back" }
  | { type: "flow:done" }
  | { type: "flow:confirm"; yes: boolean }
  | { type: "flow:skip" }
  | { type: "flow:paste"; key: string }
  | { type: "flow:retry" }
  | { type: "flow:clipboard"; allow: boolean }
  | { type: "flow:switch" }
  | { type: "result:copy"; what: "baseUrl" | "apiKey" }
  | { type: "result:cleanup"; yes: boolean }
  | { type: "result:done" }
  | { type: "home:addServices" }
  | { type: "home:newKey" }
  | { type: "home:copy"; what: "baseUrl" | "newKey" | "password" }
  | { type: "home:openDashboard" }
  | { type: "home:restart" }
  | { type: "setAutostart"; on: boolean }
  | { type: "openLink"; url: string }
  | { type: "quit" };
