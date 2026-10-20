import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineIdSync } from "node-machine-id";
import { startMockOmniRoute } from "../mock/omniroute";
import { GROQ_KEY, OPENROUTER_KEY, startMockServices } from "./mock/services";

const SALT = "b".repeat(64);
const GATEWAY_KEY = "sk-gateway0123456789abcdefghij";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let app: ElectronApplication;
let services: Awaited<ReturnType<typeof startMockServices>>;
let omni: Awaited<ReturnType<typeof startMockOmniRoute>>;
let userDataDir: string;

let configFile = "";

async function launch(groqKeysPath = "/groq/keys"): Promise<Page> {
  services = await startMockServices();
  // The mock only accepts the same machine token the real OmniRoute would derive.
  omni = await startMockOmniRoute({ token: createHmac("sha256", machineIdSync(true)).update(SALT).digest("hex") });

  const root = mkdtempSync(join(tmpdir(), "onboard-e2e-"));
  userDataDir = join(root, "userdata");

  const b = services.base;
  const config = {
    userDataDir,
    external: { baseUrl: omni.baseUrl, cliSalt: SALT },
    externalInWindow: true, // stands in for the user's own browser
    fakeClipboard: true, // never touch the real clipboard
    providers: {
      openrouter: {
        urls: { signup: `${b}/openrouter/auth` },
        oauth: { exchangeUrl: `${b}/openrouter/api/v1/auth/keys` },
        validate: { url: `${b}/openrouter/api/v1/key` },
        freeModels: { priority: 2, openRouterCatalog: `${b}/openrouter/api/v1/models` },
      },
      groq: {
        urls: { signup: `${b}/groq/login`, keys: `${b}${groqKeysPath}` },
        validate: { url: `${b}/groq/openai/v1/models` },
        guided: { loggedInUrl: `^${esc(b)}/groq/`, loggedOutUrl: `^${esc(b)}/groq/login`, timeouts: { authMs: 60_000, elementMs: 2_000, keyMs: 5_000 } },
      },
    },
  };
  configFile = join(root, "config.json");
  writeFileSync(configFile, JSON.stringify(config));
  return relaunch();
}

// Starts the app (again) with the same settings and user data.
async function relaunch(): Promise<Page> {
  app = await electron.launch({ args: ["."], env: { ...process.env, OMNIROUTE_ONBOARD_TEST_CONFIG: configFile } });
  return app.firstWindow();
}

test.afterEach(async () => {
  await app?.close();
  await services?.close();
  await omni?.close();
});

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function toProviderSelection(wizard: Page): Promise<void> {
  await button(wizard, "Start").click();
  await expect(wizard.getByText("Free plans have limits")).toBeVisible();
}

async function groqOnly(wizard: Page): Promise<void> {
  await toProviderSelection(wizard);
  await wizard.getByRole("checkbox").first().uncheck();
  const external = app.waitForEvent("window", (p) => p.url().includes("/groq/"));
  await button(wizard, "Connect selected").click();
  await external; // the keys page opened in the user's browser
  await expect(wizard.getByText(/may the helper pick it up from the clipboard?/)).toBeVisible();
}

// What the user's "Copy" click in their browser does.
const copyToClipboard = (text: string) => app.evaluate((_e, t) => void ((globalThis as any).__onboardTestClipboard.text = t), text);
const clipboardText = () => app.evaluate(() => (globalThis as any).__onboardTestClipboard.text as string);
const wizardOnTop = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("index.html"))!.isAlwaysOnTop());
const logText = () => readFileSync(join(userDataDir, "logs", "onboard.log"), "utf8");

test("default: both services through the user's own browser, key picked up from the clipboard", async () => {
  const wizard = await launch();
  await toProviderSelection(wizard);
  await button(wizard, "Connect selected").click();

  // OpenRouter: confirm, then the (mock) approval page redirects to our callback.
  await expect(wizard.getByText(/OpenRouter creates a key named "omniroute-\d{8}"/)).toBeVisible();
  const groqPage = app.waitForEvent("window", (p) => p.url().includes("/groq/"));
  await button(wizard, "Yes, create it").click();

  // Groq opens in "the user's browser" (here: a plain window) and the wizard asks about the clipboard.
  await groqPage;
  await expect(wizard.getByText(/may the helper pick it up from the clipboard\?/)).toBeVisible();
  expect(await wizardOnTop()).toBe(true); // small always-on-top window next to the browser
  await wizard.screenshot({ path: "test-results/compact-ask.png" });
  await button(wizard, "Yes, pick it up").click();
  await expect(wizard.getByText(/click Copy\. The helper picks up the key as soon as you copy it\./)).toBeVisible();

  await copyToClipboard("some unrelated text"); // ignored
  await copyToClipboard(GROQ_KEY);

  await expect(wizard.getByRole("heading", { name: "All set" })).toBeVisible({ timeout: 30_000 });
  expect(await wizardOnTop()).toBe(false);
  expect(await clipboardText()).toBe(""); // key removed from the clipboard
  await expect(wizard.getByText(`http://localhost:${omni.port}/v1`)).toBeVisible();
  await expect(wizard.getByText("OpenRouter: working")).toBeVisible();
  await expect(wizard.getByText("Groq: working")).toBeVisible();
  // The gateway key is masked until "Show".
  await expect(wizard.getByText(GATEWAY_KEY)).toHaveCount(0);
  await button(wizard, "Show").click();
  await expect(wizard.getByText(GATEWAY_KEY)).toBeVisible();

  // OmniRoute received both keys, each exactly once, in the body of one request.
  expect([...omni.connections.values()].map((c) => [c.provider, c.apiKey])).toEqual([
    ["openrouter", OPENROUTER_KEY],
    ["groq", GROQ_KEY],
  ]);
  // The key may only call the "free" combo, which holds only free models.
  expect([...omni.combos.values()]).toEqual([
    expect.objectContaining({ name: "free", strategy: "priority", models: ["groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-20b", "groq/qwen/qwen3.8-27b", "groq/qwen/qwen3.6-27b", "openrouter/meta/free-one:free"] }),
  ]);
  expect([...omni.keys.values()]).toEqual([expect.objectContaining({ modelAccessMode: "restricted", allowedModels: [], allowedCombos: ["free"] })]);
  await expect(wizard.getByText(/use the model name free/)).toBeVisible();

  for (const key of [GROQ_KEY, OPENROUTER_KEY]) {
    expect(omni.requests.filter((r) => r.body.includes(key))).toHaveLength(1);
    expect(omni.requests.some((r) => r.url.includes(key))).toBe(false);
  }
  expect(logText()).toContain("groq: key picked up from the clipboard");
  for (const secret of [GROQ_KEY, OPENROUTER_KEY, GATEWAY_KEY]) expect(logText()).not.toContain(secret);
});

test("declining clipboard detection: the user pastes the key", async () => {
  const wizard = await launch();
  await groqOnly(wizard);
  await button(wizard, "No, I'll paste it").click();
  await expect(wizard.getByText(/Then paste the key below\./)).toBeVisible();
  await copyToClipboard(GROQ_KEY);
  await wizard.waitForTimeout(1500);
  await expect(wizard.getByText(/Then paste the key below\./)).toBeVisible(); // not picked up
  expect(await clipboardText()).toBe(GROQ_KEY);

  await wizard.getByPlaceholder("Paste your API key here").fill(GROQ_KEY);
  await button(wizard, "Use this key").click();
  await expect(wizard.getByText("Groq: working")).toBeVisible({ timeout: 15_000 });
});

test("helper-window mode: signs in, creates and reads the key automatically", async () => {
  const wizard = await launch();
  await groqOnly(wizard);
  const groqWindow = app.waitForEvent("window", (p) => p.url().includes("/groq/login"));
  await button(wizard, "Let the helper click for me (separate window)").click();

  const groq = await groqWindow;
  await expect(wizard.getByText(/Please sign in or create your Groq account in this window/)).toBeVisible();
  await expect(groq.locator("omniroute-onboard-overlay")).toHaveCount(1);
  expect(await wizardOnTop()).toBe(false);
  await groq.click("#signin"); // the "user" signs in

  await expect(wizard.getByText(/Create a key named "omniroute-\d{8}" in your Groq account\?/)).toBeVisible();
  await expect(groq.locator("omniroute-onboard-overlay")).toHaveCount(1); // re-injected after navigation
  await groq.waitForTimeout(300);
  await groq.screenshot({ path: "test-results/overlay-confirm.png" });
  await button(wizard, "Yes, create it").click();

  await expect(wizard.getByText("Groq: working")).toBeVisible({ timeout: 15_000 });
  expect([...omni.connections.values()].map((c) => c.apiKey)).toEqual([GROQ_KEY]);
  expect(logText()).toContain("groq: key captured from page");
  expect(logText()).not.toContain(GROQ_KEY);
});

test("helper-window mode falls back to manual when the page changed; a pasted key still works", async () => {
  const wizard = await launch("/groq/keys-redesigned");
  await groqOnly(wizard);
  const groqWindow = app.waitForEvent("window", (p) => p.url().includes("/groq/login"));
  await button(wizard, "Let the helper click for me (separate window)").click();
  const groq = await groqWindow;
  await groq.click("#signin");

  // The "Create API Key" button is missing on the redesigned page.
  await expect(wizard.getByText("The page looks different than expected")).toBeVisible({ timeout: 15_000 });
  await expect(wizard.getByText(/Do it by hand: open .*keys-redesigned/)).toBeVisible();

  // A wrong key is rejected and we stay in manual mode.
  await wizard.getByPlaceholder("Paste your API key here").fill("gsk_wrongwrongwrongwrongwrong1234");
  await button(wizard, "Use this key").click();
  await expect(wizard.getByText("The service says this key isn't valid.")).toBeVisible();

  await wizard.getByPlaceholder("Paste your API key here").fill(GROQ_KEY);
  await button(wizard, "Use this key").click();
  await expect(wizard.getByText("Groq: working")).toBeVisible({ timeout: 15_000 });
  for (const secret of [GROQ_KEY, "gsk_wrongwrongwrongwrongwrong1234"]) expect(logText()).not.toContain(secret);
});

test("closing the helper window offers a retry that reopens it", async () => {
  const wizard = await launch();
  await groqOnly(wizard);
  let groqWindow = app.waitForEvent("window", (p) => p.url().includes("/groq/login"));
  await button(wizard, "Let the helper click for me (separate window)").click();
  await (await groqWindow).close();

  await expect(wizard.getByText("The service window was closed.")).toBeVisible();
  groqWindow = app.waitForEvent("window", (p) => p.url().includes("/groq/login"));
  await button(wizard, "Try automatically again").click();
  const groq = await groqWindow;
  await groq.click("#signin");
  await button(wizard, "Yes, create it").click();
  await expect(wizard.getByText("Groq: working")).toBeVisible({ timeout: 15_000 });
});

test("skipping every service creates no gateway key", async () => {
  const wizard = await launch();
  await toProviderSelection(wizard);
  await button(wizard, "Connect selected").click();
  await button(wizard, "No, skip").click(); // OpenRouter
  await expect(wizard.getByText(/may the helper pick it up from the clipboard\?/)).toBeVisible();
  await button(wizard, "Skip this service").click();
  await expect(wizard.getByText("No services were connected.")).toBeVisible();
  expect(omni.requests.some((r) => r.method === "POST" && r.url === "/api/keys")).toBe(false);
  expect(omni.connections.size).toBe(0);
});

test("after setup: reopening shows home, a connected service can't be added twice, a new key can be created", async () => {
  let wizard = await launch();
  await groqOnly(wizard);
  await button(wizard, "No, I'll paste it").click();
  await wizard.getByPlaceholder("Paste your API key here").fill(GROQ_KEY);
  await button(wizard, "Use this key").click();
  await expect(wizard.getByText("Groq: working")).toBeVisible({ timeout: 15_000 });
  await button(wizard, "Keep it").click();
  await button(wizard, "Done").click();

  // Home
  await expect(wizard.getByText("OmniRoute is running.")).toBeVisible();
  await expect(wizard.getByText("Groq: connected")).toBeVisible();
  await expect(wizard.getByText("OpenRouter: not connected")).toBeVisible();
  await expect(wizard.getByText(GATEWAY_KEY)).toHaveCount(0); // the setup key is not shown again
  await wizard.screenshot({ path: "test-results/home.png" });

  // Reopening goes straight to home, not the first-run wizard.
  await app.close();
  wizard = await relaunch();
  await expect(wizard.getByText("Groq: connected")).toBeVisible();
  await expect(button(wizard, "Start")).toHaveCount(0);

  // Groq is already connected, so it can't be picked again.
  await button(wizard, "Add services").click();
  await expect(wizard.getByRole("checkbox").nth(1)).toBeDisabled();
  await expect(wizard.getByRole("checkbox").nth(0)).toBeEnabled();
  await button(wizard, "Back").click();

  // Lost the key? Make a new one.
  const keysBefore = omni.requests.filter((r) => r.url === "/api/keys").length;
  await button(wizard, "Create a new key").click();
  await button(wizard, "Show").click();
  await expect(wizard.getByText(GATEWAY_KEY)).toBeVisible();
  expect(omni.requests.filter((r) => r.url === "/api/keys")).toHaveLength(keysBefore + 1);
  expect(omni.connections.size).toBe(1);
});

test("keys from earlier versions are put under the free-only rule at startup", async () => {
  // Same mock OmniRoute across two launches; plant an old unrestricted key in between.
  let wizard = await launch();
  await expect(button(wizard, "Start")).toBeVisible();
  omni.keys.set("old", { id: "old", name: "omniroute-onboard-20261019", modelAccessMode: "all" });
  omni.keys.set("mine", { id: "mine", name: "my own key", modelAccessMode: "all" }); // not ours: left alone
  await app.close();
  wizard = await relaunch();
  await expect(button(wizard, "Start")).toBeVisible();
  await expect.poll(() => omni.keys.get("old")).toMatchObject({ modelAccessMode: "restricted", allowedModels: [], allowedCombos: ["free"] });
  expect(omni.keys.get("mine")).toMatchObject({ modelAccessMode: "all" });
});
