import { CLI_TOKEN_HEADER } from "./machineToken";

export type OmniAuth = { kind: "cli-token"; token: string };

export class OmniRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OmniRouteError";
  }
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface Connection {
  id: string;
  provider: string;
  name?: string;
  isActive?: boolean;
  testStatus?: string;
}

export interface Combo {
  id: string;
  name: string;
  models?: unknown[];
}

export interface GatewayKeyInfo {
  id: string;
  name?: string;
  modelAccessMode?: "all" | "restricted";
  allowedModels?: string[];
  allowedCombos?: string[];
}

// Keys this app hands out may only call this one combo: nothing else, not
// even a single model, is reachable with them.
export function comboOnlyAccess(combo: string) {
  return { modelAccessMode: "restricted" as const, allowedModels: [] as string[], allowedCombos: [combo] };
}

export function isComboOnly(k: GatewayKeyInfo, combo: string): boolean {
  return k.modelAccessMode === "restricted" && (k.allowedModels?.length ?? 0) === 0 && (k.allowedCombos ?? []).length === 1 && k.allowedCombos![0] === combo;
}

export interface TestResult {
  valid: boolean;
  error?: string | null;
  skipped?: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Thin client for OmniRoute's local management API. Credentials only ever go
// in request headers/bodies to a loopback address — never argv, URLs or logs.
export class OmniRouteClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly auth: OmniAuth | null,
    private fetchImpl: typeof fetch = fetch,
  ) {
    const u = new URL(baseUrl);
    if (!LOOPBACK_HOSTS.has(u.hostname)) throw new Error("OmniRoute must be on this computer (loopback address)");
    this.baseUrl = u.origin;
  }

  async health(timeoutMs = 2000): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return false;
      const body = (await res.json()) as { status?: string };
      return body.status === "ok";
    } catch {
      return false;
    }
  }

  // Keys in this listing are masked by OmniRoute.
  async listConnections(): Promise<Connection[]> {
    const body = await this.request<{ connections: Connection[] }>("GET", "/api/providers");
    return body.connections;
  }

  async addProvider(input: { provider: string; name: string; apiKey: string }): Promise<Connection> {
    const body = await this.request<{ connection: Connection }>("POST", "/api/providers", input);
    return body.connection;
  }

  async testConnection(id: string): Promise<TestResult> {
    return this.request<TestResult>("POST", `/api/providers/${encodeURIComponent(id)}/test`, {});
  }

  async getConnection(id: string): Promise<Connection> {
    const body = await this.request<{ connection: Connection }>("GET", `/api/providers/${encodeURIComponent(id)}`);
    return body.connection;
  }

  // The full key is returned only here, once. OmniRoute stores it encrypted
  // and only ever shows it masked afterwards. It can only call `combo`.
  async createGatewayKey(name: string, combo: string): Promise<{ id: string; key: string; name: string }> {
    return this.request("POST", "/api/keys", { name, ...comboOnlyAccess(combo) });
  }

  async listGatewayKeys(): Promise<GatewayKeyInfo[]> {
    return (await this.request<{ keys: GatewayKeyInfo[] }>("GET", "/api/keys")).keys;
  }

  async restrictGatewayKey(id: string, combo: string): Promise<void> {
    await this.request("PATCH", `/api/keys/${encodeURIComponent(id)}`, comboOnlyAccess(combo));
  }

  async listCombos(): Promise<Combo[]> {
    return (await this.request<{ combos: Combo[] }>("GET", "/api/combos")).combos;
  }

  // Tries targets in order and moves to the next one when a target fails or is out of quota.
  async saveCombo(name: string, models: string[]): Promise<Combo> {
    const existing = (await this.listCombos()).find((c) => c.name === name);
    const body = { name, models, strategy: "priority" };
    if (existing) return this.request<Combo>("PUT", `/api/combos/${encodeURIComponent(existing.id)}`, body);
    return this.request<Combo>("POST", "/api/combos", body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.auth?.kind === "cli-token") headers[CLI_TOKEN_HEADER] = this.auth.token;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Never let a redirect carry the credential to another origin.
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      let message = `${method} ${path} failed with HTTP ${res.status}`;
      try {
        const err = (await res.json()) as { error?: unknown };
        const detail = typeof err.error === "string" ? err.error : (err.error as { message?: string })?.message;
        if (detail) message += `: ${detail}`;
      } catch {
        // non-JSON error body
      }
      throw new OmniRouteError(message, res.status);
    }
    return (await res.json()) as T;
  }
}
