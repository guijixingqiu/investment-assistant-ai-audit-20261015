#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseVerificationArguments, verifySelectedTask } from "./product-goal-check.mjs";

let loaded;
try { loaded = await verifySelectedTask(parseVerificationArguments(process.argv.slice(2))); }
catch (error) {
  console.log(JSON.stringify({ ok: false, authorityGranted: false, lifecycleEligible: false, failures: [{ reason: "verification_context_unavailable", message: error.message }] }));
  process.exit(1);
}
const { state, context, result: current } = loaded;

const requiredFiles = ["README.md", "PROJECT_CHARTER.md", "PROJECT_STATE.yaml", "ROADMAP.yaml", "QUALITY_GATES.yaml", "AGENTS.md", "docs/governance/AUTOPILOT.md", "docs/governance/GOAL_PURSUIT.md", "docs/governance/CODEX_TASK_PROTOCOL.md", "docs/governance/CODEX_DESKTOP_AUTOMATION_PROMPT.md", ".agents/skills/investment-assistant-stage-runner/SKILL.md", "CHANGELOG.md", "apps/web/index.html", "apps/web/src/coreAssistStatusPanelsRenderer.ts", "apps/ios/AnnualRingsGateA/App/GateBResearchWorkspaceSections.swift"];
const failures = [];
const contents = new Map();
for (const path of requiredFiles) {
  try {
    const content = path === "PROJECT_STATE.yaml" ? loaded.projectState : await readFile(join(context.executionRoot, path), "utf8");
    contents.set(path, content);
    if (!content.trim()) failures.push({ path, reason: "empty_file" });
  } catch (error) { failures.push({ path, reason: "missing_file", message: error.message }); }
}
const read = (path) => contents.get(path) ?? "";
let roadmap;
try { roadmap = JSON.parse(read("ROADMAP.yaml")); }
catch { failures.push({ reason: "invalid_roadmap_json" }); }
failures.push(...current.failures);
try {
  const packageJson = JSON.parse(await readFile(join(context.executionRoot, "package.json"), "utf8"));
  if (packageJson.name !== state?.project) failures.push({ reason: "project_name_mismatch" });
} catch { failures.push({ reason: "package_json_invalid" }); }
const milestones = Array.isArray(roadmap?.milestones) ? roadmap.milestones : [];
const ids = new Set(milestones.map((item) => item.id));
if (roadmap?.schema_version !== 2 || roadmap?.project !== state?.project || !milestones.length || ids.size !== milestones.length)
  failures.push({ reason: "roadmap_identity_or_milestones_invalid" });
const active = milestones.filter((item) => item.status === "active");
if (active.length !== 1 || active[0].id !== state?.phase_id) failures.push({ reason: "active_milestone_relation_invalid" });
for (const item of milestones) {
  if (!["planned", "active", "completed", "deferred"].includes(item.status)) failures.push({ reason: "milestone_status_invalid", id: item.id });
  if (!Array.isArray(item.depends_on) || item.depends_on.some((id) => !ids.has(id) || id === item.id))
    failures.push({ reason: "milestone_dependency_invalid", id: item.id });
  if (["active", "completed"].includes(item.status) && (item.depends_on ?? []).some((id) => milestones.find((entry) => entry.id === id)?.status !== "completed"))
    failures.push({ reason: "milestone_dependency_incomplete", id: item.id });
}
// Detect indirect cycles too; order is not an implicit substitute for dependency validity.
const visited = new Set();
const visiting = new Set();
function visit(id) {
  if (visiting.has(id)) { failures.push({ reason: "milestone_dependency_cycle", id }); return; }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of milestones.find((item) => item.id === id)?.depends_on ?? []) if (ids.has(dependency)) visit(dependency);
  visiting.delete(id); visited.add(id);
}
for (const id of ids) visit(id);
const webIndex = read("apps/web/index.html");
const webStatusPanels = read("apps/web/src/coreAssistStatusPanelsRenderer.ts");
const iosWorkspaceScreen = read("apps/ios/AnnualRingsGateA/App/GateBResearchWorkspaceSections.swift");
requirePattern(webIndex, /<details id="operator-diagnostics"[\s\S]*?<div id="operator-diagnostics-content"/, "apps/web/index.html", "missing_bounded_operator_diagnostics");
requirePattern(webStatusPanels, /function attachOperatorDiagnosticPanel[\s\S]*diagnostics\.append\(section\)/, "apps/web/src/coreAssistStatusPanelsRenderer.ts", "status_panels_not_bounded_to_operator_diagnostics");
for (const [pattern, reason] of [
  [/workspaceModel\.fullGoalAcceptanceMatrix/, "ios_daily_use_exposes_goal_matrix"],
  [/workspaceModel\.fullSystemDevelopmentMatrix/, "ios_daily_use_exposes_development_matrix"],
  [/workspaceModel\.releaseBlockerDashboard/, "ios_daily_use_exposes_release_dashboard"],
  [/workspaceModel\.coreAssistLoopClosureCheckpoint/, "ios_daily_use_exposes_engineering_checkpoint"],
  [/workspaceModel\.reliabilityStatus/, "ios_daily_use_exposes_validation_status"],
  [/workspaceModel\.preDeviceBetaReadiness/, "ios_daily_use_exposes_beta_governance"],
  [/workspaceModel\.productionNoGo/, "ios_daily_use_exposes_production_governance"],
  [/workspaceModel\.deviceTestPending/, "ios_daily_use_exposes_device_governance"],
  [/workspaceModel\.dailyUseFactMetadataLedger/, "ios_daily_use_exposes_fact_ledger"],
  [/workspaceModel\.dailyUseReadinessChecklist/, "ios_daily_use_exposes_engineering_checklist"]
]) {
  if (pattern.test(iosWorkspaceScreen)) failures.push({ path: "apps/ios/AnnualRingsGateA/App/GateBResearchWorkspaceSections.swift", reason });
}

console.log(JSON.stringify({ ...current, ok: failures.length === 0, lifecycleEligible: current.lifecycleEligible && failures.length === 0,
  checkedFiles: requiredFiles, phaseId: state?.phase_id,
  nextTask: current.effectiveTaskSource === "controller" ? current.effectiveTask : state?.next_task, failures }, null, 2));
if (failures.length) process.exitCode = 1;
function requirePattern(content, pattern, path, reason) {
  if (!pattern.test(content)) failures.push({ path, reason });
}
