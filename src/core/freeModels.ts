// Which models go into the "free" combo. The rule is strict on purpose: a
// model is only included when we are sure using it cannot cost the user money.
// Gateway keys from this app can only call that combo, so a model that is not
// listed here is simply unreachable through them.

import type { ProviderConfig } from "../providers/types";

export const FREE_COMBO = "free";

export interface OpenRouterModel {
  id: string;
  pricing?: Record<string, string | number | null | undefined>;
}

// OpenRouter: only ":free" variants, and only when every price it reports is
// zero. If OpenRouter turns a model paid, its ":free" id disappears or gets a
// price, and the model drops out the next time the list is built.
export function freeOpenRouterModels(models: OpenRouterModel[]): string[] {
  return models
    .filter((m) => typeof m.id === "string" && m.id.endsWith(":free"))
    .filter((m) => {
      const prices = Object.values(m.pricing ?? {});
      return prices.length > 0 && prices.every((p) => p !== null && p !== undefined && Number(p) === 0);
    })
    .map((m) => m.id);
}

export async function fetchOpenRouterFreeModels(catalogUrl: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(catalogUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`OpenRouter model list: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: OpenRouterModel[] };
  return freeOpenRouterModels(body.data ?? []);
}

// Combo targets ("provider/model") for the connected providers, in priority order.
export async function freeComboTargets(providers: ProviderConfig[], fetchImpl: typeof fetch = fetch): Promise<{ targets: string[]; problems: string[] }> {
  const targets: string[] = [];
  const problems: string[] = [];
  const ordered = providers.filter((p) => p.freeModels).sort((a, b) => a.freeModels!.priority - b.freeModels!.priority);
  for (const p of ordered) {
    const free = p.freeModels;
    if (!free) continue;
    if (free.static) targets.push(...free.static.map((m) => `${p.omnirouteId}/${m}`));
    if (free.openRouterCatalog) {
      try {
        targets.push(...(await fetchOpenRouterFreeModels(free.openRouterCatalog, fetchImpl)).map((m) => `${p.omnirouteId}/${m}`));
      } catch (err) {
        // Strict: when we can't confirm what's free, add nothing for this provider.
        problems.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { targets: [...new Set(targets)], problems };
}
