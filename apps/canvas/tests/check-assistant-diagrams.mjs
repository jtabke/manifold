import assert from "node:assert/strict";
import {
  checkAssistantDiagram,
  ASSISTANT_DIAGRAM_LIMITS,
} from "../src/regions/assistantDiagrams.ts";

for (const source of [
  "flowchart LR\n  Input[Measurements] --> Result[Inspect result]",
  "sequenceDiagram\n  Engineer->>Canvas: Evaluate\n  Canvas-->>Engineer: Result",
  "flowchart LR\n  A[Link concepts] --> B[Evaluate]",
])
  assert.doesNotThrow(() => checkAssistantDiagram(source));
for (const source of [
  "---\nconfig:\n  securityLevel: loose\n---\nflowchart LR\n A-->B",
  '%%{init: {"securityLevel":"loose","themeCSS":"@import url(https://diagram.invalid/x)"}}%%\nflowchart LR\n A-->B',
  'flowchart LR\n A["<img src=https://diagram.invalid/pixel>"] --> B',
  'flowchart LR\n A["#60;img src=https://diagram.invalid/pixel#62;"] --> B',
  'flowchart LR\n A["&lt;img src=https://diagram.invalid/pixel&gt;"] --> B',
  'flowchart LR\n A["&#60img src=https://diagram.invalid/pixel&#62"] --> B',
  'flowchart LR\n A["#60img src=https://diagram.invalid/pixel#62"] --> B',
  'flowchart LR\n A["%u003cimg src=https://diagram.invalid/pixel%u003e"] --> B',
  'flowchart LR\n A["%3Cimg src=https://diagram.invalid/pixel%3E"] --> B',
  'flowchart LR\n A["![tracking](https://diagram.invalid/pixel)"] --> B',
  'flowchart LR\n A@{ img: "https://diagram.invalid/pixel" }',
  'flowchart LR\n A@{ "img": "https://diagram.invalid/pixel" }',
  'flowchart LR\n A-->B\n click A "javascript:alert(1)"',
  'sequenceDiagram\n A->>B: Hi\n links A: {"URL": "https://diagram.invalid/x"}',
  "flowchart LR\n A-->B\n classDef bad fill:url(https://diagram.invalid/paint.svg)",
])
  assert.throws(() => checkAssistantDiagram(source), /omitted/);
assert.throws(() => checkAssistantDiagram(""), /Waiting/);
assert.throws(
  () =>
    checkAssistantDiagram("a".repeat(ASSISTANT_DIAGRAM_LIMITS.characters + 1)),
  /too large/,
);
assert.throws(
  () => checkAssistantDiagram("a\n".repeat(ASSISTANT_DIAGRAM_LIMITS.lines)),
  /too large/,
);
console.log(
  "Assistant diagrams: bounded plain flowchart/sequence content and rejection of configuration, encoded HTML, resources and diagram links pass.",
);
