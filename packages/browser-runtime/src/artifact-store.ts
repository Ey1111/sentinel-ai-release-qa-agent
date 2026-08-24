import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type { ArtifactManifestEntry } from "./types";

type ArtifactStoreOptions = { rootDir: string; runId: string; now?: () => Date };
type ArtifactMetadata = { stepId?: string; redacted: boolean };

export class ArtifactStore {
  readonly runDir: string;
  readonly manifestPath: string;
  private readonly now: () => Date;
  private entries: ArtifactManifestEntry[] = [];

  constructor(options: ArtifactStoreOptions) {
    this.runDir = resolve(options.rootDir, "runs", options.runId);
    this.manifestPath = resolve(this.runDir, "manifest.json");
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(dirname(this.runDir), { recursive: true });
      await mkdir(this.runDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Artifact run already exists: ${this.runDir.split(/[\\/]/).at(-1) ?? "unknown"}`);
      throw error;
    }
    await this.persistManifest();
  }

  async writeText(key: string, value: string, mimeType: string, metadata: ArtifactMetadata): Promise<ArtifactManifestEntry> {
    return this.write(key, Buffer.from(value, "utf8"), mimeType, metadata);
  }

  async writeJson(key: string, value: unknown, metadata: ArtifactMetadata): Promise<ArtifactManifestEntry> {
    return this.writeText(key, `${JSON.stringify(value, null, 2)}\n`, "application/json", metadata);
  }

  async write(key: string, value: Buffer, mimeType: string, metadata: ArtifactMetadata): Promise<ArtifactManifestEntry> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value);
    const entry: ArtifactManifestEntry = {
      key: key.replaceAll("\\", "/"),
      mimeType,
      size: value.byteLength,
      sha256: createHash("sha256").update(value).digest("hex"),
      createdAt: this.now().toISOString(),
      redacted: metadata.redacted,
      ...(metadata.stepId ? { stepId: metadata.stepId } : {}),
    };
    this.entries = [...this.entries.filter((item) => item.key !== entry.key), entry];
    await this.persistManifest();
    return entry;
  }

  private resolveKey(key: string): string {
    if (!key || isAbsolute(key) || key.split(/[\\/]/).includes("..")) throw new Error("Artifact key must stay inside the run directory");
    const path = resolve(this.runDir, key);
    if (!path.startsWith(`${this.runDir}${sep}`)) throw new Error("Artifact key must stay inside the run directory");
    return path;
  }

  private async persistManifest(): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    const temporary = `${this.manifestPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, artifacts: this.entries }, null, 2)}\n`, "utf8");
    await rename(temporary, this.manifestPath);
  }
}
