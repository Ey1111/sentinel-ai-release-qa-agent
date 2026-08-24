import { expect, it } from "vitest";
import { join } from "node:path";
import { resolveArtifactRoot } from "./run-config";

it("resolves the default artifact directory at the monorepo root", () => {
  const path = resolveArtifactRoot(undefined, join(process.cwd(), "apps", "worker"));
  expect(path.replaceAll("\\", "/")).toMatch(/\/sentinel\/artifacts$/);
  expect(path.replaceAll("\\", "/")).not.toContain("/apps/worker/artifacts");
});
