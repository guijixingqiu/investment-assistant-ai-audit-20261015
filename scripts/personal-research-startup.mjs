#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function selectedOwnerSimulator(state, override) {
  const scope = state?.project_controller_handoff?.continuous_development?.simulator_scope;
  if (scope?.model !== "iPhone 17 Pro Max" || !/^[A-Fa-f0-9-]{36}$/.test(scope?.udid ?? "")) {
    throw new Error("current PROJECT_STATE has no registered original iPhone 17 Pro Max");
  }
  if (override && override !== scope.udid) {
    throw new Error(`LOCAL_PERSONAL_SIMULATOR_UDID conflicts with registered Pro Max ${scope.udid}`);
  }
  return { model: scope.model, udid: scope.udid };
}

export function readOwnerSimulator(statePath, override) {
  return selectedOwnerSimulator(JSON.parse(readFileSync(statePath, "utf8")), override);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const statePath = process.argv[2];
    if (!statePath) throw new Error("PROJECT_STATE path is required");
    console.log(readOwnerSimulator(statePath, process.env.LOCAL_PERSONAL_SIMULATOR_UDID).udid);
  } catch (error) {
    console.error(`Simulator 启动前检查失败：${error instanceof Error ? error.message : "state unavailable"}`);
    process.exitCode = 1;
  }
}
