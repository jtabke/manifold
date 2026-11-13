/** Real assistant rendering and adversarial content, without provider calls. */
import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { startCompanion } from "../../assistant/src/server.mjs";
import { readWorkspace } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310",
  fenced = (source) => `\`\`\`mermaid\n${source}\n\`\`\``,
  flowchart =
    "flowchart LR\n Input[Measurements] --> Equation[Compute]\n Equation --> Result[Inspect]",
  sequence =
    "sequenceDiagram\n participant Engineer\n participant Canvas\n Engineer->>Canvas: Evaluate\n Canvas-->>Engineer: Checked result",
  adversarial = [
    '%%{init: {"securityLevel":"loose","themeCSS":"@import url(https://diagram.invalid/style.css)"}}%%\nflowchart LR\n A[Unsafe] --> B[End]',
    "---\nconfig:\n securityLevel: loose\n htmlLabels: true\n---\nflowchart LR\n A-->B",
    'flowchart LR\n A["<img src=https://diagram.invalid/raw.png onerror=window.diagramInjected=true>"] --> B[End]',
    'flowchart LR\n A["#60;img src=https://diagram.invalid/encoded.png onerror=window.diagramInjected=true#62;"] --> B[End]',
    'flowchart LR\n A["&lt;img src=https://diagram.invalid/entity.png&gt;"] --> B[End]',
    'flowchart LR\n A["&#60img src=https://diagram.invalid/no-semicolon.png&#62"] --> B[End]',
    'flowchart LR\n A["%u003cimg src=https://diagram.invalid/unicode.png%u003e"] --> B[End]',
    'flowchart LR\n A@{ img: "https://diagram.invalid/image.png" }',
    'flowchart LR\n A@{ "img": "https://diagram.invalid/quoted-image.png" }',
    'flowchart LR\n A[Start] --> B[End]\n click A "javascript:window.diagramInjected=true"',
    // The escaped CSS URL passes the plain-content preflight; initial-render CSP
    // must block it before final SVG sanitization removes supplied styles.
    "flowchart LR\n A[Start] --> B[End]\n classDef external fill:u\\72l(https://diagram.invalid/paint.svg);\n class A external;",
  ];
let releaseStream;
const companion = await startCompanion({
  port: 0,
  origins: [new URL(base).origin],
  createSession: async () => {
    let listener, abort;
    const emit = (delta) =>
      listener({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta },
      });
    return {
      configureCanvas(settings) {
        return settings;
      },
      subscribe(next) {
        listener = next;
      },
      async prompt(text) {
        if (text.startsWith("Stream")) {
          emit("```mermaid\nflowchart LR\n A[");
          await new Promise((resolve, reject) => {
            releaseStream = resolve;
            abort = reject;
          });
          emit("Fresh result] --> B[Done]\n```");
        } else if (text.startsWith("Normal")) {
          emit(
            [
              "## Calculation",
              "$F = kx$",
              "$$x = \\frac{F}{k}$$",
              fenced(flowchart),
              fenced(sequence),
              "```python\nforce = 30\n```",
            ].join("\n\n"),
          );
        } else if (text.startsWith("Hostile"))
          emit(adversarial.map(fenced).join("\n\n"));
        else if (text.startsWith("Large"))
          emit(
            fenced("flowchart LR\n" + "A[Large] --> B[Result]\n".repeat(200)),
          );
        else emit(fenced("flowchart LR\n A[unfinished"));
      },
      async abort() {
        abort?.(Error("Cancelled"));
      },
      dispose() {
        abort?.(Error("Closed"));
      },
    };
  },
});
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [],
  externalRequests = [],
  libraryRequests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.url().includes("diagram.invalid"))
    externalRequests.push(request.url());
  if (/\/assets\/mermaid[^/]*\.js/.test(request.url()))
    libraryRequests.push(request.url());
});
page.setDefaultTimeout(20000);
try {
  await page.route("**/api/assistant/configuration", (route) =>
    route.fulfill({
      json: {
        defaultProvider: "test",
        defaultModel: "test",
        providers: [
          {
            id: "test",
            name: "Test",
            configured: true,
            models: [{ id: "test", name: "Test" }],
          },
        ],
      },
    }),
  );
  await page.route("**/api/assistant/connect", (route) =>
    route.fulfill({ json: { url: companion.url } }),
  );
  await page.goto(base);
  const before = await readWorkspace(page);
  await page.getByRole("button", { name: "Ask agent", exact: true }).click();
  const panel = page.getByRole("dialog", {
      name: "Canvas assistant Pi · experimental",
    }),
    input = panel.getByRole("textbox", {
      name: "Ask about or edit the canvas",
    });
  expect(libraryRequests).toEqual([]);
  const ask = async (text) => {
    const turns = await panel.locator(".assistant-turn").count();
    await input.fill(text);
    await panel
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await expect(panel.locator(".assistant-turn")).toHaveCount(turns + 1);
    await expect(
      panel.getByRole("button", { name: "Stop request", exact: true }),
    ).toHaveCount(0);
    return panel.locator(".assistant-answer").last();
  };
  const normal = await ask("Normal diagrams and mathematics");
  await expect(
    normal.getByRole("heading", { name: "Calculation", exact: true }),
  ).toBeVisible();
  await expect(normal.locator(".katex")).toHaveCount(2);
  await expect(normal.locator(".katex-error")).toHaveCount(0);
  const previews = normal.locator('iframe[title="Mermaid diagram preview"]');
  await expect(previews).toHaveCount(2);
  await expect(previews.nth(0).contentFrame().locator("svg")).toBeVisible();
  await expect(previews.nth(0).contentFrame().locator("svg")).toContainText(
    "Measurements",
  );
  await expect(previews.nth(1).contentFrame().locator("svg")).toContainText(
    "Checked result",
  );
  for (const preview of await previews.all()) {
    await expect(preview).toHaveAttribute("sandbox", "");
    await expect(
      preview
        .contentFrame()
        .locator('meta[http-equiv="Content-Security-Policy"]'),
    ).toHaveAttribute("content", /default-src 'none'/);
    await expect(
      preview
        .contentFrame()
        .locator("script,img,image,a,foreignObject,svg style"),
    ).toHaveCount(0);
  }
  await normal
    .locator(".assistant-diagram")
    .first()
    .getByText("Diagram source", { exact: true })
    .click();
  await expect(
    normal.locator(".assistant-diagram").first().locator("pre"),
  ).toHaveText(flowchart);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.diagramCopied = text;
        },
      },
    }),
  );
  await normal
    .getByRole("button", { name: "Copy diagram source", exact: true })
    .first()
    .click();
  expect(await page.evaluate(() => window.diagramCopied)).toBe(flowchart);
  await normal.getByRole("button", { name: "Copy code", exact: true }).click();
  expect(await page.evaluate(() => window.diagramCopied)).toBe("force = 30\n");
  const malformed = await ask("Malformed diagram");
  await expect(
    malformed.locator(".assistant-diagram p[role=status]"),
  ).toContainText("incomplete");
  await expect(malformed.locator(".assistant-diagram pre")).toHaveText(
    "flowchart LR\n A[unfinished",
  );
  await expect(malformed.locator("iframe")).toHaveCount(0);
  await input.fill("Stream partial diagram");
  await panel
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  const streamed = panel.locator(".assistant-answer").last();
  await expect(
    streamed.locator(".assistant-diagram p[role=status]"),
  ).toContainText("incomplete");
  expect(typeof releaseStream).toBe("function");
  releaseStream();
  await expect(
    streamed.locator("iframe").contentFrame().locator("svg"),
  ).toContainText("Fresh result");
  await expect(streamed.locator("iframe")).toHaveCount(1);
  const hostile = await ask("Hostile diagram output");
  await expect(hostile.locator(".assistant-diagram")).toHaveCount(
    adversarial.length,
  );
  await expect(
    hostile.locator(".assistant-diagram").nth(0).locator("p[role=status]"),
  ).toContainText("configuration");
  await expect(
    hostile.locator(".assistant-diagram").nth(3).locator("p[role=status]"),
  ).toContainText("Embedded content");
  await expect
    .poll(() => page.locator(".assistant-diagram-measure").count())
    .toBe(0);
  for (const frame of await hostile.locator("iframe").all())
    await expect(
      frame
        .contentFrame()
        .locator("script,img,image,a,foreignObject,svg style"),
    ).toHaveCount(0);
  const oversized = await ask("Large diagram");
  await expect(
    oversized.locator(".assistant-diagram p[role=status]"),
  ).toContainText("too large");
  await expect(oversized.locator(".assistant-diagram pre")).toContainText(
    "A[Large]",
  );
  await input.fill("Stream then close");
  await panel
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Stop request", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "End assistant session", exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  await expect
    .poll(() => page.locator(".assistant-diagram-measure").count())
    .toBe(0);
  expect(await page.evaluate(() => window.diagramInjected)).toBeUndefined();
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
  expect((await readWorkspace(page)).page).toEqual(before.page);
  console.log(
    "Assistant rendering: lazy bounded Mermaid flowcharts/sequences, unchanged Markdown/KaTeX/code, source/copy fallback, malformed/streamed updates, cleanup and adversarial configuration/encoded content/CSS resource isolation pass.",
  );
} finally {
  await browser.close();
  await companion.close();
}
