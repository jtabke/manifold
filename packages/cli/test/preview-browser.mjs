import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { buildPreview } from "../../../apps/assistant/build-preview.mjs";

await buildPreview();
const html = await readFile(
  new URL("../../../apps/assistant/dist/mcp-preview.html", import.meta.url),
  "utf8",
);
const host = await build({
  stdin: {
    contents: `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
window.installBridge = async () => {
  const frame = document.querySelector("iframe");
  const bridge = new AppBridge(null,{name:"test-host",version:"1"},{});
  window.calls = 0;
  bridge.oncalltool = async () => { window.calls++; throw Error("Preview must not call tools"); };
  bridge.oninitialized = () => { window.initialized = true; };
  window.bridge = bridge;
  await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
};`,
    resolveDir: process.cwd(),
    sourcefile: "preview-host.mjs",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const browser = await chromium.launch(browserOptions());
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const network = [];
  page.on("request", (request) => network.push(request.url()));
  await page.setContent(
    '<iframe title="MCP canvas preview" sandbox="allow-scripts allow-same-origin"></iframe>',
  );
  await page.addScriptTag({ content: host.outputFiles[0].text });
  await page.evaluate(() => window.installBridge());
  await page.locator("iframe").evaluate((frame, html) => {
    frame.srcdoc = html;
  }, html);
  await page.waitForFunction(() => window.initialized);
  const frame = page.frames()[1];
  assert.match(await frame.locator("#status").innerText(), /Waiting/);
  // Actual JPEG bytes from the owned browser, no external image or network service.
  const jpeg = (await page.screenshot({ type: "jpeg" })).toString("base64");
  await page.evaluate(
    async (data) =>
      window.bridge.sendToolResult({
        content: [{ type: "image", mimeType: "image/jpeg", data }],
      }),
    jpeg,
  );
  await frame.locator("#preview").waitFor({ state: "visible" });
  await frame.waitForFunction(
    () => document.querySelector("#preview").naturalWidth > 0,
  );
  assert.match(
    await frame.locator("#status").innerText(),
    /not a live view or engineering validation/,
  );
  await page.evaluate(async () =>
    window.bridge.sendToolResult({
      isError: true,
      content: [
        { type: "text", text: "<script>malicious workspace data</script>" },
      ],
    }),
  );
  await frame.locator("#preview").waitFor({ state: "hidden" });
  assert.match(await frame.locator("#status").innerText(), /No canvas image/);
  assert.equal(await frame.locator("#preview").getAttribute("src"), null);
  await page.evaluate(async () =>
    window.bridge.sendToolResult({
      content: [
        { type: "image", mimeType: "image/jpeg", data: "javascript:alert(1)" },
      ],
    }),
  );
  await frame.locator("#preview").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.calls), 0);
  assert.deepEqual(
    network.filter((url) => !url.startsWith("data:")),
    [],
  );
  assert.deepEqual(errors, []);
  console.log(
    "MCP App preview: real Apps handshake, image rendering, safe errors and zero tool/network calls passed.",
  );
} finally {
  await browser.close();
}
