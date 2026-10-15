#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function compareMigrationFilenames(expected, applied) {
  const expectedSet = new Set(expected);
  const appliedSet = new Set(applied);
  const missing = expected.filter((name) => !appliedSet.has(name));
  const unexpected = applied.filter((name) => !expectedSet.has(name));
  const duplicated = applied.filter((name, index) => applied.indexOf(name) !== index);
  return { ok: missing.length === 0 && unexpected.length === 0 && duplicated.length === 0
      && applied.length === expected.length,
    missing, unexpected, duplicated, count: expected.length };
}

export function verifyExistingSchema({ repositoryRoot, databaseUrl, expectedDatabaseName, psql = spawnSync }) {
  if (!databaseUrl) throw new Error("LOCAL_ALPHA_DATABASE_URL is required for read-only schema preflight");
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error("LOCAL_ALPHA_DATABASE_URL is invalid"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host") || url.pathname.length <= 1) {
    throw new Error("schema preflight requires an explicit local PostgreSQL database");
  }
  const selectedDatabase = decodeURIComponent(url.pathname.slice(1));
  if (expectedDatabaseName && selectedDatabase !== expectedDatabaseName) {
    throw new Error(`database identity mismatch: expected ${expectedDatabaseName}, got ${selectedDatabase}`);
  }
  const expected = readdirSync(path.join(repositoryRoot, "db/migrations"))
    .filter((name) => name.endsWith(".sql")).sort();
  if (expected.length === 0) throw new Error("repository has no migration files");
  const query = psql("psql", [databaseUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
    "select current_database(); select current_setting('transaction_read_only'); select filename from schema_migrations order by filename"], {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" }
  });
  if (query.status !== 0) throw new Error(`read-only schema query failed (psql exit ${query.status ?? "unknown"})`);
  const [actualDatabase, readonly, ...applied] = query.stdout.trim().split("\n").filter(Boolean);
  if (actualDatabase !== selectedDatabase) {
    throw new Error(`database identity mismatch: connected to ${actualDatabase ?? "unknown"}, expected ${selectedDatabase}`);
  }
  if (readonly !== "on") throw new Error("schema preflight connection is not read-only");
  const comparison = compareMigrationFilenames(expected, applied);
  if (!comparison.ok) {
    throw new Error(`existing schema differs; migration is disabled (missing: ${comparison.missing.join(", ") || "none"}; unexpected: ${comparison.unexpected.join(", ") || "none"}; duplicated: ${comparison.duplicated.join(", ") || "none"})`);
  }
  return { databaseName: selectedDatabase, migrationCount: comparison.count,
    latestMigration: expected.at(-1) ?? null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyExistingSchema({ repositoryRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      databaseUrl: process.env.LOCAL_ALPHA_DATABASE_URL,
      expectedDatabaseName: process.env.LOCAL_ALPHA_EXPECTED_DATABASE_NAME });
    console.log(`体验库 ${result.databaseName}：${result.migrationCount} 项迁移与当前源码逐项一致（最新 ${result.latestMigration ?? "无"}）；未执行迁移。`);
  } catch (error) {
    console.error(`启动前检查失败：${error instanceof Error ? error.message : "schema unavailable"}`);
    process.exitCode = 1;
  }
}
