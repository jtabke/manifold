#!/usr/bin/env node
/** Local agent CLI: no server, prompts, network executor, or in-place writes. */
import { lstat, link, unlink, open } from "node:fs/promises";
import { readBoundedText } from "./read-bounded.mjs";
import { MAX_CANVAS_FILE_BYTES } from "../src/regions/app/canvasStorageBudget.ts";
import { resolve, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createHeadlessWorkspace,
  openHeadlessWorkspace,
  HeadlessError,
} from "../src/headless.ts";
import {
  agentCapabilities,
  inspectWorkspace,
  summarizeWorkspace,
  summarizeWorksheet,
  editWorkspace,
  validateWorkspace,
  compareWorkspaces,
} from "../src/agent.ts";

const help = `Manifold agent CLI (experimental, protocolVersion 1; Node 22.18+)
Usage: manifold <command> [workspace.json] [options]
  capabilities                         Discover operations and edit JSON schema
  create --output FILE                 Create an empty native workspace
  inspect FILE [--compact]             Inspect worksheet, models and result currency
  worksheet FILE [--region ID] [--compact]  Inspect worksheet source and derived values
  models FILE [--compact]              Discover models and public ports/requests
  model FILE --model ID [--compact]    Inspect one discovered model
  edit FILE --changes FILE --output FILE  Apply an atomic JSON edit batch
  validate FILE [--strict]              Report content issues; strict exits 3 if any
  diff BASELINE CANDIDATE               Compare source, values and result currency
  compute FILE --request ID --output FILE [--timeout-ms N]
                                       Execute one discovered model request
All responses are JSON on stdout (--json is accepted). Errors go to stderr.
Discovery defaults to full JSON; --compact omits provenance trees and receipt keys.
Output files must not exist. No in-place writes, implicit computation, or sampling.
Exit codes: 0 success, 2 input/domain error, 3 validation issues, 4 compute failure,
5 filesystem error, 6 stale input, 124 timeout, 130 interrupted.
See docs/guides/agents.md for the workflow and docs/reference/cli.md for contracts.
`;
class CliError extends Error {
  constructor(code, message, exitCode = 2) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}
const fail = (message) => {
  throw new CliError("INVALID_ARGUMENT", message);
};
function parse(args) {
  const [command, ...rest] = args;
  const specs = {
    capabilities: [],
    create: ["output"],
    inspect: ["compact"],
    worksheet: ["region", "compact"],
    models: ["compact"],
    model: ["model", "compact"],
    edit: ["changes", "output"],
    validate: ["strict"],
    diff: [],
    compute: ["request", "output", "timeout-ms"],
  };
  if (!Object.hasOwn(specs, command ?? "")) fail("Unknown command; use --help");
  const options = Object.create(null),
    paths = [];
  for (let i = 0; i < rest.length; i++) {
    const value = rest[i];
    if (!value.startsWith("--")) {
      paths.push(value);
      continue;
    }
    const name = value.slice(2);
    if (
      !["json", ...specs[command]].includes(name) ||
      Object.hasOwn(options, name)
    )
      fail(`Unknown or duplicate option: ${value}`);
    if (["json", "strict", "compact"].includes(name)) options[name] = true;
    else {
      if (!rest[i + 1] || rest[i + 1].startsWith("--"))
        fail(`Missing value for ${value}`);
      options[name] = rest[++i];
    }
  }
  const count = ["capabilities", "create"].includes(command)
    ? 0
    : command === "diff"
      ? 2
      : 1;
  if (paths.length !== count)
    fail(`${command} expects ${count} workspace path(s)`);
  const required = {
    create: ["output"],
    model: ["model"],
    edit: ["changes", "output"],
    compute: ["request", "output"],
  };
  for (const name of required[command] ?? [])
    if (!options[name]) fail(`Missing --${name}`);
  if (
    options["timeout-ms"] !== undefined &&
    (!/^\d+$/.test(options["timeout-ms"]) ||
      !Number.isSafeInteger(Number(options["timeout-ms"])) ||
      Number(options["timeout-ms"]) < 1 ||
      Number(options["timeout-ms"]) > 2147483647)
  )
    fail("--timeout-ms must be an integer between 1 and 2147483647");
  return { command, options, paths };
}
async function absent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new CliError("OUTPUT_EXISTS", `Output already exists: ${path}`, 5);
}
async function publish(path, text, inputs, checkInterrupted) {
  const temporary = join(dirname(path), `.manifold-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    for (const input of inputs) {
      const current = await readBoundedText(
        input.path,
        MAX_CANVAS_FILE_BYTES,
      ).catch((error) => {
        if (error.code === "FILE_TOO_LARGE") return undefined;
        throw error;
      });
      if (current !== input.text)
        throw new CliError(
          "STALE_FILE",
          `Input changed during operation: ${input.path}`,
          6,
        );
    }
    checkInterrupted();
    // A same-filesystem hard link publishes complete bytes without replacing any target.
    await link(temporary, path);
  } finally {
    await handle?.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
function jsonFile(text, name) {
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError("INVALID_JSON", `Invalid JSON: ${name}`);
  }
}
async function main() {
  if (
    !process.argv[2] ||
    process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")
  ) {
    process.stdout.write(help);
    return;
  }
  const { command, options, paths } = parse(process.argv.slice(2));
  const owners = [],
    inputs = [];
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  const checkInterrupted = () => {
    if (interrupted)
      throw new CliError("INTERRUPTED", "Operation interrupted", 130);
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    if (options.output) await absent(resolve(options.output));
    async function load(path) {
      path = resolve(path);
      const text = await readBoundedText(path, MAX_CANVAS_FILE_BYTES);
      inputs.push({ path, text });
      const workspace = await openHeadlessWorkspace(text);
      owners.push(workspace);
      return workspace;
    }
    const workspace = paths.length ? await load(paths[0]) : undefined;
    let data;
    switch (command) {
      case "capabilities":
        data = agentCapabilities();
        break;
      case "create": {
        const created = createHeadlessWorkspace();
        owners.push(created);
        data = inspectWorkspace(created);
        break;
      }
      case "inspect":
        data = options.compact
          ? summarizeWorkspace(workspace)
          : inspectWorkspace(workspace);
        break;
      case "worksheet": {
        data = options.compact
          ? summarizeWorksheet(workspace)
          : { documentId: workspace.read().id, ...workspace.worksheet() };
        if (options.region) {
          const region = data.regions.find(
            (region) => region.id === options.region,
          );
          if (!region)
            throw new HeadlessError(
              "ITEM_NOT_FOUND",
              "Worksheet region not found",
              { item: options.region },
            );
          data = { ...data, regions: [region] };
        }
        break;
      }
      case "models":
        data = {
          documentId: workspace.read().id,
          ...(options.compact ? { view: "compact" } : {}),
          models: options.compact
            ? summarizeWorkspace(workspace).models
            : inspectWorkspace(workspace).models,
        };
        break;
      case "model": {
        const model = (
          options.compact
            ? summarizeWorkspace(workspace)
            : inspectWorkspace(workspace)
        ).models.find((model) => model.id === options.model);
        if (!model)
          throw new HeadlessError("ITEM_NOT_FOUND", "Model not found", {
            item: options.model,
          });
        data = options.compact ? { view: "compact", ...model } : model;
        break;
      }
      case "edit": {
        const path = resolve(options.changes),
          text = await readBoundedText(path, MAX_CANVAS_FILE_BYTES);
        inputs.push({ path, text });
        data = editWorkspace(workspace, jsonFile(text, path));
        break;
      }
      case "validate":
        data = validateWorkspace(workspace);
        if (options.strict && !data.clean) process.exitCode = 3;
        break;
      case "diff":
        data = compareWorkspaces(workspace, await load(paths[1]));
        break;
      case "compute": {
        const request = workspace
          .models()
          .flatMap((model) => model.requests)
          .find((request) => request.id === options.request);
        if (!request)
          throw new HeadlessError(
            "ITEM_NOT_FOUND",
            "Discover a model request with models or inspect before computing",
            { item: options.request },
          );
        const timeout = Number(options["timeout-ms"] ?? 60000);
        const deadline = performance.now() + timeout;
        const job = workspace.compute(request.reference);
        let timer, rejectInterrupt;
        const abort = new Promise((_, reject) => {
          rejectInterrupt = reject;
        });
        const onInterrupt = () => {
          job.cancel();
          rejectInterrupt(
            new CliError("INTERRUPTED", "Computation interrupted", 130),
          );
        };
        process.on("SIGINT", onInterrupt);
        process.on("SIGTERM", onInterrupt);
        timer = setTimeout(() => {
          job.cancel();
          rejectInterrupt(
            new CliError("TIMEOUT", "Computation timed out", 124),
          );
        }, timeout);
        try {
          if (interrupted) onInterrupt();
          const completion = await Promise.race([job.completion, abort]);
          // Native synchronous work can delay timer delivery; never publish a late result.
          if (performance.now() >= deadline) {
            job.cancel();
            throw new CliError("TIMEOUT", "Computation timed out", 124);
          }
          data = {
            documentId: workspace.read().id,
            request: request.id,
            completion:
              completion.status === "retained"
                ? {
                    status: completion.status,
                    receipt: {
                      id: completion.receipt.id,
                      key: completion.receipt.key,
                      outcome: completion.receipt.outcome,
                      physicalValidity: completion.receipt.physicalValidity,
                    },
                  }
                : completion,
          };
          if (
            completion.status !== "retained" ||
            completion.receipt.outcome.status !== "success"
          )
            process.exitCode = 4;
        } finally {
          clearTimeout(timer);
          process.off("SIGINT", onInterrupt);
          process.off("SIGTERM", onInterrupt);
        }
        break;
      }
    }
    checkInterrupted();
    if (options.output) {
      const output = resolve(options.output);
      await publish(output, owners[0].export(), inputs, checkInterrupted);
      data = { ...data, output };
    }
    process.stdout.write(
      JSON.stringify({ protocolVersion: 1, ...data }) + "\n",
    );
  } finally {
    for (const owner of owners) owner.dispose();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
try {
  await main();
} catch (error) {
  process.exitCode =
    error instanceof CliError
      ? error.exitCode
      : error instanceof HeadlessError
        ? error.code === "STALE_DOCUMENT"
          ? 6
          : 2
        : error.code === "FILE_TOO_LARGE"
          ? 2
          : 5;
  process.stderr.write(
    JSON.stringify({
      protocolVersion: 1,
      error:
        error instanceof HeadlessError
          ? error.toJSON()
          : { code: error.code ?? "IO_ERROR", message: error.message },
    }) + "\n",
  );
}
