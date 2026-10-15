import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, process.argv[2] ?? "config/hk-connect-universe.southbound.json");
const schemaVersion = "2026-08-16.hk-connect-southbound-universe.v1";
const ssePage = "https://www.sse.com.cn/services/hkexsc/disclo/eligible/";
const szsePage = "https://www.szse.cn/szhk/hkbussiness/underlylist/";
const sseData = "https://query.sse.com.cn/commonQuery.do?sqlId=COMMON_SSE_JYFW_HGT_XXPL_BDZQQD_L&isPagination=true&pageHelp.pageSize=2000&pageHelp.pageNo=1&pageHelp.beginPage=1&pageHelp.cacheSize=1&pageHelp.endPage=1&keyword=";
const szseData = "https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=SGT_GGTBDQD";

const [sse, szse] = await Promise.all([readSse(), readSzse()]);
if (sse.effectiveDate !== szse.effectiveDate) throw new Error("official Southbound source dates do not match");
if (sse.rows.map((row) => row.code).join(",") !== szse.rows.map((row) => row.code).join(",")) {
  throw new Error("official Shanghai and Shenzhen Southbound identities differ; manual review is required");
}
const stockRows = sse.rows.filter((row) => row.securityType === "股票");
const members = stockRows.map((row) => ({
  symbol: `HK.${row.code}`,
  code: row.code,
  nameZh: row.nameZh,
  nameEn: row.nameEn,
  channels: ["shanghai", "shenzhen"]
}));
if (!members.some((member) => member.symbol === "HK.00175") || !members.some((member) => member.symbol === "HK.00700")) {
  throw new Error("required real-stock witnesses are missing from the official universe");
}
const sources = [
  source("shanghai", ssePage, sseData, sse),
  source("shenzhen", szsePage, szseData, szse)
];
const normalized = { schemaVersion, effectiveDate: sse.effectiveDate, sources, members };
const snapshotId = sha256(JSON.stringify(normalized));
const previous = await readJson(output);
const manifest = {
  ...normalized,
  snapshotId,
  capturedAt: previous?.snapshotId === snapshotId && validInstant(previous.capturedAt)
    ? previous.capturedAt
    : new Date().toISOString()
};
const text = `${JSON.stringify(manifest, null, 2)}\n`;
const historyDirectory = resolve(dirname(output), `${basename(output, ".json")}.history`);
const historyOutput = resolve(historyDirectory, `${manifest.effectiveDate}-${snapshotId}.json`);
await mkdir(historyDirectory, { recursive: true });
try {
  await writeFile(historyOutput, text, { flag: "wx" });
} catch (error) {
  if (error?.code !== "EEXIST" || await readFile(historyOutput, "utf8") !== text) throw error;
}
await writeFile(output, text);
console.log(JSON.stringify({ ok: true, output, historyOutput, snapshotId, effectiveDate: manifest.effectiveDate, memberCount: members.length }));

async function readSse() {
  const value = await getJson(sseData, ssePage);
  if (!Array.isArray(value.result) || value.result.length < 2) throw new Error("SSE Southbound response is malformed");
  const rows = value.result.map((row) => {
    if (!record(row) || typeof row.SECURITY_CODE !== "string" || !/^\d{5}$/.test(row.SECURITY_CODE)
      || typeof row.ABBR_CN !== "string" || typeof row.ABBR_EN !== "string"
      || typeof row.SECURITY_TYPE !== "string" || typeof row.UPDATE_DATE !== "string") {
      throw new Error("SSE Southbound row is malformed");
    }
    return {
      code: row.SECURITY_CODE,
      nameZh: row.ABBR_CN.trim(),
      nameEn: row.ABBR_EN.trim(),
      securityType: row.SECURITY_TYPE,
      effectiveDate: row.UPDATE_DATE
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const effectiveDate = oneValue(rows.map((row) => row.effectiveDate), "SSE effective date");
  return { rows, effectiveDate };
}

async function readSzse() {
  const first = await getJson(`${szseData}&PAGENO=1`, szsePage);
  if (!Array.isArray(first) || !record(first[0]) || !record(first[0].metadata)
    || !Number.isSafeInteger(first[0].metadata.pagecount) || typeof first[0].metadata.subname !== "string") {
    throw new Error("SZSE Southbound response is malformed");
  }
  const pages = await Promise.all(Array.from({ length: first[0].metadata.pagecount }, (_, index) =>
    index === 0 ? first : getJson(`${szseData}&PAGENO=${index + 1}`, szsePage)));
  const rows = pages.flatMap((page) => {
    if (!Array.isArray(page) || !record(page[0]) || !Array.isArray(page[0].data)) throw new Error("SZSE Southbound page is malformed");
    return page[0].data.map((row) => {
      if (!record(row) || typeof row.zqdm !== "string" || !/^\d{5}$/.test(row.zqdm)
        || typeof row.zqjc !== "string" || typeof row.zqywjc !== "string") throw new Error("SZSE Southbound row is malformed");
      return { code: row.zqdm, nameZh: row.zqjc.trim(), nameEn: row.zqywjc.trim() };
    });
  }).sort((a, b) => a.code.localeCompare(b.code));
  if (new Set(rows.map((row) => row.code)).size !== rows.length) throw new Error("SZSE Southbound identities are duplicated");
  return { rows, effectiveDate: first[0].metadata.subname };
}

function source(channel, pageUrl, dataUrl, value) {
  return {
    channel,
    pageUrl,
    dataUrl,
    effectiveDate: value.effectiveDate,
    normalizedSha256: sha256(JSON.stringify(value.rows)),
    eligibleSecurityCount: value.rows.length
  };
}

async function getJson(url, referer) {
  const response = await fetch(url, { headers: { accept: "application/json", referer }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`official source returned HTTP ${response.status}`);
  return response.json();
}

function oneValue(values, label) {
  const unique = [...new Set(values)];
  if (unique.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(unique[0])) throw new Error(`${label} is inconsistent`);
  return unique[0];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function validInstant(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
