import { coreAssistUnifiedFailureStateForUiState } from "./coreAssistUnifiedFailureState.js";

export function renderList(list: HTMLElement, values: string[], emptyText: string): void {
  list.innerHTML = "";
  const items = values.length > 0 ? values : [emptyText];
  for (const value of items) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
}

export function setUnifiedFailureStateAttribute(element: HTMLElement, state: string): void {
  element.setAttribute("data-unified-failure-state", coreAssistUnifiedFailureStateForUiState(state) ?? "");
}

export function resetControlsToDefaults(documentRef: Document, selector: string): void {
  const controls = documentRef.querySelectorAll?.(selector) ?? [];
  for (const element of controls) {
    const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if ("checked" in control && ["checkbox", "radio"].includes(control.type)) {
      control.checked = control.defaultChecked;
    } else if ("options" in control) {
      const defaultIndex = [...control.options].findIndex((option) => option.defaultSelected);
      control.selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;
    } else {
      control.value = control.defaultValue;
    }
  }
}
