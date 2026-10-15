import type { InvestmentConsoleTab } from "./investmentControlConsoleController.js";

const tabs = ["sources", "valuation", "conditions", "diagnostics"] as const satisfies readonly InvestmentConsoleTab[];

export function routeInvestmentConsoleTabKeydown(
  event: KeyboardEvent,
  documentRef: Document,
  activate: (tab: InvestmentConsoleTab) => void
): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const currentButton = target.closest("button[data-control-tab][role='tab']");
  if (!(currentButton instanceof HTMLButtonElement)) return;
  const current = currentButton.dataset.controlTab;
  if (!isInvestmentConsoleTab(current)) return;
  const next = nextTab(current, event.key);
  if (!next) return;
  event.preventDefault();
  activate(next);
  const nextButton = documentRef.getElementById(`investment-console-tab-${next}`);
  if (nextButton instanceof HTMLButtonElement) nextButton.focus();
}

function nextTab(current: InvestmentConsoleTab, key: string): InvestmentConsoleTab | null {
  const index = tabs.indexOf(current);
  if (key === "ArrowRight") return tabs[(index + 1) % tabs.length];
  if (key === "ArrowLeft") return tabs[(index - 1 + tabs.length) % tabs.length];
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[tabs.length - 1];
  return null;
}

function isInvestmentConsoleTab(value: string | undefined): value is InvestmentConsoleTab {
  return tabs.some((tab) => tab === value);
}
