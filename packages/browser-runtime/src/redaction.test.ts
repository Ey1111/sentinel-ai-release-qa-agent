import { expect, it } from "vitest";
import { redactSecrets } from "./redaction";

it("redacts common credential patterns before evidence persistence", () => {
  expect(redactSecrets("password=sentinel-demo Authorization: Bearer abc.def API_KEY=sk-test")).toBe(
    "password=[REDACTED] Authorization: Bearer [REDACTED] API_KEY=[REDACTED]",
  );
});

it("redacts exact secret values even when a page renders them without a key", () => {
  expect(redactSecrets("Demo credential: sentinel-demo", ["sentinel-demo"])).toBe("Demo credential: [REDACTED]");
});
