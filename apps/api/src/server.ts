import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(workspaceEnv)) process.loadEnvFile(workspaceEnv);

const { checkDatabase, createDatabase, PostgresRunStore } = await import("@sentinel/db");
const { createLLMProvider } = await import("@sentinel/llm");
const { buildApp } = await import("./app");
const { createFilesystemEvidenceArtifactReader, resolveArtifactRoot } = await import("./evidence-artifact-reader");

const port = Number(process.env.API_PORT ?? 4000);
const databaseUrl = process.env.DATABASE_URL ?? "postgres://sentinel:sentinel@localhost:5432/sentinel";
const plannerProvider = createLLMProvider(process.env);
const readEvidenceArtifact = createFilesystemEvidenceArtifactReader(resolveArtifactRoot(process.env.SENTINEL_ARTIFACT_ROOT));
const store = new PostgresRunStore(createDatabase(databaseUrl).client);
const app = buildApp({ checkDatabase: () => checkDatabase(databaseUrl), plannerProvider, store, readEvidenceArtifact });

await app.listen({ host: "0.0.0.0", port });
