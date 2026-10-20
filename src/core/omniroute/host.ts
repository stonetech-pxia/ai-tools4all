import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Runs the bundled OmniRoute server as a child process: our data folder, our
// port, our secrets, loopback only. The server is OmniRoute's own unmodified
// build; we only choose how it is started.

export interface ServerSecrets {
  jwtSecret: string;
  storageKey: string; // encrypts provider keys at rest; losing it loses them
  apiKeySecret: string;
  cliSalt: string; // lets us authenticate with OmniRoute's local machine token
  password: string; // locks the management API and the dashboard
}

export interface HostOptions {
  serverDir: string; // .../omniroute/dist
  dataDir: string;
  port: number;
  nodeBinary: string; // Electron's binary, run as Node
  secrets: ServerSecrets;
  logFile: string;
  pidFile: string;
  heapMb?: number;
  extraEnv?: Record<string, string>; // e.g. switches that turn off OmniRoute's own outbound checks
}

// Only what the server needs from the user's environment: system paths and
// proxy settings, nothing else.
const PASS_THROUGH = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"];

export function buildServerEnv(o: Pick<HostOptions, "dataDir" | "port" | "secrets" | "heapMb" | "extraEnv">, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASS_THROUGH) if (base[k]) env[k] = base[k] as string;
  return {
    ...env,
    ...o.extraEnv,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    NODE_OPTIONS: `--max-old-space-size=${o.heapMb ?? 768}`,
    DATA_DIR: o.dataDir,
    PORT: String(o.port),
    HOSTNAME: "127.0.0.1",
    // Background schedulers (health pings, maintenance) aren't needed to proxy requests.
    OMNIROUTE_DISABLE_BACKGROUND_SERVICES: "true",
    JWT_SECRET: o.secrets.jwtSecret,
    STORAGE_ENCRYPTION_KEY: o.secrets.storageKey,
    STORAGE_ENCRYPTION_KEY_VERSION: "v1",
    API_KEY_SECRET: o.secrets.apiKeySecret,
    OMNIROUTE_CLI_SALT: o.secrets.cliSalt,
    // Setting a password makes OmniRoute require authentication for its
    // management API; without it, any local program could change its settings.
    INITIAL_PASSWORD: o.secrets.password,
    // OmniRoute's default lets any local program (or web page) use /v1
    // without a key, spending the user's free quota. Require the gateway key.
    REQUIRE_API_KEY: "true",
  };
}

export type HostStatus = "stopped" | "starting" | "running" | "failed";

export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(`port ${port} is already in use by another program`);
    this.name = "PortInUseError";
  }
}

export class OmniRouteHost extends EventEmitter {
  status: HostStatus = "stopped";
  private child: ChildProcess | null = null;
  private stopping = false;
  private restarts: number[] = [];

  constructor(private o: HostOptions) {
    super();
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.o.port}`;
  }

  async healthy(timeoutMs = 1500): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Resolves once the server answers its health check. The very first start
  // can be slow (antivirus scanning thousands of new files).
  async start(readyTimeoutMs = 180_000): Promise<void> {
    if (this.child) return;
    this.killLeftover();
    if (await this.healthy()) throw new PortInUseError(this.o.port);

    this.stopping = false;
    this.setStatus("starting");
    mkdirSync(this.o.dataDir, { recursive: true });
    mkdirSync(dirname(this.o.logFile), { recursive: true });
    const out = openSync(this.o.logFile, "w");
    const entry = existsSync(join(this.o.serverDir, "server-ws.mjs")) ? "server-ws.mjs" : "server.js";
    const child = spawn(this.o.nodeBinary, [join(this.o.serverDir, entry)], {
      cwd: this.o.serverDir,
      env: buildServerEnv(this.o),
      stdio: ["ignore", out, out],
      windowsHide: true,
      // Own process group on macOS/Linux so stop() can end the whole tree.
      detached: process.platform !== "win32",
    });
    closeSync(out);
    this.child = child;
    if (child.pid) writeFileSync(this.o.pidFile, String(child.pid));

    let exitedEarly = false;
    child.once("exit", (code, signal) => {
      exitedEarly = true;
      const wasRunning = this.status === "running";
      if (this.child === child) this.child = null;
      rmSync(this.o.pidFile, { force: true });
      if (this.stopping) return this.setStatus("stopped");
      // Failing during startup is reported by start() itself; only a crash
      // after it was up triggers an automatic restart.
      if (!wasRunning) return;
      this.emit("crashed", { code, signal });
      this.restartAfterCrash();
    });

    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      if (exitedEarly) break;
      if (await this.healthy()) return this.setStatus("running");
      await new Promise((r) => setTimeout(r, 400));
    }
    this.stop();
    this.setStatus("failed");
    throw new Error(exitedEarly ? "OmniRoute exited during startup" : "OmniRoute did not start in time");
  }

  // Synchronous so it can run while the app is quitting.
  stop(): void {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    if (child?.pid) killTree(child.pid);
    rmSync(this.o.pidFile, { force: true });
    this.setStatus("stopped");
  }

  // A previous run that crashed may have left its server running; it holds
  // our data folder, so end it before starting a new one.
  private killLeftover(): void {
    if (!existsSync(this.o.pidFile)) return;
    const pid = Number(readFileSync(this.o.pidFile, "utf8"));
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) killTree(pid);
    rmSync(this.o.pidFile, { force: true });
  }

  // Up to 3 automatic restarts in 5 minutes, then give up and report.
  private restartAfterCrash(): void {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 5 * 60_000);
    if (this.restarts.length >= 3) return this.setStatus("failed");
    this.restarts.push(now);
    this.start().catch(() => this.setStatus("failed"));
  }

  private setStatus(s: HostStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit("status", s);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM"); // the whole process group
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}
