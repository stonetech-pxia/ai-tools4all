import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// OpenRouter OAuth PKCE (https://openrouter.ai/docs/guides/overview/auth/oauth):
// the user approves in their own browser, OpenRouter redirects to our loopback
// callback with a one-time code, and we exchange it for a user API key.

const b64url = (buf: Buffer) => buf.toString("base64url");

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(authUrl: string, opts: { callbackUrl: string; challenge: string; state: string; keyLabel: string }): string {
  const u = new URL(authUrl);
  u.searchParams.set("callback_url", opts.callbackUrl);
  u.searchParams.set("code_challenge", opts.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", opts.state);
  u.searchParams.set("key_label", opts.keyLabel);
  return u.toString();
}

export interface CallbackServer {
  callbackUrl: string;
  code: Promise<string>;
  close(): void;
}

// Listens on 127.0.0.1 only. Resolves with the first code whose state matches
// (or that carries no state: PKCE alone already binds the code to us).
export async function startCallbackServer(state: string, page: { done: string; error: string }): Promise<CallbackServer> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const code = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  code.catch(() => undefined); // avoid unhandled rejection if nobody awaits after close()

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const got = url.searchParams.get("code");
    const gotState = url.searchParams.get("state");
    const ok = !!got && (gotState === null || gotState === state);
    res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(`<!doctype html><meta charset="utf-8"><title>OmniRoute Setup</title><body style="font:16px system-ui;margin:3em">${ok ? page.done : page.error}</body>`);
    if (ok) resolveCode(got!);
  });

  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => res());
  });
  const { port } = server.address() as AddressInfo;
  return {
    callbackUrl: `http://localhost:${port}/callback`,
    code,
    close() {
      rejectCode(new Error("callback server closed"));
      server.close();
      server.closeAllConnections();
    },
  };
}

export async function exchangeCode(exchangeUrl: string, code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(exchangeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenRouter did not accept the authorization code (HTTP ${res.status})`);
  const body = (await res.json()) as { key?: unknown };
  if (typeof body.key !== "string" || !body.key) throw new Error("OpenRouter returned no key");
  return body.key;
}
