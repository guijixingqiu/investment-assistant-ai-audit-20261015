import { Client } from "pg";
import { runMigrations } from "./migration-runner.mjs";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://localhost/annual_rings_candidate";

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await runMigrations(client);
} finally {
  await client.end();
}
