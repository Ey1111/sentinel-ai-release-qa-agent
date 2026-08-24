import { describe, expect, it } from "vitest";
import { parseDatabaseUrl } from "./index";

describe("database configuration", () => {
  it("rejects a non-PostgreSQL URL before opening a connection", () => {
    expect(() => parseDatabaseUrl("sqlite://local.db")).toThrow("DATABASE_URL must use postgres:// or postgresql://");
  });

  it("accepts a PostgreSQL URL", () => {
    expect(parseDatabaseUrl("postgres://sentinel:secret@localhost:5432/sentinel").protocol).toBe("postgres:");
  });
});
