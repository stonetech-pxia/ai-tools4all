// Per-provider flow. Each provider declares which steps it uses, in order;
// transitions between them are the same for every provider.

export type Step =
  | "OPEN_SIGNUP"
  | "WAIT_USER_AUTH"
  | "GOTO_KEYS"
  | "CONFIRM_CREATE"
  | "CREATE_AND_CAPTURE"
  | "VALIDATE"
  | "REGISTER";

export type State = Step | "FAILED_MANUAL" | "DONE" | "SKIPPED";

export type FlowEvent =
  | { type: "NEXT" } // current step succeeded
  | { type: "FAIL"; reason: string } // step could not complete (element not found, invalid key, ...)
  | { type: "SKIP" } // user skipped this provider (or declined key creation)
  | { type: "MANUAL_KEY" }; // user pasted a key; go straight to validation

export const TERMINAL: ReadonlySet<State> = new Set(["DONE", "SKIPPED"]);

export function transition(steps: readonly Step[], state: State, event: FlowEvent): State {
  if (TERMINAL.has(state)) return state;
  switch (event.type) {
    case "SKIP":
      return "SKIPPED";
    case "FAIL":
      // A failed REGISTER is not fixed by pasting another key, but the user can
      // still retry from manual mode; keep one fallback state for simplicity.
      return "FAILED_MANUAL";
    case "MANUAL_KEY":
      if (!steps.includes("VALIDATE")) throw new Error("flow has no VALIDATE step");
      return "VALIDATE";
    case "NEXT": {
      if (state === "FAILED_MANUAL") return state; // only MANUAL_KEY or SKIP leave manual mode
      const i = steps.indexOf(state as Step);
      if (i === -1) throw new Error(`state ${state} is not part of this flow`);
      return i === steps.length - 1 ? "DONE" : steps[i + 1];
    }
  }
}
