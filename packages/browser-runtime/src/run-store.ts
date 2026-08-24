import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RunResult, StepResult } from "./types";

export class JsonRunStore {
  private readonly runDir: string;

  constructor(rootDir: string, runId: string) {
    this.runDir = resolve(rootDir, "runs", runId);
  }

  async persist(run: RunResult, changedStep?: StepResult): Promise<void> {
    await mkdir(resolve(this.runDir, "steps"), { recursive: true });
    await atomicJson(resolve(this.runDir, "run.json"), run);
    if (changedStep) await atomicJson(resolve(this.runDir, "steps", `${String(changedStep.index).padStart(3, "0")}-${changedStep.id}.json`), changedStep);
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
