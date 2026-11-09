import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Evidence, EvidenceType } from "@sentinel/contracts";
import {
  createFilesystemEvidenceArtifactReader,
  resolveArtifactRoot,
  resolveEvidenceArtifactPath,
} from "./evidence-artifact-reader";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function artifactEvidence(runId: string, artifactPath: string, type: EvidenceType = "TRACE"): Evidence {
  return {
    schemaVersion: "1",
    id: `evidence-${type.toLowerCase()}`,
    runId,
    stepId: "step-1",
    type,
    artifactPath,
    sha256: "a".repeat(64),
    createdAt: "2026-08-31T00:00:00.000Z",
    redactionStatus: "NOT_REQUIRED",
  };
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("filesystem evidence artifact reader", () => {
  it("resolves the default artifact root at the monorepo root", () => {
    expect(resolveArtifactRoot(undefined, join(process.cwd(), "apps", "api")))
      .toBe(resolve(process.cwd(), "artifacts"));
  });

  it("resolves only paths contained by the evidence run directory", () => {
    const root = resolve("test-artifacts");
    const expected = resolve(root, "runs", "run-1", "screenshots", "proof.png");

    expect(resolveEvidenceArtifactPath(root, artifactEvidence("run-1", "screenshots/proof.png", "SCREENSHOT")))
      .toBe(expected);
    expect(resolveEvidenceArtifactPath(root, artifactEvidence("run-1", "../../outside.txt"))).toBeUndefined();
    expect(resolveEvidenceArtifactPath(root, artifactEvidence("run-1", "../run-10/secret.json"))).toBeUndefined();
    expect(resolveEvidenceArtifactPath(root, artifactEvidence("run-1", resolve(root, "outside.txt")))).toBeUndefined();
    expect(resolveEvidenceArtifactPath(root, artifactEvidence("../outside-run", "trace.json"))).toBeUndefined();
  });

  it("reads artifacts with controlled content types and returns undefined for missing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-api-artifacts-"));
    temporaryRoots.push(root);
    const reader = createFilesystemEvidenceArtifactReader(root);
    const fixtures = [
      { artifactPath: "screenshots/proof.png", type: "SCREENSHOT" as const, content: Buffer.from("png"), contentType: "image/png" },
      { artifactPath: "traces/events.json", type: "TRACE" as const, content: Buffer.from("{\"ok\":true}"), contentType: "application/json" },
      { artifactPath: "traces/archive.zip", type: "TRACE" as const, content: Buffer.from("zip"), contentType: "application/octet-stream" },
    ];

    for (const fixture of fixtures) {
      const evidence = artifactEvidence("run-1", fixture.artifactPath, fixture.type);
      evidence.sha256 = sha256(fixture.content);
      const path = resolve(root, "runs", evidence.runId, evidence.artifactPath!);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, fixture.content);
      await expect(reader(evidence)).resolves.toEqual({ content: fixture.content, contentType: fixture.contentType });
    }

    await expect(reader(artifactEvidence("run-1", "traces/missing.json"))).resolves.toBeUndefined();
  });

  it("rejects artifact content that does not match the recorded SHA-256", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-api-artifacts-"));
    temporaryRoots.push(root);
    const evidence = artifactEvidence("run-1", "traces/events.json");
    evidence.sha256 = sha256(Buffer.from("expected"));
    const path = resolve(root, "runs", evidence.runId, evidence.artifactPath!);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from("tampered"));

    await expect(createFilesystemEvidenceArtifactReader(root)(evidence)).resolves.toBeUndefined();
  });

  it("rejects a symlink whose real target escapes the run directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-api-artifacts-"));
    const outside = await mkdtemp(join(tmpdir(), "sentinel-api-outside-"));
    temporaryRoots.push(root, outside);
    const content = Buffer.from("secret");
    await writeFile(resolve(outside, "secret.json"), content);
    const runDirectory = resolve(root, "runs", "run-1");
    await mkdir(runDirectory, { recursive: true });
    await symlink(outside, resolve(runDirectory, "traces"), process.platform === "win32" ? "junction" : "dir");
    const evidence = artifactEvidence("run-1", "traces/secret.json");
    evidence.sha256 = sha256(content);

    await expect(createFilesystemEvidenceArtifactReader(root)(evidence)).resolves.toBeUndefined();
  });
});
