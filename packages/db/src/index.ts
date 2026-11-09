import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function parseDatabaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }
  return url;
}

export function createDatabase(databaseUrl: string) {
  const url = parseDatabaseUrl(databaseUrl);
  const client = postgres(url.toString(), { max: 5 });
  return { client, db: drizzle(client) };
}

export async function checkDatabase(databaseUrl: string): Promise<boolean> {
  const { client } = createDatabase(databaseUrl);
  try {
    await client`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 2 });
  }
}

export * from "./outcome-store";
export * from "./run-store";
