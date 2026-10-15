import crypto from "node:crypto";
import { canonicalJson, type DecisionContextHashInput } from "./decisionContextBrowser.js";
export * from "./decisionContextBrowser.js";

export function computeDecisionContextHash(input: DecisionContextHashInput): string {
  return crypto.createHash("sha256").update(canonicalJson(input)).digest("hex");
}
