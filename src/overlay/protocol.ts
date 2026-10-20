import type { ElementSpec } from "../providers/types";

// Messages between the main process and the overlay preload in the guided window.

export type OverlayButton = "done" | "skip" | "paste" | "confirm" | "retry";

export interface OverlayState {
  title: string; // provider name
  progress: string; // "Step 2 of 7"
  hint: string;
  reason?: string;
  buttons: OverlayButton[];
  labels: Record<string, string>; // localized button/placeholder texts
}

export type OverlayCommand =
  | { id: number; cmd: "find"; spec: ElementSpec }
  | { id: number; cmd: "click"; spec: ElementSpec }
  | { id: number; cmd: "focus"; spec: ElementSpec }
  | { id: number; cmd: "scanKey"; pattern: string };

// Command without its id (distributes over the union).
export type OverlayCommandBody = OverlayCommand extends infer C ? (C extends unknown ? Omit<C, "id"> : never) : never;

export interface OverlayCommandResult {
  id: number;
  ok: boolean;
  value?: string;
}

export const CH = {
  state: "overlay:state",
  cmd: "overlay:cmd",
  cmdResult: "overlay:cmd-result",
  action: "overlay:action",
  ready: "overlay:ready",
} as const;
