const GOVERNED_SOURCE_ROOTS = new Set(["apps", "packages"]);
const PRODUCTION_SOURCE_DIRECTORIES = new Set(["App", "Sources", "src"]);
const NON_PRODUCTION_DIRECTORIES = new Set([
  ".build",
  "__tests__",
  "build",
  "coverage",
  "deriveddata",
  "dist",
  "generated",
  "node_modules",
  "test",
  "tests",
  "uitests"
]);
const PRODUCTION_SOURCE_EXTENSION = /\.(?:cjs|cts|js|jsx|mjs|mts|swift|ts|tsx)$/;

export function isGovernedProductionSourcePath(path) {
  if (typeof path !== "string" || path.includes("\\")) return false;
  const parts = path.split("/");
  if (!GOVERNED_SOURCE_ROOTS.has(parts[0])) return false;
  if (!parts.some((part) => PRODUCTION_SOURCE_DIRECTORIES.has(part))) return false;
  if (parts.some((part) => NON_PRODUCTION_DIRECTORIES.has(part.toLowerCase()))) return false;
  return PRODUCTION_SOURCE_EXTENSION.test(path);
}
