import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Local fake versions of the Groq console and OpenRouter, just enough for the
// app's flows. No real accounts are ever touched by automated tests.
export const GROQ_KEY = "gsk_E2EtestKey0123456789abcdefghijkl";
export const OPENROUTER_KEY = "sk-or-v1-e2etestkey0123456789abcdef";

const html = (body: string) => `<!doctype html><meta charset="utf-8"><title>mock</title><body>${body}</body>`;

export async function startMockServices() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    let body = "";
    for await (const c of req) body += c;
    const loggedIn = /groq_session=1/.test(req.headers.cookie ?? "");
    const send = (status: number, type: string, content: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, ...headers });
      res.end(content);
    };

    // ---- Groq console ----
    if (url.pathname === "/groq/login")
      return send(200, "text/html", html(`<h1>Sign in to Groq</h1><a id="signin" href="/groq/session">Sign in</a>`));
    if (url.pathname === "/groq/session") return send(302, "text/plain", "", { location: "/groq/home", "set-cookie": "groq_session=1; Path=/" });
    if (url.pathname === "/groq/home") return send(200, "text/html", html(`<h1>Welcome</h1>`));
    if (url.pathname === "/groq/keys") {
      if (!loggedIn) return send(302, "text/plain", "", { location: "/groq/login" });
      // A React-like page: the dialog only appears after clicking, and the key
      // only after a name was typed (checked through real input events).
      return send(
        200,
        "text/html",
        html(`<h1>API Keys</h1><button id="create">Create API Key</button><div id="slot"></div>
<script>
document.getElementById('create').onclick = () => {
  setTimeout(() => {
    document.getElementById('slot').innerHTML = '<div role="dialog"><input type="text" id="name"><button id="submit">Submit</button></div>';
    let typed = '';
    document.getElementById('name').addEventListener('input', e => typed = e.target.value);
    document.getElementById('submit').onclick = () => {
      if (!typed) return;
      setTimeout(() => {
        document.getElementById('slot').innerHTML = '<div role="dialog"><p>Copy your key now. It is shown only once.</p><code>${GROQ_KEY}</code><p id="named"></p></div>';
        document.getElementById('named').textContent = 'Name: ' + typed;
      }, 300);
    };
  }, 300);
};
</script>`),
      );
    }
    if (url.pathname === "/groq/keys-redesigned") {
      if (!loggedIn) return send(302, "text/plain", "", { location: "/groq/login" });
      return send(200, "text/html", html(`<h1>Keys</h1><button>New secret</button>`));
    }
    if (url.pathname === "/groq/openai/v1/models")
      return send(req.headers.authorization === `Bearer ${GROQ_KEY}` ? 200 : 401, "application/json", '{"data":[]}');

    // ---- OpenRouter ----
    if (url.pathname === "/openrouter/auth") {
      // Pretend the user signed in and clicked Authorize.
      const cb = new URL(url.searchParams.get("callback_url")!);
      cb.searchParams.set("code", "c0de");
      cb.searchParams.set("state", url.searchParams.get("state")!);
      return send(302, "text/plain", "", { location: cb.toString() });
    }
    if (url.pathname === "/openrouter/api/v1/auth/keys") {
      const b = JSON.parse(body || "{}");
      const ok = b.code === "c0de" && typeof b.code_verifier === "string" && b.code_challenge_method === "S256";
      return send(ok ? 200 : 400, "application/json", JSON.stringify(ok ? { key: OPENROUTER_KEY } : { error: "bad" }));
    }
    if (url.pathname === "/openrouter/api/v1/models")
      return send(200, "application/json", JSON.stringify({ data: [
        { id: "meta/free-one:free", pricing: { prompt: "0", completion: "0", request: "0" } },
        { id: "meta/paid-one", pricing: { prompt: "0.000001", completion: "0.000002" } },
        { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } },
      ] }));
    if (url.pathname === "/openrouter/api/v1/key")
      return send(req.headers.authorization === `Bearer ${OPENROUTER_KEY}` ? 200 : 401, "application/json", '{"data":{}}');

    send(404, "text/plain", "not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}
