import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "artifacts/**", "audit/**", "node_modules/**"]
  },
  {
    ...eslint.configs.recommended,
    files: ["apps/**/*.ts", "packages/**/*.ts"]
  },
  ...tseslint.configs.recommended,
  {
    files: ["apps/**/*.ts", "packages/**/*.ts"],
    rules: {
      "complexity": ["error", { max: 40 }],
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off"
    }
  },
  {
    files: [
      "apps/api/src/research/authorizedPortfolioDecisionContext.ts",
      "apps/web/src/decisionJourneyIngress.ts",
      "apps/web/src/selectedCandidateMembershipGate.ts",
      "packages/contracts/src/decisionQuantEvidenceContract.ts"
    ],
    rules: {
      "complexity": ["error", { max: 25 }]
    }
  },
  {
    files: ["apps/web/src/coreAssistCapabilityConsoleRenderer.ts"],
    rules: {
      "complexity": ["error", { max: 220 }]
    }
  }
);
