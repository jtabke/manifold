/** Window-level canvas shortcuts must not act through a native modal dialog. */
export function isDialogEvent(event: Event) {
  return (
    event.target instanceof Element && !!event.target.closest("dialog[open]")
  );
}

/** Disclosures own keyboard input without becoming modal or trapping focus. */
export function isCanvasControlEvent(event: Event) {
  return (
    isDialogEvent(event) ||
    (event.target instanceof Element &&
      !!event.target.closest("[data-canvas-controls]"))
  );
}
