import { describe, expect, it } from "vitest";
import { buildServerEnv } from "../../src/core/omniroute/host";

const secrets = { jwtSecret: "j", storageKey: "s", apiKeySecret: "a", cliSalt: "c", password: "p" };

describe("buildServerEnv", () => {
  const env = buildServerEnv(
    { dataDir: "/data", port: 20138, secrets, extraEnv: { SOME_SWITCH: "false" } },
    { PATH: "/bin", HTTPS_PROXY: "http://proxy:8080", AWS_SECRET_ACCESS_KEY: "nope", OPENAI_API_KEY: "nope", NODE_OPTIONS: "--inspect" },
  );

  it("binds to loopback on our port with our data folder", () => {
    expect(env).toMatchObject({ HOSTNAME: "127.0.0.1", PORT: "20138", DATA_DIR: "/data", NODE_ENV: "production", ELECTRON_RUN_AS_NODE: "1" });
  });

  it("passes our secrets, including the password that locks the management API", () => {
    expect(env).toMatchObject({ JWT_SECRET: "j", STORAGE_ENCRYPTION_KEY: "s", API_KEY_SECRET: "a", OMNIROUTE_CLI_SALT: "c", INITIAL_PASSWORD: "p" });
    expect(env.REQUIRE_API_KEY).toBe("true");
  });

  it("only passes system paths and proxy settings from the user's environment", () => {
    expect(env.PATH).toBe("/bin");
    expect(env.HTTPS_PROXY).toBe("http://proxy:8080");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=768");
  });

  it("applies extra switches and turns background services off", () => {
    expect(env.SOME_SWITCH).toBe("false");
    expect(env.OMNIROUTE_DISABLE_BACKGROUND_SERVICES).toBe("true");
  });
});
