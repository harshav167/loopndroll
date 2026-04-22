import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { applyAppMigrations } from "./migrations";

export const SQLITE_PRAGMA_STATEMENTS = [
  "pragma journal_mode = wal",
  "pragma synchronous = normal",
  "pragma foreign_keys = on",
  "pragma busy_timeout = 5000",
] as const;

type LoopPluginDatabase = {
  path: string;
  client: Database;
};

let cachedDatabase: LoopPluginDatabase | null = null;

function configureDatabase(client: Database) {
  for (const statement of SQLITE_PRAGMA_STATEMENTS) {
    client.exec(statement);
  }
}

export function getLoopPluginDatabase(databasePath: string) {
  if (cachedDatabase && cachedDatabase.path === databasePath) {
    return cachedDatabase;
  }

  mkdirSync(dirname(databasePath), { recursive: true });

  const client = new Database(databasePath, { create: true });
  configureDatabase(client);
  applyAppMigrations(client);

  cachedDatabase = {
    path: databasePath,
    client,
  };

  return cachedDatabase;
}
