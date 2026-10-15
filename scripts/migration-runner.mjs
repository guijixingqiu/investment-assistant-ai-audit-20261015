import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const MIGRATION_LOCK_KEY = "investment-assistant-system:migrations";

export async function runMigrations(client, options = {}) {
  const migrationsDir = options.migrationsDir ?? path.resolve("db/migrations");
  const log = options.log ?? console.log;
  const applied = [];
  const skipped = [];

  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [MIGRATION_LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        checksum text,
        applied_at timestamptz not null default now()
      )
    `);
    await client.query("alter table schema_migrations add column if not exists checksum text");

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql") && !file.startsWith("._"))
      .sort();

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const alreadyApplied = await client.query("select checksum from schema_migrations where filename = $1", [file]);
      if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
        const recordedChecksum = alreadyApplied.rows[0].checksum;
        if (recordedChecksum && recordedChecksum !== checksum) {
          throw new Error(`migration checksum mismatch for ${file}`);
        }
        if (!recordedChecksum) {
          await client.query("update schema_migrations set checksum = $1 where filename = $2", [checksum, file]);
        }
        skipped.push(file);
        log(`skip ${file}`);
        continue;
      }

      await client.query(sql);
      await client.query("insert into schema_migrations (filename, checksum) values ($1, $2)", [file, checksum]);
      applied.push(file);
      log(`applied ${file}`);
    }

    await client.query("commit");
    return { applied, skipped };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
