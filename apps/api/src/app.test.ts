import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("API health contract", () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("reports liveness without requiring the database", async () => {
    const app = buildApp({ checkDatabase: async () => true });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "sentinel-api", status: "ok" });
  });

  it("reports database readiness failures as unavailable", async () => {
    const app = buildApp({ checkDatabase: async () => false });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ database: "unavailable", status: "not-ready" });
  });
});
