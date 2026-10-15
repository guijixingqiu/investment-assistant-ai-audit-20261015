import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workDir = await mkdtemp(path.join(tmpdir(), "annual-rings-data-gate-negative-"));

const cases = [
  {
    name: "count-mismatch",
    sample: sampleWith({ expectedCounts: { positions: 2, decisionChecks: 1, researchEvents: 1, globalResearchEvents: 0, trades: 0, reviews: 0 } })
  },
  {
    name: "missing-required-field",
    sample: sampleWith({ positions: [{ legacyId: "positions:bad", quantity: "10", snapshotAsOf: "2026-06-17T00:00:00.000Z" }] })
  },
  {
    name: "duplicate-legacy-id",
    sample: {
      sourceLabel: "negative-duplicate-legacy-id",
      expectedCounts: { positions: 2, decisionChecks: 0, researchEvents: 0, globalResearchEvents: 0, trades: 0, reviews: 0 },
      samples: [
        {
          symbol: { market: "HK", code: "00175", name: "吉利汽车" },
          positions: [{ legacyId: "positions:duplicate", quantity: "1", status: "holding", snapshotAsOf: "2026-06-17T00:00:00.000Z" }],
          decisionChecks: [],
          researchEvents: [],
          trades: [],
          reviews: []
        },
        {
          symbol: { market: "HK", code: "02233", name: "西部水泥" },
          positions: [{ legacyId: "positions:duplicate", quantity: "1", status: "holding", snapshotAsOf: "2026-06-17T00:00:00.000Z" }],
          decisionChecks: [],
          researchEvents: [],
          trades: [],
          reviews: []
        }
      ],
      globalResearchEvents: []
    }
  }
];

try {
  for (const item of cases) {
    await verifyNegativeCase(item);
  }
  console.log("Data gate negative verification rejected count mismatch, missing required fields, and duplicate legacy id samples.");
} finally {
  await rm(workDir, { recursive: true, force: true });
}

async function verifyNegativeCase({ name, sample }) {
  const databaseName = `annual_rings_negative_${name.replaceAll("-", "_")}_${Date.now()}`;
  const samplePath = path.join(workDir, `${name}.json`);
  await writeFile(samplePath, `${JSON.stringify(sample, null, 2)}\n`, "utf8");

  try {
    await run("createdb", [databaseName]);
    await run("npm", ["run", "migrate"], { DATABASE_URL: `postgres://localhost/${databaseName}` });
    const result = await runExpectFailure("node", ["scripts/data-gate-sample-reconcile.mjs"], {
      DATABASE_URL: `postgres://localhost/${databaseName}`,
      DATA_GATE_SAMPLE_PATH: samplePath,
      DATA_GATE_RUN_ID: `negative-${name}`
    });
    if (result.code === 0) {
      throw new Error(`negative data gate case unexpectedly passed: ${name}`);
    }
    console.log(`negative case rejected: ${name}`);
  } finally {
    await run("dropdb", ["--if-exists", databaseName]);
  }
}

function sampleWith(overrides) {
  return {
    sourceLabel: `negative-${overrides.name ?? "sample"}`,
    symbol: { market: "HK", code: "09926", name: "康方生物" },
    expectedCounts: { positions: 1, decisionChecks: 1, researchEvents: 1, globalResearchEvents: 0, trades: 0, reviews: 0 },
    positions: [
      {
        legacyId: "positions:1",
        quantity: "10",
        averageCost: "1",
        currentWeight: "0.1",
        maxWeight: "0.2",
        unrealizedPnl: "0",
        status: "holding",
        snapshotAsOf: "2026-06-17T00:00:00.000Z"
      }
    ],
    decisionChecks: [
      {
        legacyId: "decision_checks:1",
        actionIntent: "buy",
        verdict: "caution",
        checkedAt: "2026-06-17T00:00:00.000Z"
      }
    ],
    researchEvents: [
      {
        legacyId: "research_events:1:stock:1",
        sourceType: "legacy",
        title: "sample",
        summary: "sample",
        eventType: "note",
        impactDirection: "neutral",
        confidence: "medium",
        capturedAt: "2026-06-17T00:00:00.000Z"
      }
    ],
    globalResearchEvents: [],
    trades: [],
    reviews: [],
    ...overrides
  };
}

async function run(command, args, extraEnv = {}) {
  const result = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  return result;
}

async function runExpectFailure(command, args, extraEnv = {}) {
  try {
    const result = await run(command, args, extraEnv);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error && typeof error === "object") {
      const output = error;
      if (typeof output.stdout === "string" && output.stdout.trim()) console.log(output.stdout.trim());
      if (typeof output.stderr === "string" && output.stderr.trim()) console.error(output.stderr.trim());
      return { code: typeof output.code === "number" ? output.code : 1 };
    }
    throw error;
  }
}
