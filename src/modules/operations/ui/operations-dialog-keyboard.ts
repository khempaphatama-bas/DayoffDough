import type { KeyboardEvent } from "react";

/** Keep keyboard navigation inside an Operations confirmation, including error refresh links. */
export function handleOperationsDialogKeyDown(event: KeyboardEvent<HTMLDivElement>, close: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;

  const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
