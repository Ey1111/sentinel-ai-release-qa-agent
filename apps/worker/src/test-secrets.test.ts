import { describe, expect, it } from "vitest";
import { secretsForRun } from "./test-secrets";

const env = {
  SENTINEL_SECRET_ALLOWED_ORIGINS: "http://localhost:4174, https://staging.example.com",
  SENTINEL_SECRET_APP_PASSWORD: "hunter2",
  SENTINEL_SECRET_APP_EMAIL: "qa@example.com",
  DEEPSEEK_API_KEY: "must-not-be-offered",
};

describe("secretsForRun", () => {
  it("offers only secret names to an approved origin and resolves their values", async () => {
    const secrets = secretsForRun(env, ["http://localhost:4174"]);
    expect(secrets.refs).toEqual(["APP_EMAIL", "APP_PASSWORD"]);
    expect(await secrets.resolve("APP_PASSWORD")).toBe("hunter2");
  });

  it("offers nothing to an origin outside the approved list", async () => {
    const secrets = secretsForRun(env, ["https://other.example.com"]);
    expect(secrets.refs).toEqual([]);
    await expect(secrets.resolve("APP_PASSWORD")).rejects.toThrow();
  });

  it("offers nothing when any origin of the run is unapproved or none are approved", () => {
    expect(secretsForRun(env, ["http://localhost:4174", "https://other.example.com"]).refs).toEqual([]);
    expect(secretsForRun({ SENTINEL_SECRET_APP_PASSWORD: "x" }, ["http://localhost:4174"]).refs).toEqual([]);
  });

  it("never exposes other environment variables or the allowlist as secrets", () => {
    const { refs } = secretsForRun(env, ["http://localhost:4174"]);
    expect(refs).not.toContain("ALLOWED_ORIGINS");
    expect(refs.join()).not.toContain("DEEPSEEK");
  });
});
