import assert from "node:assert/strict";
import {
  findShortcuts,
  keyboardShortcuts,
} from "../src/regions/interaction/keyboardShortcuts.ts";
import { RegionSession, project } from "../src/regions/document.ts";
import { makeArtifact } from "../src/regions/artifacts.ts";
import {
  commandTarget,
  commandSubject,
  resolveCommands,
  markingCommands,
  toolbarCommands,
  searchCommands,
  requestedPlotCommand,
  workspaceCommands,
} from "../src/regions/interaction/commands.ts";

const session = new RegionSession();
const add = (text) => {
  const id = session.create();
  assert.equal(session.write(id, text).ok, true);
  return id;
};
const power = add("P = F*v"),
  force = add("F = 20 N"),
  speed = add("v = 3 m/s");
const requests = [];
const execute = (request) => requests.push(request);
const context = (id, detail, overrides = {}) => ({
  page: session.state,
  projection: project(session.state),
  target: commandTarget(project(session.state), id, detail),
  artifacts: [],
  columns: [],
  canVary: true,
  previewActive: false,
  collapsed: false,
  canUndo: true,
  supportsArtifacts: true,
  ...overrides,
});
// Workspace commands obey the same executable/disabled contract as contextual commands.
for (const canUndo of [false, true]) {
  const prior = requests.length;
  const workspace = workspaceCommands(
    context(power, undefined, { canUndo }),
    execute,
  );
  const undo = workspace.find((command) => command.id === "canvas.undo");
  undo.run();
  assert.equal(requests.length, prior + Number(canUndo));
  assert.equal(undo.undo.kind, "none");
  assert.doesNotMatch(undo.undo.description, /not implemented/);
  const stack = workspace.find((command) => command.id === "canvas.stack");
  assert.equal(stack.undo.kind, "document");
  assert.equal(
    workspace.find((command) => command.id === "workspace.cleanup").undo.kind,
    "none",
  );
}
requests.length = 0;
for (const supportsArtifacts of [false, true]) {
  for (const count of [0, 1, 2]) {
    const commands = workspaceCommands(
      context(power, undefined, {
        supportsArtifacts,
        page: {
          ...session.state,
          models: Array.from({ length: count }, (_, i) => ({
            id: `model-${i}`,
          })),
        },
      }),
      execute,
    );
    const optional = commands.filter((c) =>
      ["workspace.cleanup", "system.explore"].includes(c.id),
    );
    assert.deepEqual(
      optional.map((c) => c.id),
      [
        ...(supportsArtifacts ? ["workspace.cleanup"] : []),
        ...(count > 1 ? ["system.explore"] : []),
      ],
      "optional commands preserve their availability and order without tuple casts",
    );
  }
}
const c = context(power),
  commands = resolveCommands(c, execute);
const toolbar = toolbarCommands(commands, "equation"),
  marking = markingCommands(commands),
  search = searchCommands(commands, "plot response", []);
assert.deepEqual(
  toolbar.map((c) => c.id),
  ["definition.edit", "response.plot", "quantity.connect"],
);
assert.deepEqual(
  marking.map((c) => c?.id),
  ["definition.edit", "response.plot", "quantity.connect", "quantity.trace"],
);
const plot = commands.find((c) => c.id === "response.plot");
assert.equal(toolbar[1], plot);
assert.equal(marking[1], plot);
assert.ok(search.includes(plot));
const before = JSON.stringify(session.state);
for (const surface of [
  toolbar[1],
  marking[1],
  search.find((c) => c.id === "response.plot"),
])
  surface.run();
assert.deepEqual(requests[0], requests[1]);
assert.deepEqual(requests[1], requests[2]);
assert.equal(requests[0].output, power);
assert.ok([force, speed].includes(requests[0].input));
assert.equal(JSON.stringify(session.state), before);
assert.equal(project(session.state).solved.values.get("P").value, 60);
for (const command of commands) {
  assert.ok(
    command.id && command.key && command.targets.includes(c.target.kind),
  );
  assert.ok(command.preview && command.undo.description);
  assert.ok(command.parameters && command.run);
}
const quantities = resolveCommands(context(force), execute);
assert.deepEqual(
  toolbarCommands(quantities, "quantity").map((c) => c.toolbarLabel),
  ["Edit value", "Vary", "Find uses"],
);
assert.equal(markingCommands(quantities)[1].id, "quantity.vary");
assert.equal(markingCommands(quantities)[2].id, marking[2].id);
assert.equal(markingCommands(quantities)[3].id, marking[3].id);
const result = context(power, { kind: "result", owner: power });
assert.deepEqual(
  toolbarCommands(resolveCommands(result, execute), "result").map(
    (c) => c.toolbarLabel,
  ),
  ["Inspect source", "Explore", "Compare"],
);
const term = context(power, { kind: "term", owner: power, symbol: "F" });
assert.equal(term.target.id, force);
assert.equal(commandSubject(term), "Term F in P");
assert.equal(
  markingCommands(resolveCommands(term, execute))[1].id,
  "quantity.vary",
);
const unresolved = resolveCommands(
  context(power, { kind: "term", owner: power, symbol: "missing" }),
  execute,
);
const count = requests.length;
for (const command of unresolved.filter((c) => c.unavailable)) command.run();
assert.equal(requests.length, count);

// Plot parameters and existing views preserve definitions and bindings.
const variants = commands.filter((c) => c.id === "response.plot.input");
assert.equal(variants.length, 2);
assert.deepEqual(
  new Set(variants.map((c) => c.parameters.input)),
  new Set([force, speed]),
);
const recent = searchCommands(commands, "plot", [variants[1].key]);
assert.equal(recent[0], variants[1]);
const artifact = makeArtifact(
  session.state,
  power,
  "Plot P versus F from 1 to 5",
);
const existing = resolveCommands(
  context(power, undefined, { artifacts: [artifact] }),
  execute,
).find((c) => c.id === "response.open");
assert.equal(existing.parameters.view, artifact.id);
existing.run();
assert.equal(requests.at(-1).operation, "response.open");
const specified = requestedPlotCommand(
  c,
  "Plot P versus v from 1 to 5",
  execute,
);
assert.equal(specified.unavailable, undefined);
specified.run();
assert.equal(requests.at(-1).input, speed);
assert.equal(requests.at(-1).output, power);
const invalid = requestedPlotCommand(
  c,
  "Plot P versus absent from 1 to 5",
  execute,
);
assert.ok(invalid.unavailable);
const previousCount = requests.length;
invalid.run();
assert.equal(requests.length, previousCount);

// Pending previews and unfinished source definitions cannot advertise a runnable plot.
assert.ok(
  resolveCommands(
    context(power, undefined, { previewActive: true }),
    execute,
  ).find((c) => c.id === "response.plot").unavailable,
);
session.write(force, "F =");
const blocked = resolveCommands(context(power), execute).find(
  (c) => c.id === "response.plot",
);
assert.ok(blocked.unavailable);
blocked.run();
assert.equal(requests.length, previousCount);

// Term references resolve their identity-bound source, not a similar display name.
session.write(force, "F = 20 N");
const alias = add("Alias = 1 N");
session.write(alias, "Alias = force_ref", false, { force_ref: force });
assert.equal(
  context(alias, { kind: "term", owner: alias, symbol: "force_ref" }).target.id,
  force,
);
const plotTarget = context(force, {
  kind: "plot",
  owner: force,
  definition: power,
  view: artifact.id,
});
assert.equal(plotTarget.target.id, power);
assert.equal(plotTarget.target.kind, "plot");
assert.equal(findShortcuts("").length, keyboardShortcuts.length);
assert.equal(findShortcuts("ctrl+k").length, 1);
assert.equal(findShortcuts("pan").length, 2, "pan must not match source span");
assert.equal(findShortcuts("+")[0][2], "Zoom in / out");
assert.equal(findShortcuts("-")[0][2], "Zoom in / out");
assert.equal(findShortcuts("cmd k")[0][2], "Search objects and commands");
assert.ok(
  findShortcuts("drawing delete").some(
    (row) => row[2] === "Delete selected marks",
  ),
);
assert.ok(findShortcuts("return").some((row) => row[2] === "Continue below"));
assert.equal(findShortcuts("no-such-shortcut-982").length, 0);
const help = workspaceCommands(context(force), execute).find(
  (command) => command.id === "help.shortcuts",
);
assert.equal(help.undo.kind, "none");
assert.ok(searchCommands([help], "help").includes(help));
help.run();
assert.equal(requests.at(-1).operation, "help.shortcuts");
console.log(
  "Shared commands: surface identity, bound plot parameters, availability, selection kinds, stable intent directions, recent ranking, source aliases and explicit recovery contracts pass.",
);
