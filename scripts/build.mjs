import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const common = { bundle: true, sourcemap: false, logLevel: "warning", target: "es2023" };

await Promise.all([
  // Electron main process.
  build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main.js", platform: "node", format: "cjs", external: ["electron"] }),
  // Sandboxed preloads must be single CommonJS files that only require("electron").
  build({ ...common, entryPoints: ["src/ui/preload.ts"], outfile: "dist/ui-preload.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/overlay/preload.ts"], outfile: "dist/overlay-preload.js", platform: "node", format: "cjs", external: ["electron"] }),
  // Wizard renderer.
  build({ ...common, entryPoints: ["src/ui/wizard.ts"], outfile: "dist/wizard.js", platform: "browser", format: "iife" }),
]);

cpSync("src/ui/index.html", "dist/index.html");
cpSync("src/ui/wizard.css", "dist/wizard.css");
