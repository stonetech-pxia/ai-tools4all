import { TERMINAL, transition, type FlowEvent, type State, type Step } from "./stateMachine";

export type UserAction =
  | { type: "done" } // "I'm done" (e.g. finished logging in)
  | { type: "confirm"; yes: boolean }
  | { type: "skip" }
  | { type: "paste"; key: string }
  | { type: "retry" } // retry the automated path from manual mode
  | { type: "clipboard"; allow: boolean } // answer to "may we watch the clipboard?"
  | { type: "switch" }; // leave this flow for the provider's other mode

// Delivers user actions to whoever is waiting for them.
export class ActionBus {
  private waiters: { types: UserAction["type"][]; resolve: (a: UserAction) => void }[] = [];

  emit(action: UserAction): void {
    const i = this.waiters.findIndex((w) => w.types.includes(action.type));
    if (i === -1) return; // nobody listening: drop (e.g. a stale double click)
    const [w] = this.waiters.splice(i, 1);
    w.resolve(action);
  }

  wait<T extends UserAction["type"]>(types: T[], signal: AbortSignal): Promise<Extract<UserAction, { type: T }>> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const waiter = { types, resolve: resolve as (a: UserAction) => void };
      this.waiters.push(waiter);
      signal.addEventListener(
        "abort",
        () => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }
}

export interface FlowContext {
  signal: AbortSignal; // aborted when the step is interrupted (skip, paste)
  bus: ActionBus;
  // The key lives only here, only for the duration of the flow.
  key: string | null;
  connectionId?: string;
}

export type StepHandler = (ctx: FlowContext) => Promise<FlowEvent>;

export interface FlowReporter {
  state(state: State, info: { index: number; total: number; reason?: string }): void;
}

export interface FlowResult {
  status: "done" | "skipped" | "switched";
  connectionId?: string;
}

export async function runFlow(
  steps: readonly Step[],
  handlers: Partial<Record<Step, StepHandler>>,
  bus: ActionBus,
  reporter: FlowReporter,
): Promise<FlowResult> {
  const ctx: FlowContext = { signal: new AbortController().signal, bus, key: null };
  let state: State = steps[0];
  let reason: string | undefined;
  let retryFrom: State = steps[0];

  try {
    while (!TERMINAL.has(state)) {
      reporter.state(state, { index: Math.max(0, steps.indexOf(state as Step)), total: steps.length, reason });
      const step = new AbortController();
      ctx.signal = step.signal;

      const interrupts = bus.wait(["skip", "paste", "switch", ...(state === "FAILED_MANUAL" ? (["retry"] as const) : [])], step.signal);
      const work: Promise<FlowEvent> | null =
        state === "FAILED_MANUAL" ? null : (handlers[state as Step] ?? missing(state))(ctx);

      let event: FlowEvent;
      try {
        const winner = await Promise.race([
          interrupts.then((a) => ({ from: "user" as const, a })),
          ...(work ? [work.then((e) => ({ from: "step" as const, e }))] : []),
        ]);
        if (winner.from === "step") event = winner.e;
        else if (winner.a.type === "skip") event = { type: "SKIP" };
        else if (winner.a.type === "switch") return { status: "switched" };
        else if (winner.a.type === "paste") {
          ctx.key = winner.a.key.trim();
          event = { type: "MANUAL_KEY" };
        } else {
          // retry: leave manual mode and start the automated path again
          state = retryFrom;
          reason = undefined;
          continue;
        }
      } catch (err) {
        event = { type: "FAIL", reason: err instanceof Error ? err.message : String(err) };
      } finally {
        step.abort(new Error("step finished"));
        work?.catch(() => undefined);
        interrupts.catch(() => undefined);
      }

      if (event.type === "FAIL") {
        reason = event.reason;
        // Retrying from manual mode restarts the step that failed, except after
        // validation/registration, where only a different key helps.
        if (state !== "FAILED_MANUAL") retryFrom = state === "VALIDATE" ? steps[0] : state;
      } else reason = undefined;
      state = transition(steps, state, event);
    }
    return { status: state === "DONE" ? "done" : "skipped", connectionId: ctx.connectionId };
  } finally {
    ctx.key = null;
  }
}

function missing(state: State): StepHandler {
  return async () => ({ type: "FAIL", reason: `no handler for ${state}` });
}
