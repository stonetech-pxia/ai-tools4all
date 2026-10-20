import type { Step } from "../core/stateMachine";

// Something on the page, matched by CSS selector and/or visible text.
export interface ElementSpec {
  selector?: string;
  text?: string[]; // case-insensitive; any of these, trimmed, must equal or start the element's text
}

export interface GuidedConfig {
  // Logged in when the URL matches loggedInUrl and NOT loggedOutUrl.
  loggedInUrl: string; // regex source
  loggedOutUrl: string; // regex source
  createButton: ElementSpec;
  nameInput: ElementSpec;
  submitButton: ElementSpec;
  timeouts: { authMs: number; elementMs: number; keyMs: number };
}

export interface ProviderConfig {
  id: string; // our id, also the i18n namespace
  omnirouteId: string; // provider id inside OmniRoute
  displayName: string;
  // oauth: approve in the user's own browser. browser: the user creates the key
  // in their own browser and we pick it up; "guided" (helper window) is the fallback.
  kind: "oauth" | "browser";
  steps: Step[];
  guidedSteps?: Step[]; // flow for the helper-window mode, when the provider has one
  urls: { signup: string; keys: string; privacySettings?: string };
  oauth?: { exchangeUrl: string }; // auth URL is urls.signup
  validate: { url: string };
  keyPattern: string; // regex source matching a full key of this provider
  // Models that cannot cost the user money; only these go into the "free" combo.
  // priority: lower is tried first in the combo (bigger daily allowance first).
  freeModels?: { priority: number; static?: string[]; openRouterCatalog?: string };
  guided?: GuidedConfig;
}
