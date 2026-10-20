// Cheap "is this key accepted?" check against the provider itself, before the
// key is handed to OmniRoute. The key goes only in the Authorization header.
export type ValidationResult = { ok: true } | { ok: false; reason: "rejected" | "network" | "unexpected"; status?: number };

export async function validateKey(url: string, key: string, fetchImpl: typeof fetch = fetch): Promise<ValidationResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  await res.body?.cancel().catch(() => undefined);
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "rejected", status: res.status };
  return { ok: false, reason: "unexpected", status: res.status };
}
