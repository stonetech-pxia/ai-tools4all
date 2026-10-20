import groq from "./groq/config.json";
import openrouter from "./openrouter/config.json";
import type { ProviderConfig } from "./types";

export const PROVIDERS: ProviderConfig[] = [openrouter as ProviderConfig, groq as ProviderConfig];

export function getProvider(id: string): ProviderConfig {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown provider ${id}`);
  return p;
}
