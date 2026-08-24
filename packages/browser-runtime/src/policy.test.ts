import { describe, expect, it } from "vitest";
import { DomainPolicy, PolicyViolationError } from "./policy";

describe("DomainPolicy", () => {
  const policy = new DomainPolicy({ allowedOrigins: ["http://127.0.0.1:4174"], allowLocalhost: true });

  it("allows the exact configured development origin", () => {
    expect(policy.assertAllowed("http://127.0.0.1:4174/projects").origin).toBe("http://127.0.0.1:4174");
  });

  it("blocks a different port on the same host", () => {
    expect(() => policy.assertAllowed("http://127.0.0.1:9000/projects")).toThrow(PolicyViolationError);
  });

  it("blocks embedded URL credentials", () => {
    expect(() => policy.assertAllowed("http://user:secret@127.0.0.1:4174/")).toThrow("URL credentials are not allowed");
  });

  it("requires explicit development mode for localhost", () => {
    const productionPolicy = new DomainPolicy({ allowedOrigins: ["http://localhost:4174"], allowLocalhost: false });
    expect(() => productionPolicy.assertAllowed("http://localhost:4174/")).toThrow("Local network targets require development mode");
  });
});
