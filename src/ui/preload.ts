import { contextBridge, ipcRenderer } from "electron";
import type { UiAction, UiState } from "./types";

// The wizard page gets exactly two functions: send an action, receive state.
contextBridge.exposeInMainWorld("onboard", {
  send: (action: UiAction) => ipcRenderer.send("ui:action", action),
  onState: (cb: (s: UiState) => void) => {
    ipcRenderer.on("ui:state", (_e, s: UiState) => cb(s));
  },
});
