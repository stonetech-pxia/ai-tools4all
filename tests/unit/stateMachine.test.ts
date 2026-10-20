import { describe, expect, it } from "vitest";
import { transition, type State, type Step } from "../../src/core/stateMachine";
import groq from "../../src/providers/groq/config.json";
import openrouter from "../../src/providers/openrouter/config.json";

const GUIDED = groq.guidedSteps as Step[];

describe("transition", () => {
  it("walks the guided steps in order, then DONE", () => {
    let s: State = GUIDED[0];
    const seen: State[] = [s];
    while (s !== "DONE") seen.push((s = transition(GUIDED, s, { type: "NEXT" })));
    expect(seen).toEqual([...GUIDED, "DONE"]);
  });

  it("skip ends the flow from any state, including manual mode", () => {
    for (const s of [...GUIDED, "FAILED_MANUAL" as const]) expect(transition(GUIDED, s, { type: "SKIP" })).toBe("SKIPPED");
  });

  it("failure goes to manual mode; a pasted key goes to validation", () => {
    expect(transition(GUIDED, "GOTO_KEYS", { type: "FAIL", reason: "x" })).toBe("FAILED_MANUAL");
    expect(transition(GUIDED, "FAILED_MANUAL", { type: "MANUAL_KEY" })).toBe("VALIDATE");
    expect(transition(GUIDED, "WAIT_USER_AUTH", { type: "MANUAL_KEY" })).toBe("VALIDATE");
  });

  it("NEXT does not leave manual mode", () => {
    expect(transition(GUIDED, "FAILED_MANUAL", { type: "NEXT" })).toBe("FAILED_MANUAL");
  });

  it("terminal states stay terminal", () => {
    expect(transition(GUIDED, "DONE", { type: "FAIL", reason: "x" })).toBe("DONE");
    expect(transition(GUIDED, "SKIPPED", { type: "NEXT" })).toBe("SKIPPED");
  });

  it("rejects states that are not in the flow", () => {
    expect(() => transition(openrouter.steps as Step[], "WAIT_USER_AUTH", { type: "NEXT" })).toThrow();
  });

  it("every provider flow ends with VALIDATE then REGISTER", () => {
    for (const steps of [groq.steps, groq.guidedSteps, openrouter.steps]) expect(steps.slice(-2)).toEqual(["VALIDATE", "REGISTER"]);
  });
});
