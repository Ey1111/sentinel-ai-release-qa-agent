import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ArtifactStore } from "./artifact-store";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

it("stores an artifact with a relative key and SHA-256 manifest entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "sentinel-artifacts-"));
  roots.push(root);
  const store = new ArtifactStore({ rootDir: root, runId: "run-1", now: () => new Date("2026-08-24T10:00:00.000Z") });
  await store.initialize();
  const entry = await store.writeText("observations/step-1.txt", "visible state", "text/plain", { stepId: "step-1", redacted: true });
  expect(entry).toMatchObject({ key: "observations/step-1.txt", mimeType: "text/plain", size: 13, redacted: true, sha256: "2102a2dffebee82e3a55c87527c32b26ac98d337d2190502c169c358a3dc467b" });
  const manifest = JSON.parse(await readFile(join(root, "runs", "run-1", "manifest.json"), "utf8"));
  expect(manifest.artifacts).toEqual([entry]);
});

it("rejects artifact keys that escape the run directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "sentinel-artifacts-"));
  roots.push(root);
  const store = new ArtifactStore({ rootDir: root, runId: "run-1" });
  await store.initialize();
  await expect(store.writeText("../outside.txt", "unsafe", "text/plain", { redacted: false })).rejects.toThrow("Artifact key must stay inside the run directory");
});

it("rejects an existing run directory instead of mixing artifact generations", async () => {
  const root = await mkdtemp(join(tmpdir(), "sentinel-artifacts-"));
  roots.push(root);
  const first = new ArtifactStore({ rootDir: root, runId: "run-1" });
  await first.initialize();
  const duplicate = new ArtifactStore({ rootDir: root, runId: "run-1" });
  await expect(duplicate.initialize()).rejects.toThrow("Artifact run already exists: run-1");
});

it.each([
  ["parent traversal", "../escape"],
  ["an absolute path", join(tmpdir(), "sentinel-absolute-run")],
])("rejects %s as a run ID before resolving an artifact directory", (_label, runId) => {
  expect(() => new ArtifactStore({ rootDir: tmpdir(), runId })).toThrow("Artifact run ID must be a safe single path segment");
});
