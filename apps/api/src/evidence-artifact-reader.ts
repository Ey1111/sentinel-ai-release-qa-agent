import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Evidence } from "@sentinel/contracts";

export type EvidenceArtifact = { content: Buffer; contentType: string };

export function resolveArtifactRoot(explicitRoot: string | undefined, startDirectory = process.cwd()): string {
  if (explicitRoot) return resolve(startDirectory, explicitRoot);
  let current = resolve(startDirectory);
  while (true) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return resolve(current, "artifacts");
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate pnpm workspace root for artifact reads");
    current = parent;
  }
}

export function createFilesystemEvidenceArtifactReader(
  artifactRoot: string,
): (evidence: Evidence) => Promise<EvidenceArtifact | undefined> {
  const resolvedRoot = resolve(artifactRoot);
  return async (evidence) => {
    const artifactPath = resolveEvidenceArtifactPath(resolvedRoot, evidence);
    if (!artifactPath) return undefined;

    try {
      const runsRoot = resolve(resolvedRoot, "runs");
      const runDirectory = resolve(runsRoot, evidence.runId);
      const [realRunsRoot, realRunDirectory, realArtifactPath] = await Promise.all([
        realpath(runsRoot),
        realpath(runDirectory),
        realpath(artifactPath),
      ]);
      if (!isStrictlyWithin(realRunsRoot, realRunDirectory)
        || !isStrictlyWithin(realRunDirectory, realArtifactPath)) return undefined;
      const content = await readFile(realArtifactPath);
      if (!evidence.sha256 || createHash("sha256").update(content).digest("hex") !== evidence.sha256) return undefined;
      return {
        content,
        contentType: evidence.type === "SCREENSHOT"
          ? "image/png"
          : extname(artifactPath).toLowerCase() === ".json"
            ? "application/json"
            : "application/octet-stream",
      };
    } catch {
      return undefined;
    }
  };
}

export function resolveEvidenceArtifactPath(artifactRoot: string, evidence: Evidence): string | undefined {
  if (!evidence.artifactPath) return undefined;
  const runsRoot = resolve(artifactRoot, "runs");
  const runDirectory = resolve(runsRoot, evidence.runId);
  if (!isStrictlyWithin(runsRoot, runDirectory)) return undefined;
  const artifactPath = resolve(runDirectory, evidence.artifactPath);
  return isStrictlyWithin(runDirectory, artifactPath) ? artifactPath : undefined;
}

function isStrictlyWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent !== ""
    && pathFromParent !== ".."
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent);
}
