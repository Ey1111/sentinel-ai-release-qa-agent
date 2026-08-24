import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function resolveArtifactRoot(explicit: string | undefined, startDir = process.cwd()): string {
  if (explicit) return resolve(startDir, explicit);
  let current = resolve(startDir);
  while (true) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return resolve(current, "artifacts");
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate pnpm workspace root for artifact storage");
    current = parent;
  }
}
