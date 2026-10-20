import { describe, expect, it } from "vitest";
import { ActionBus, runFlow, type FlowContext, type StepHandler } from "../../src/core/flow";
import type { State, Step } from "../../src/core/stateMachine";

const STEPS: Step[] = ["OPEN_SIGNUP", "WAIT_USER_AUTH", "CREATE_AND_CAPTURE", "VALIDATE", "REGISTER"];
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(overrides: Partial<Record<Step, StepHandler>> = {}) {
  const bus = new ActionBus();
  const states: State[] = [];
  const reasons: (string | undefined)[] = [];
  let registeredKey: string | null = null;
  let lastCtx: FlowContext | null = null;
  const handlers: Partial<Record<Step, StepHandler>> = {
    OPEN_SIGNUP: async () => ({ type: "NEXT" }),
    WAIT_USER_AUTH: async (ctx) => {
      await ctx.bus.wait(["done"], ctx.signal);
      return { type: "NEXT" };
    },
    CREATE_AND_CAPTURE: async (ctx) => {
      ctx.key = "gsk_captured";
      return { type: "NEXT" };
    },
    VALIDATE: async (ctx) => (ctx.key?.startsWith("gsk_") ? { type: "NEXT" } : { type: "FAIL", reason: "reason.keyRejected" }),
    REGISTER: async (ctx) => {
      registeredKey = ctx.key;
      ctx.key = null;
      ctx.connectionId = "conn-1";
      lastCtx = ctx;
      return { type: "NEXT" };
    },
    ...overrides,
  };
  const run = runFlow(STEPS, handlers, bus, {
    state: (s, info) => {
      states.push(s);
      reasons.push(info.reason);
    },
  });
  return { bus, run, states, reasons, registered: () => registeredKey, ctx: () => lastCtx };
}

describe("runFlow", () => {
  it("runs the happy path, waiting for the user where the step asks", async () => {
    const f = setup();
    await tick();
    expect(f.states.at(-1)).toBe("WAIT_USER_AUTH");
    f.bus.emit({ type: "done" });
    await expect(f.run).resolves.toEqual({ status: "done", connectionId: "conn-1" });
    expect(f.states).toEqual(STEPS);
    expect(f.registered()).toBe("gsk_captured");
  });

  it("skip interrupts a waiting step", async () => {
    const f = setup();
    await tick();
    f.bus.emit({ type: "skip" });
    await expect(f.run).resolves.toEqual({ status: "skipped", connectionId: undefined });
  });

  it("switch leaves the flow without a result", async () => {
    const f = setup();
    await tick();
    f.bus.emit({ type: "switch" });
    await expect(f.run).resolves.toEqual({ status: "switched" });
    expect(f.registered()).toBeNull();
  });

  it("a pasted key jumps straight to validation", async () => {
    const f = setup();
    await tick();
    f.bus.emit({ type: "paste", key: "  gsk_pasted  " });
    await f.run;
    expect(f.states).toEqual(["OPEN_SIGNUP", "WAIT_USER_AUTH", "VALIDATE", "REGISTER"]);
    expect(f.registered()).toBe("gsk_pasted");
  });

  it("a failing step goes to manual mode with its reason; retry runs it again", async () => {
    let attempts = 0;
    const f = setup({
      CREATE_AND_CAPTURE: async (ctx) => {
        attempts++;
        if (attempts === 1) return { type: "FAIL", reason: "reason.elementNotFound" };
        ctx.key = "gsk_second";
        return { type: "NEXT" };
      },
    });
    await tick();
    f.bus.emit({ type: "done" });
    await tick();
    expect(f.states.at(-1)).toBe("FAILED_MANUAL");
    expect(f.reasons.at(-1)).toBe("reason.elementNotFound");
    f.bus.emit({ type: "retry" });
    await f.run;
    expect(f.states.slice(-4)).toEqual(["FAILED_MANUAL", "CREATE_AND_CAPTURE", "VALIDATE", "REGISTER"]);
    expect(f.registered()).toBe("gsk_second");
  });

  it("an invalid pasted key lands back in manual mode, then a good one finishes", async () => {
    const f = setup();
    await tick();
    f.bus.emit({ type: "paste", key: "wrong" });
    await tick();
    await tick();
    expect(f.states.at(-1)).toBe("FAILED_MANUAL");
    expect(f.reasons.at(-1)).toBe("reason.keyRejected");
    f.bus.emit({ type: "paste", key: "gsk_good" });
    await expect(f.run).resolves.toMatchObject({ status: "done" });
    expect(f.registered()).toBe("gsk_good");
  });

  it("a thrown error becomes a failure, not a crash", async () => {
    const f = setup({
      OPEN_SIGNUP: async () => {
        throw new Error("boom");
      },
    });
    await tick();
    expect(f.states.at(-1)).toBe("FAILED_MANUAL");
    expect(f.reasons.at(-1)).toBe("boom");
    f.bus.emit({ type: "skip" });
    await expect(f.run).resolves.toMatchObject({ status: "skipped" });
  });

  it("does not keep the key after the flow", async () => {
    const f = setup({
      REGISTER: async (ctx) => {
        // simulate a handler that forgot to clear it
        ctx.connectionId = "c";
        captured = ctx;
        return { type: "NEXT" };
      },
    });
    let captured: FlowContext | null = null;
    await tick();
    f.bus.emit({ type: "paste", key: "gsk_x" });
    await f.run;
    expect((captured as FlowContext | null)?.key).toBeNull();
  });

  it("drops actions nobody is waiting for", () => {
    const bus = new ActionBus();
    expect(() => bus.emit({ type: "done" })).not.toThrow();
  });
});
