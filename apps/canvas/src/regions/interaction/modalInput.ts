/** Window-level canvas shortcuts must not act through a native modal dialog. */
export function isDialogEvent(event: Event) {
  return (
    event.target instanceof Element && !!event.target.closest("dialog[open]")
  );
}
