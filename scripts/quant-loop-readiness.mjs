#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const specPath = process.env.QUANT_LOOP_SPEC_PATH ?? "docs/audit/quant-loop-spec.md";
const text = read(specPath);

const checks = [];
const blockers = [];

check("spec exists", text.length > 0, specPath);
check("scope is Hong Kong v0.1", includesAll(["港股 v0.1"]), specPath);
check("excludes A shares and A+H expansion", includesAll(["A 股", "A+H"]), specPath);
check("excludes machine learning and multi-agent expansion", includesAll(["机器学习", "多智能体"]), specPath);
check("forbids real trading", includesAll(["自动下单", "broker 接口", "Futu 交易解锁", "不形成真实交易建议"]), specPath);
check("requires frozen data snapshot", includesAll(["冻结快照", "snapshotId", "sha256"]), specPath);
check("requires next trading day execution", includesAll(["day t 收盘后", "day t+1", "禁止同一根 K 线生成信号并成交"]), specPath);
check("forbids lookahead patterns", includesAll(["shift(-1)", "iloc[i + 1]", "读取未来数据"]), specPath);
check("requires nonzero fee model", includesAll(["必须非零", "commissionRate", "stampDutyRate"]), specPath);
check("requires board-lot rounding", includesAll(["lotSize", "向下取整", "不足一手"]), specPath);
check("requires suspension and missing data handling", includesAll(["volume <= 0", "关键价格缺失", "不得成交"]), specPath);
check("requires cash constraint", includesAll(["现金不足", "现金不得为负", "v0.1 不允许融资"]), specPath);
check("requires ledger and NAV artifacts", includesAll(["trades.json", "ledger.json", "nav.json", "report.md"]), specPath);
check("requires turnover reporting", includesAll(["单边换手率", "双边换手率"]), specPath);
check("keeps production facts untouched", includesAll(["不得写入生产数据库", "写入正式 `trades`", "不修改生产数据库"]), specPath);

const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  specPath,
  checks,
  blockers,
  safety: {
    executesBacktest: false,
    sendsLiveNetworkRequests: false,
    writesProductionDatabase: false,
    enablesTrading: false
  },
  goNoGo: blockers.length === 0 ? "quant_loop_spec_ready" : "no_go_fix_quant_loop_spec"
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

function read(relativePath) {
  try {
    return readFileSync(join(root, relativePath), "utf8");
  } catch {
    return "";
  }
}

function includesAll(needles) {
  return needles.every((needle) => text.includes(needle));
}

function check(id, ok, evidence) {
  const item = { id, ok, evidence };
  checks.push(item);
  if (!ok) {
    blockers.push(item);
  }
}
