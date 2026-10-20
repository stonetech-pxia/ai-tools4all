import type { ProviderConfig } from "../providers/types";
import type { StepHandler } from "./flow";
import { log } from "./log";
import type { OmniRouteClient, TestResult } from "./omniroute/client";
import { validateKey } from "./validateKey";

export function todayStamp(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function keyName(d = new Date()): string {
  return `omniroute-${todayStamp(d)}`;
}

export function validateStep(p: ProviderConfig, fetchImpl: typeof fetch = fetch): StepHandler {
  return async (ctx) => {
    if (!ctx.key) return { type: "FAIL", reason: "reason.noKey" };
    const r = await validateKey(p.validate.url, ctx.key, fetchImpl);
    if (r.ok) return { type: "NEXT" };
    log("warn", `${p.id}: key validation failed`, { reason: r.reason, status: r.status });
    return { type: "FAIL", reason: r.reason === "rejected" ? "reason.keyRejected" : r.reason === "network" ? "reason.network" : "reason.validateUnexpected" };
  };
}

export function registerStep(p: ProviderConfig, client: () => OmniRouteClient, onTested: (r: TestResult) => void): StepHandler {
  return async (ctx) => {
    if (!ctx.key) return { type: "FAIL", reason: "reason.noKey" };
    const c = client();
    const conn = await c.addProvider({ provider: p.omnirouteId, name: `${p.displayName} (${keyName()})`, apiKey: ctx.key });
    ctx.key = null; // OmniRoute has it now (encrypted); drop our copy
    ctx.connectionId = conn.id;
    log("info", `${p.id}: added to OmniRoute`, { connectionId: conn.id });

    const test = await c.testConnection(conn.id);
    onTested(test);
    if (!test.valid && !test.skipped) {
      log("warn", `${p.id}: OmniRoute connection test failed`, { error: test.error });
      return { type: "FAIL", reason: "reason.omniTestFailed" };
    }
    return { type: "NEXT" };
  };
}
