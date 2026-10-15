#!/usr/bin/env node

const baseUrl = process.env.STAGING_WRITE_BASE_URL ?? "";
const token = process.env.STAGING_WRITE_TOKEN ?? "";
const databaseUrl = process.env.STAGING_DATABASE_URL ?? "";
const runId = process.env.STAGING_WRITE_RUN_ID ?? "";
const authHeaderName = process.env.STAGING_WRITE_AUTH_HEADER ?? "x-internal-token";
const purpose = process.env.STAGING_WRITE_TOKEN_PURPOSE ?? "";
const expiresAt = process.env.STAGING_WRITE_TOKEN_EXPIRES_AT ?? "";
const revokeCheckCommand = process.env.STAGING_WRITE_REVOKE_CHECK_COMMAND ?? "";

const checks = [];
const blockers = [];
const warnings = [];

check("staging write base URL is candidate /candidate-api", isHttpUrl(baseUrl) && baseUrl.includes("/candidate-api"), {
  present: Boolean(baseUrl),
  valuePrinted: false
});
check("staging write base URL is not legacy API root", !baseUrl.endsWith("/api") && !baseUrl.includes("/api/") && baseUrl.includes("/candidate-api"), {
  present: Boolean(baseUrl),
  valuePrinted: false
});
check("staging write token is present", token.length > 0, {
  present: token.length > 0,
  valuePrinted: false
});
check("staging write token is not an obvious placeholder", token.length > 0 && !isPlaceholder(token), {
  present: token.length > 0,
  valuePrinted: false
});
check("staging database URL is present", databaseUrl.length > 0, {
  present: databaseUrl.length > 0,
  valuePrinted: false
});
check("staging database URL looks like postgres", /^postgres(?:ql)?:\/\//i.test(databaseUrl), {
  present: databaseUrl.length > 0,
  valuePrinted: false
});
check("staging write run id is explicit", /^prod-candidate-write-[0-9]{8,}/.test(runId), {
  present: runId.length > 0,
  valuePrinted: false,
  expectedPrefix: "prod-candidate-write-"
});
check("staging write auth header is explicit", authHeaderName.length > 0 && !/authorization/i.test(authHeaderName), {
  headerName: authHeaderName,
  tokenPrinted: false
});
check("staging write token purpose is explicit", purpose === "legacy-freeze-candidate-write-smoke", {
  present: purpose.length > 0,
  valuePrinted: false
});
check("staging write token expiry is present and near-term", expiryIsNearTerm(expiresAt), {
  present: expiresAt.length > 0,
  valuePrinted: false,
  expected: "future ISO timestamp within 24 hours"
});
check("staging write revoke check command is configured", revokeCheckCommand.length > 0 && commandJsonIsValid(revokeCheckCommand), {
  present: revokeCheckCommand.length > 0,
  valuePrinted: false
});
check("staging write revoke check uses revoke verifier", revokeCheckCommandUsesVerifier(revokeCheckCommand), {
  present: revokeCheckCommand.length > 0,
  expectedScript: "scripts/staging-write-token-revoke-verify.mjs",
  valuePrinted: false
});

if (!process.env.STAGING_WRITE_REVOKE_COMPLETED_AT) {
  warnings.push({
    id: "revoke-not-yet-completed",
    reason: "STAGING_WRITE_REVOKE_COMPLETED_AT is not set; this is expected before the smoke, but must be recorded after token removal"
  });
}

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  mode: {
    readOnly: true,
    sendsHttpRequests: false,
    writesDatabase: false,
    deploysNginx: false,
    freezesLegacyApi: false,
    switchesFactSource: false
  },
  environment: {
    STAGING_WRITE_BASE_URL: presence("STAGING_WRITE_BASE_URL"),
    STAGING_WRITE_TOKEN: presence("STAGING_WRITE_TOKEN"),
    STAGING_DATABASE_URL: presence("STAGING_DATABASE_URL"),
    STAGING_WRITE_RUN_ID: presence("STAGING_WRITE_RUN_ID"),
    STAGING_WRITE_AUTH_HEADER: {
      present: Boolean(authHeaderName),
      valuePrinted: false,
      headerName: authHeaderName
    },
    STAGING_WRITE_TOKEN_PURPOSE: presence("STAGING_WRITE_TOKEN_PURPOSE"),
    STAGING_WRITE_TOKEN_EXPIRES_AT: presence("STAGING_WRITE_TOKEN_EXPIRES_AT"),
    STAGING_WRITE_REVOKE_CHECK_COMMAND: presence("STAGING_WRITE_REVOKE_CHECK_COMMAND"),
    STAGING_WRITE_REVOKE_COMPLETED_AT: presence("STAGING_WRITE_REVOKE_COMPLETED_AT")
  },
  checks,
  blockers,
  warnings,
  goNoGo: blockers.length === 0
    ? "staging_write_token_lifecycle_ready"
    : "no_go_clear_staging_write_token_lifecycle_blockers",
  notes: [
    "This command is read-only and does not validate the token against the server.",
    "The token value and database URL are never printed.",
    "Authorized candidate write smoke must still be followed by token removal and the configured revoke check.",
    "This command must never be pointed at the legacy production /api root."
  ]
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function check(id, ok, evidence = undefined) {
  checks.push({ id, ok, evidence });
  if (!ok) {
    blockers.push({ id, evidence });
  }
}

function presence(name) {
  return {
    present: Boolean(process.env[name]),
    valuePrinted: false
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaceholder(value) {
  return /^(test|synthetic|placeholder|changeme|redacted|token|example|dummy)[-_a-z0-9]*$/i.test(value)
    || value.includes("<")
    || value.includes(">");
}

function expiryIsNearTerm(value) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const now = Date.now();
  const max = now + 24 * 60 * 60 * 1000;
  return timestamp > now && timestamp <= max;
}

function commandJsonIsValid(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed
      && typeof parsed.command === "string"
      && parsed.command.length > 0
      && Array.isArray(parsed.args);
  } catch {
    return false;
  }
}

function revokeCheckCommandUsesVerifier(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed.args)
      && parsed.args.map(String).some((item) => item.includes("scripts/staging-write-token-revoke-verify.mjs"));
  } catch {
    return false;
  }
}
