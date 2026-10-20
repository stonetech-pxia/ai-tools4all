import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

// Minimal stand-in for OmniRoute's management API, shaped after its route handlers.
export interface Recorded {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export async function startMockOmniRoute(opts: { token?: string; testValid?: boolean } = {}) {
  const requests: Recorded[] = [];
  const connections = new Map<string, { id: string; provider: string; name: string; apiKey: string; isActive: boolean }>();
  const combos = new Map<string, { id: string; name: string; models: string[]; strategy?: string }>();
  const keys = new Map<string, Record<string, unknown> & { id: string }>();
  let n = 0;

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const path = new URL(req.url!, "http://x").pathname;

    if (path === "/api/health") return json(200, { status: "ok", timestamp: new Date().toISOString() });
    if (opts.token && req.headers["x-omniroute-cli-token"] !== opts.token) return json(401, { error: "Unauthorized" });

    if (req.method === "GET" && path === "/api/providers") {
      const list = [...connections.values()].map(({ apiKey, ...pub }) => ({ ...pub, apiKey: apiKey.slice(0, 4) + "****" }));
      return json(200, { connections: list, total: list.length });
    }
    if (req.method === "POST" && path === "/api/providers") {
      const b = JSON.parse(body);
      const c = { id: `conn-${++n}`, provider: b.provider, name: b.name, apiKey: b.apiKey, isActive: false };
      connections.set(c.id, c);
      const { apiKey: _hidden, ...pub } = c;
      return json(201, { connection: pub });
    }
    const test = /^\/api\/providers\/([^/]+)\/test$/.exec(path);
    if (req.method === "POST" && test) {
      const c = connections.get(test[1]);
      if (!c) return json(404, { error: "Connection not found" });
      const valid = opts.testValid ?? true;
      c.isActive = valid;
      return json(200, { valid, error: valid ? null : "Invalid API key", latencyMs: 5 });
    }
    const get = /^\/api\/providers\/([^/]+)$/.exec(path);
    if (req.method === "GET" && get) {
      const c = connections.get(get[1]);
      if (!c) return json(404, { error: "Connection not found" });
      const { apiKey: _hidden, ...pub } = c;
      return json(200, { connection: pub });
    }
    if (req.method === "POST" && path === "/api/keys") {
      const b = JSON.parse(body);
      const id = `key-${keys.size + 1}`;
      keys.set(id, { id, ...b });
      return json(201, { id, name: b.name, key: "sk-gateway0123456789abcdefghij" });
    }
    if (req.method === "GET" && path === "/api/keys") return json(200, { keys: [...keys.values()], total: keys.size });
    const keyId = /^\/api\/keys\/([^/]+)$/.exec(path);
    if (req.method === "PATCH" && keyId) {
      const k = keys.get(keyId[1]);
      if (!k) return json(404, { error: "not found" });
      Object.assign(k, JSON.parse(body));
      return json(200, k);
    }
    if (req.method === "GET" && path === "/api/combos") return json(200, { combos: [...combos.values()], total: combos.size });
    if (req.method === "POST" && path === "/api/combos") {
      const b = JSON.parse(body);
      const c = { id: `combo-${combos.size + 1}`, ...b };
      combos.set(c.id, c);
      return json(201, c);
    }
    const comboId = /^\/api\/combos\/([^/]+)$/.exec(path);
    if (req.method === "PUT" && comboId) {
      const c = combos.get(comboId[1]);
      if (!c) return json(404, { error: "not found" });
      Object.assign(c, JSON.parse(body));
      return json(200, c);
    }
    json(404, { error: "not found" });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    requests,
    connections,
    combos,
    keys,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
