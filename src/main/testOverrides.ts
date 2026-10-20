import { readFileSync } from "node:fs";
import type { ProviderConfig } from "../providers/types";

// Lets automated tests point the app at local mock pages and a mock OmniRoute.
// Ignored in packaged builds, so it can't be used against real users.
export interface TestOverrides {
  userDataDir?: string;
  // Use an already-running (mock) OmniRoute instead of starting the bundled one.
  external?: { baseUrl: string; cliSalt: string };
  port?: number; // port for the bundled OmniRoute (tests avoid the real default)
  externalInWindow?: boolean; // open "external browser" pages in a plain app window
  fakeClipboard?: boolean; // in-memory clipboard (globalThis.__onboardTestClipboard)
  providers?: Record<string, Partial<Omit<ProviderConfig, "urls" | "validate" | "oauth" | "guided" | "freeModels">> & {
    urls?: Partial<ProviderConfig["urls"]>;
    validate?: Partial<ProviderConfig["validate"]>;
    oauth?: Partial<NonNullable<ProviderConfig["oauth"]>>;
    guided?: Partial<NonNullable<ProviderConfig["guided"]>>;
    freeModels?: ProviderConfig["freeModels"];
  }>;
}

export function loadTestOverrides(isPackaged: boolean): TestOverrides {
  const file = process.env.OMNIROUTE_ONBOARD_TEST_CONFIG;
  if (!file || isPackaged) return {};
  return JSON.parse(readFileSync(file, "utf8")) as TestOverrides;
}
