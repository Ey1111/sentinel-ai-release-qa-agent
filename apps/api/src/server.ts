import { checkDatabase } from "@sentinel/db";
import { buildApp } from "./app";

const port = Number(process.env.API_PORT ?? 4000);
const databaseUrl = process.env.DATABASE_URL ?? "postgres://sentinel:sentinel@localhost:5432/sentinel";
const app = buildApp({ checkDatabase: () => checkDatabase(databaseUrl) });

await app.listen({ host: "0.0.0.0", port });
