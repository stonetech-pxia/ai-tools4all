import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Small, non-secret app settings that must survive restarts.
export interface AppState {
  setupDone: boolean; // first-run wizard finished; open on the home screen from now on
  port: number; // fixed once chosen: users' AI tools are configured with it
  autostart: boolean;
  trayHintShown: boolean;
}

export const DEFAULT_PORT = 20138;

export function loadState(file: string): AppState {
  const defaults: AppState = { setupDone: false, port: DEFAULT_PORT, autostart: false, trayHintShown: false };
  if (!existsSync(file)) return defaults;
  try {
    return { ...defaults, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<AppState>) };
  } catch {
    return defaults;
  }
}

export function saveState(file: string, state: AppState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2));
}
