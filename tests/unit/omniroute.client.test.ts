import { afterEach, describe, expect, it, vi } from "vitest";
import { registerStep } from "../../src/core/commonSteps";
import { ActionBus, type FlowContext } from "../../src/core/flow";
import { isComboOnly, OmniRouteClient, OmniRouteError } from "../../src/core/omniroute/client";
import { getProvider } from "../../src/providers";
import { startMockOmniRoute } from "../mock/omniroute";

const TOKEN = "f".repeat(64);
const KEY = "gsk_SECRETSECRETSECRETSECRET123456";
let mock: Awaited<ReturnType<typeof startMockOmniRoute>> | null = null;

afterEach(async () => {
  await mock?.close();
  mock = null;
  vi.restoreAllMocks();
});

describe("OmniRouteClient", () => {
  it("refuses non-loopback addresses", () => {
    expect(() => new OmniRouteClient("http://192.168.1.5:20128", null)).toThrow();
    expect(() => new OmniRouteClient("http://localhost:20128", null)).not.toThrow();
  });

  it("checks health without credentials", async () => {
    mock = await startMockOmniRoute({ token: TOKEN });
    expect(await new OmniRouteClient(mock.baseUrl, null).health()).toBe(true);
    expect(mock.requests[0].headers["x-omniroute-cli-token"]).toBeUndefined();
    expect(await new OmniRouteClient("http://127.0.0.1:1", null).health(300)).toBe(false);
  });

  it("sends the machine token as a header and reports auth failures", async () => {
    mock = await startMockOmniRoute({ token: TOKEN });
    expect(await new OmniRouteClient(mock.baseUrl, { kind: "cli-token", token: TOKEN }).listConnections()).toEqual([]);
    expect(mock.requests.at(-1)!.headers["x-omniroute-cli-token"]).toBe(TOKEN);

    const err = await new OmniRouteClient(mock.baseUrl, { kind: "cli-token", token: "wrong" }).listConnections().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OmniRouteError);
    expect((err as OmniRouteError).isAuth).toBe(true);
  });

  it("creates a gateway key and returns it once", async () => {
    mock = await startMockOmniRoute({ token: TOKEN });
    const k = await new OmniRouteClient(mock.baseUrl, { kind: "cli-token", token: TOKEN }).createGatewayKey("omniroute-onboard-20261020", "free");
    expect(k.key).toMatch(/^sk-/);
    // The key can only call the "free" combo: no single model, no other combo.
    expect(JSON.parse(mock.requests.at(-1)!.body)).toEqual({ name: "omniroute-onboard-20261020", modelAccessMode: "restricted", allowedModels: [], allowedCombos: ["free"] });
  });
});

describe("combos and key restrictions", () => {
  it("creates the combo once, then updates it in place", async () => {
    mock = await startMockOmniRoute({ token: TOKEN });
    const c = new OmniRouteClient(mock.baseUrl, { kind: "cli-token", token: TOKEN });
    await c.saveCombo("free", ["groq/a"]);
    await c.saveCombo("free", ["groq/a", "openrouter/b:free"]);
    expect([...mock.combos.values()]).toEqual([expect.objectContaining({ name: "free", models: ["groq/a", "openrouter/b:free"], strategy: "priority" })]);
  });

  it("puts keys under the combo-only rule", async () => {
    mock = await startMockOmniRoute({ token: TOKEN });
    const c = new OmniRouteClient(mock.baseUrl, { kind: "cli-token", token: TOKEN });
    mock.keys.set("k1", { id: "k1", name: "omniroute-onboard-20261019", modelAccessMode: "all" });
    await c.restrictGatewayKey("k1", "free");
    const [k] = await c.listGatewayKeys();
    expect(isComboOnly(k, "free")).toBe(true);
    expect(isComboOnly({ ...k, allowedModels: ["groq/x"] }, "free")).toBe(false);
    expect(isComboOnly({ ...k, allowedCombos: ["free", "other"] }, "free")).toBe(false);
  });
});

describe("REGISTER step", () => {
  const ctxWith = (key: string | null): FlowContext => ({ key, bus: new ActionBus(), signal: new AbortController().signal });

  it("puts the key only in the request body, then forgets it", async () => {
    mock = await startMockOmniRoute({ token: TOKEN });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));

    const client = new OmniRouteClient(mock.baseUrl, { kind: "cli-token", token: TOKEN });
    const ctx = ctxWith(KEY);
    const tested: unknown[] = [];
    const ev = await registerStep(getProvider("groq"), () => client, (r) => tested.push(r))(ctx);

    expect(ev).toEqual({ type: "NEXT" });
    expect(ctx.key).toBeNull();
    expect(ctx.connectionId).toBe("conn-1");
    expect(tested).toEqual([expect.objectContaining({ valid: true })]);
    expect(mock.connections.get("conn-1")).toMatchObject({ provider: "groq", apiKey: KEY, isActive: true });

    for (const r of mock.requests) {
      expect(r.url).not.toContain(KEY);
      expect(JSON.stringify(r.headers)).not.toContain(KEY);
    }
    expect(mock.requests.filter((r) => r.body.includes(KEY)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/providers"]);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("fails into manual mode when OmniRoute's own test fails", async () => {
    mock = await startMockOmniRoute({ token: TOKEN, testValid: false });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const client = new OmniRouteClient(mock.baseUrl, { kind: "cli-token", token: TOKEN });
    const ev = await registerStep(getProvider("groq"), () => client, () => undefined)(ctxWith(KEY));
    expect(ev).toEqual({ type: "FAIL", reason: "reason.omniTestFailed" });
  });
});
