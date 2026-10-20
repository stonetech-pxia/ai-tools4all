import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { validateKey } from "../../src/core/validateKey";
import { buildAuthUrl, createPkce, exchangeCode, startCallbackServer } from "../../src/providers/openrouter/oauth";

const page = { done: "DONE", error: "ERR" };

describe("PKCE", () => {
  it("challenge is base64url(sha256(verifier))", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("builds the OpenRouter auth URL", () => {
    const u = new URL(buildAuthUrl("https://openrouter.ai/auth", { callbackUrl: "http://localhost:1234/callback", challenge: "abc", state: "s1", keyLabel: "omniroute-20261020" }));
    expect(u.origin + u.pathname).toBe("https://openrouter.ai/auth");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      callback_url: "http://localhost:1234/callback",
      code_challenge: "abc",
      code_challenge_method: "S256",
      state: "s1",
      key_label: "omniroute-20261020",
    });
  });
});

describe("callback server", () => {
  it("listens on loopback and accepts the code with the right state", async () => {
    const s = await startCallbackServer("good", page);
    const port = new URL(s.callbackUrl).port;
    const bad = await fetch(`http://127.0.0.1:${port}/callback?code=evil&state=bad`);
    expect(bad.status).toBe(400);
    const ok = await fetch(`http://127.0.0.1:${port}/callback?code=c0de&state=good`);
    expect(await ok.text()).toContain("DONE");
    await expect(s.code).resolves.toBe("c0de");
    s.close();
  });
});

describe("code exchange and key validation (mock OpenRouter)", () => {
  async function mockOpenRouter() {
    const seen: { url: string; body: string; auth?: string }[] = [];
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      seen.push({ url: req.url!, body, auth: req.headers.authorization });
      if (req.url === "/api/v1/auth/keys") {
        const b = JSON.parse(body);
        const ok = b.code === "c0de" && b.code_verifier === "ver" && b.code_challenge_method === "S256";
        res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
        return res.end(JSON.stringify(ok ? { key: "sk-or-v1-NEWKEY0123456789abcdef" } : { error: "bad" }));
      }
      if (req.url === "/api/v1/key") {
        res.writeHead(req.headers.authorization === "Bearer sk-or-v1-NEWKEY0123456789abcdef" ? 200 : 401);
        return res.end("{}");
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => server.close() };
  }

  it("exchanges the code for a key, then the key validates", async () => {
    const m = await mockOpenRouter();
    const key = await exchangeCode(`${m.base}/api/v1/auth/keys`, "c0de", "ver");
    expect(key).toBe("sk-or-v1-NEWKEY0123456789abcdef");
    expect(await validateKey(`${m.base}/api/v1/key`, key)).toEqual({ ok: true });
    expect(await validateKey(`${m.base}/api/v1/key`, "sk-or-v1-wrong")).toEqual({ ok: false, reason: "rejected", status: 401 });
    expect(m.seen.every((r) => !r.url.includes(key))).toBe(true);
    m.close();
  });

  it("rejects a wrong verifier", async () => {
    const m = await mockOpenRouter();
    await expect(exchangeCode(`${m.base}/api/v1/auth/keys`, "c0de", "nope")).rejects.toThrow(/HTTP 400/);
    m.close();
  });

  it("reports network errors separately", async () => {
    expect(await validateKey("http://127.0.0.1:1/x", "k")).toEqual({ ok: false, reason: "network" });
  });
});
