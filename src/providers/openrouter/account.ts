// OpenRouter reports whether an account has ever bought credits
// (GET /api/v1/key → data.is_free_tier). An account with credits can be
// charged for paid models, so the user is told and pointed at the key's
// credit limit. Keys from this app can't reach paid models either way.
export async function hasPurchasedCredits(keyInfoUrl: string, key: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const res = await fetchImpl(keyInfoUrl, { headers: { authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { is_free_tier?: unknown } };
    return body.data?.is_free_tier === false ? true : body.data?.is_free_tier === true ? false : null;
  } catch {
    return null;
  }
}
