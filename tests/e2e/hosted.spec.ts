import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the real bundled OmniRoute (vendor/omniroute). Slower than the mock
// suite; skipped until `npm run prepare:omniroute` has been run.
const VENDOR = join(__dirname, "..", "..", "vendor", "omniroute", "VERSION");
const PORT = 20148; // not the real default, so a running copy of the app isn't disturbed
const base = `http://127.0.0.1:${PORT}`;

test.skip(!existsSync(VENDOR), "bundled OmniRoute not prepared");
test.setTimeout(300_000);

let app: ElectronApplication;
let configFile = "";
let userDataDir = "";

async function relaunch(): Promise<Page> {
  app = await electron.launch({ args: ["."], env: { ...process.env, OMNIROUTE_ONBOARD_TEST_CONFIG: configFile } });
  return app.firstWindow();
}

const up = async () => {
  try {
    return (await fetch(`${base}/api/health`)).ok;
  } catch {
    return false;
  }
};
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test.afterEach(async () => {
  await app?.close();
});

test("hosts OmniRoute: locked down, usable key, stops on quit, keeps its data", async () => {
  const root = mkdtempSync(join(tmpdir(), "onboard-hosted-"));
  userDataDir = join(root, "userdata");
  configFile = join(root, "config.json");
  writeFileSync(configFile, JSON.stringify({ userDataDir, port: PORT, fakeClipboard: true, externalInWindow: true }));

  let wizard = await relaunch();
  await expect(button(wizard, "Start")).toBeVisible({ timeout: 180_000 });
  expect(await up()).toBe(true);

  // Its management API refuses anyone without our credentials.
  expect((await fetch(`${base}/api/providers`)).status).toBe(401);
  expect((await fetch(`${base}/api/keys`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"intruder"}' })).status).toBe(401);

  // First run: skip everything, land on home.
  await button(wizard, "Start").click();
  await wizard.getByRole("checkbox").first().uncheck();
  await button(wizard, "Connect selected").click();
  await button(wizard, "Skip this service").click();
  await expect(wizard.getByText("No services were connected.")).toBeVisible();
  await button(wizard, "Keep it").click();
  await button(wizard, "Done").click();
  await expect(wizard.getByText("OmniRoute is running.")).toBeVisible();
  await expect(wizard.getByText(`http://localhost:${PORT}/v1`)).toBeVisible();

  // No service yet: no key, and the user is told why.
  await button(wizard, "Create a new key").click();
  await expect(wizard.getByText("Connect a service first")).toBeVisible();

  // With a service connected (added through the app's client: test hook), a key is made.
  // Adding it makes OmniRoute test the connection once against api.groq.com, with a fake key.
  await app.evaluate(() => (globalThis as any).__onboardTestClient.addProvider({ provider: "groq", name: "test", apiKey: "gsk_" + "f".repeat(48) }));
  await button(wizard, "Create a new key").click();
  await button(wizard, "Show").click();
  const key = (await wizard.locator(".secret").nth(1).textContent())!.trim();
  expect(key).toMatch(/^sk-/);
  expect((await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } })).status).toBe(200);

  // Without a valid gateway key, nobody can use the AI services through it.
  const chat = (auth?: string) =>
    fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ model: "groq/some-model", messages: [{ role: "user", content: "hi" }] }),
    });
  expect((await chat()).status).toBe(401);
  expect((await chat("Bearer KEY")).status).toBe(401);

  // Settings are stored encrypted with the OS keychain where available.
  const secretsFile = JSON.parse(readFileSync(join(userDataDir, "secrets.json"), "utf8"));
  if (process.platform === "win32" || process.platform === "darwin") expect(secretsFile.encrypted).toBe(true);
  expect(readFileSync(join(userDataDir, "logs", "onboard.log"), "utf8")).not.toContain(key);

  // Quitting stops OmniRoute.
  await app.close();
  await expect.poll(up, { timeout: 15_000 }).toBe(false);

  // Reopening: home right away, same secrets, data still readable.
  wizard = await relaunch();
  await expect(wizard.getByText("OmniRoute is running.")).toBeVisible({ timeout: 180_000 });
  await expect(button(wizard, "Start")).toHaveCount(0);
  expect((await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } })).status).toBe(200);
  await button(wizard, "Create a new key").click();
  await expect(wizard.getByText("Copy the key now")).toBeVisible();
});

test("a key from this app can only reach the free combo, nothing that could cost money", async () => {
  const root = mkdtempSync(join(tmpdir(), "onboard-hosted-"));
  configFile = join(root, "config.json");
  writeFileSync(configFile, JSON.stringify({ userDataDir: join(root, "userdata"), port: PORT }));
  const wizard = await relaunch();
  await expect(button(wizard, "Start")).toBeVisible({ timeout: 180_000 });

  // Set up directly through the app's own client (test hook). Adding the
  // connection makes OmniRoute test it once against api.groq.com, with a fake key.
  const { key } = await app.evaluate(async () => {
    const c = (globalThis as any).__onboardTestClient;
    await c.addProvider({ provider: "groq", name: "test", apiKey: "gsk_" + "f".repeat(48) });
    await c.saveCombo("free", ["groq/openai/gpt-oss-20b"]);
    return c.createGatewayKey("omniroute-onboard-test", "free");
  });

  const chat = async (model: string) => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
    });
    const body = (await res.json()) as { error?: { code?: string } };
    return { status: res.status, code: body.error?.code };
  };
  // Everything except the combo is refused before any request goes out.
  for (const model of ["groq/openai/gpt-oss-20b", "openai/gpt-oss-20b", "auto", "auto/chat:free", "openrouter/openai/gpt-4o", "openrouter/auto", "another-combo"]) {
    expect(await chat(model), model).toEqual({ status: 403, code: "permission_denied" });
  }
  // The combo itself passes the key check (it then fails here only because the test key is fake).
  expect((await chat("free")).code).not.toBe("permission_denied");

  const models = (await (await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } })).json()) as { data: { id: string }[] };
  expect(models.data.map((m) => m.id)).toEqual(["free"]);
});
