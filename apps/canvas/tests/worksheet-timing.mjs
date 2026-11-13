/** Page-clock observations of real DOM handlers; RAF callbacks do not establish paint. */
import assert from "node:assert/strict";

export function timingDistribution(samples) {
  assert(samples.length, "Timing observations must not be empty");
  assert(
    samples.every((value) => Number.isFinite(value) && value >= 0),
    "Timing observations must be finite and nonnegative",
  );
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    count: samples.length,
    samples,
    median:
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}

/** The caller opens the real editor/slider first. Only handler-to-result work is timed. */
export async function timeWorksheetInteraction(control, options) {
  return control.evaluate(async (node, { kind, value, expected }) => {
    const result = () => document.querySelector('[data-result-for="v1"]'),
      resultHost = document.querySelector('[data-region-id="render-1"]');
    if (!resultHost || !result()) throw Error("Missing dependent-result DOM");
    const matches = () =>
      result()
        ?.textContent.replace(/\s+/g, " ")
        .trim()
        .endsWith(`= ${expected}`);
    if (matches()) throw Error("The timing sample must change its result");
    let inputAt, commitAt, observedAt, frame, timer, observer;
    const onInput = () => {
        inputAt ??= performance.now();
        if (kind === "vary") commitAt = inputAt;
      },
      onCommit = (event) => {
        if (event.key === "Escape") commitAt = performance.now();
      };
    node.addEventListener("input", onInput, true);
    node.addEventListener("keydown", onCommit, true);
    const update = new Promise((resolve, reject) => {
      observer = new MutationObserver(() => {
        if (commitAt === undefined || observedAt !== undefined || !matches())
          return;
        observedAt = performance.now();
        // The interval between these callbacks is a rendering opportunity, not proof of paint.
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            if (!matches()) {
              reject(
                Error("Dependent result changed before the RAF opportunity"),
              );
              return;
            }
            const opportunityAt = performance.now();
            resolve({
              inputToResultDomMs: observedAt - inputAt,
              commitToResultDomMs: observedAt - commitAt,
              inputToResultOpportunityMs: opportunityAt - inputAt,
              commitToResultOpportunityMs: opportunityAt - commitAt,
              draftSettlingMs: commitAt - inputAt,
            });
          });
        });
      });
      observer.observe(resultHost, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      // A missing result is a correctness failure; this is not a latency acceptance threshold.
      timer = setTimeout(
        () => reject(Error("Expected dependent result did not arrive")),
        10000,
      );
    });
    try {
      const prototype =
        node instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
      node.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertReplacementText",
          data: value,
        }),
      );
      if (kind === "edit") {
        // Give the controlled draft a React render and an intervening frame before committing.
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        if (!node.isConnected || node.value !== value)
          throw Error("The controlled worksheet draft did not settle");
        node.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      return await update;
    } finally {
      observer.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      node.removeEventListener("input", onInput, true);
      node.removeEventListener("keydown", onCommit, true);
    }
  }, options);
}
