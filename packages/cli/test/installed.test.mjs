import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const text = (result) => JSON.parse(result.content[0].text);

test(
  "packed tools work outside the checkout without Pi or source files",
  { timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "manifold-installed-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const packed = await exec(
      "npm",
      [
        "pack",
        "--workspace",
        "@manifold/cli",
        "--pack-destination",
        directory,
        "--json",
      ],
      { cwd: root },
    );
    const packs = JSON.parse(packed.stdout);
    const pack = Array.isArray(packs) ? packs[0] : packs["@manifold/cli"];
    assert(pack.files.some((file) => file.path === "dist/mcp-preview.html"));
    assert(pack.files.some((file) => file.path === "dist/SKILL.md"));
    assert(
      pack.files.some((file) => file.path === "dist/THIRD_PARTY_NOTICES.txt"),
    );
    assert(pack.files.every((file) => !file.path.endsWith(".ts")));
    await exec(
      "npm",
      [
        "install",
        "--prefix",
        directory,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(directory, pack.filename),
      ],
      { cwd: directory },
    );
    const installed = join(directory, "node_modules/@manifold/cli");
    const manifest = JSON.parse(
      await readFile(join(installed, "package.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(manifest.dependencies), ["ws"]);
    assert(
      !(await readdir(join(directory, "node_modules"))).includes(
        "@earendil-works",
      ),
    );
    const notices = await readFile(
      join(installed, "dist/THIRD_PARTY_NOTICES.txt"),
      "utf8",
    );
    for (const dependency of [
      "mathjs",
      "@modelcontextprotocol/sdk",
      "@modelcontextprotocol/ext-apps",
      "seedrandom",
    ])
      assert(notices.includes("## " + dependency + " "));
    const cli = join(installed, "dist/main.mjs");
    assert.match(
      (
        await exec(
          join(directory, "node_modules/.bin/manifold"),
          ["--version"],
          { cwd: directory },
        )
      ).stdout,
      /0\.1\.0/,
    );
    const env = { ...process.env };
    delete env.NODE_PATH;
    delete env.NODE_OPTIONS;
    const run = async (...args) => {
      try {
        const result = await exec(process.execPath, [cli, ...args], {
          cwd: directory,
          env,
        });
        return { ...result, code: 0 };
      } catch (error) {
        return { ...error, code: error.code };
      }
    };
    const json = async (...args) => {
      const result = await run(...args);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
      return JSON.parse(result.stdout);
    };
    const version = await run("--version");
    assert.equal(version.stdout.trim(), manifest.version);
    assert.match((await run("--help")).stdout, /doctor/);
    assert.match((await run("inspect", "--help")).stdout, /inspect/);
    assert.equal((await run("--version", "extra")).code, 2);
    const config = await json("mcp-config");
    assert.equal(config.mcpServers.manifold.command, process.execPath);
    assert.equal(
      config.mcpServers.manifold.args[0],
      join(installed, "dist/mcp.mjs"),
    );
    const created = await json("create", "--output", "initial.manifold");
    assert(created.documentId);
    await writeFile(
      join(directory, "edits.json"),
      JSON.stringify({
        expectedDocumentId: created.documentId,
        edits: [
          { operation: "createEquation", text: "x := 2 mm", as: "input" },
          { operation: "createEquation", text: "F = (10 N/mm)*x" },
        ],
      }),
    );
    const edited = await json(
      "edit",
      "initial.manifold",
      "--changes",
      "edits.json",
      "--output",
      "candidate.manifold",
    );
    assert(edited.aliases.input);
    const inspected = await json("inspect", "candidate.manifold", "--compact");
    assert.equal(inspected.documentId, edited.documentId);
    const validation = await json("validate", "candidate.manifold", "--strict");
    assert.equal(validation.clean, true);
    const diff = await json("diff", "initial.manifold", "candidate.manifold");
    assert.equal(diff.sameDocument, true);
    const overwrite = await run("create", "--output", "candidate.manifold");
    assert.equal(overwrite.code, 5);
    assert.equal(JSON.parse(overwrite.stderr).error.code, "OUTPUT_EXISTS");
    assert.equal(overwrite.stdout, "");
    await json("capabilities");
    await writeFile(
      join(directory, "spring.manifold"),
      await readFile(
        join(root, "apps/canvas/tests/fixtures/agent-spring/baseline.manifold"),
      ),
    );
    const models = await json("models", "spring.manifold");
    const computeRequest = models.models.flatMap((model) => model.requests)[0];
    assert(computeRequest?.id);
    const computed = await json(
      "compute",
      "spring.manifold",
      "--request",
      computeRequest.id,
      "--output",
      "computed.manifold",
    );
    assert.equal(computed.completion.status, "retained");
    assert.equal(computed.completion.receipt.outcome.status, "success");

    const http = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "http://example.com" });
        response.end();
      } else {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(
          request.url === "/other"
            ? "<title>Other app</title>"
            : "<title>Manifold — Connected engineering canvas</title>",
        );
      }
    });
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    t.after(() => new Promise((resolve) => http.close(resolve)));
    const url = `http://127.0.0.1:${http.address().port}/`;
    const doctor = await json("doctor", "--canvas-url", url);
    assert.equal(doctor.ready, true);
    assert.equal(doctor.canvas.identified, true);
    assert.equal((await run("doctor", "--canvas-url", url + "other")).code, 1);
    assert.equal(
      (await run("doctor", "--canvas-url", url + "redirect")).code,
      1,
    );
    for (const url of [
      "https://example.com",
      "http://127.0.0.1@evil.example",
      "http://u:p@localhost",
      "file:///tmp/test",
    ]) {
      assert.equal((await run("doctor", "--canvas-url", url)).code, 2);
    }
    assert.equal((await run("doctor", "--unknown")).code, 2);
    assert.equal((await run("mcp", "--unknown")).code, 2);

    const transport = new StdioClientTransport({
      ...config.mcpServers.manifold,
      env,
      stderr: "pipe",
    });
    let errors = "";
    transport.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const client = new Client({ name: "installed-smoke", version: "1" });
    t.after(() => client.close());
    await client.connect(transport);
    const listed = await client.listTools();
    const look = listed.tools.find((tool) => tool.name === "look_at_canvas");
    assert.equal(
      look._meta.ui.resourceUri,
      "ui://manifold/canvas-preview.html",
    );
    const resources = await client.listResources();
    const resource = await client.readResource({
      uri: resources.resources[0].uri,
    });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(resource.contents[0].text, /Canvas preview/);
    const noCanvas = await client.callTool({
      name: "look_at_canvas",
      arguments: {},
    });
    assert.equal(text(noCanvas).error.code, "NO_CANVAS_CONNECTED");
    const connection = text(
      await client.callTool({ name: "connect_canvas", arguments: {} }),
    );
    assert.equal(connection.connected, false);
    const endpoint = new URLSearchParams(
      new URL(connection.url).hash.slice(1),
    ).get("mcp");
    const ws = new WebSocket(endpoint, { origin: "http://127.0.0.1:58310" });
    t.after(() => ws.terminate());
    const hello = once(ws, "message");
    await once(ws, "open");
    await hello;
    const ready = once(ws, "message");
    ws.send(
      JSON.stringify({
        type: "grant",
        scope: "read-only",
        sessionId: "installed-test",
      }),
    );
    await ready;
    const forbidden = await client.callTool({
      name: "undo",
      arguments: {
        operationId: "new-id",
        expectedSessionId: "installed-test",
        expectedDocumentId: "root",
      },
    });
    assert.equal(text(forbidden).error.code, "PERMISSION_DENIED");
    const message = once(ws, "message");
    const result = client.callTool({ name: "look_at_canvas", arguments: {} });
    const request = JSON.parse((await message)[0].toString());
    assert.equal(request.name, "look_at_canvas");
    ws.send(
      JSON.stringify({
        id: request.id,
        result: { mimeType: "image/jpeg", data: "YWJj", width: 1, height: 1 },
      }),
    );
    assert.equal((await result).content[1].type, "image");
    assert.equal(errors, "");
    ws.terminate();
    await client.close();
  },
);
