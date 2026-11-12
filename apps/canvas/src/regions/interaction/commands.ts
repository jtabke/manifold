/** A bounded command contract shared by toolbar, marking, context and search. */
import { plotChoices } from "../linking.ts";
import {
  type Page,
  type Projection,
  type ConnectionEdit,
} from "../document.ts";
import { makeArtifact, type Artifact } from "../artifacts.ts";

export type CommandKind =
  | "canvas"
  | "equation"
  | "quantity"
  | "result"
  | "term"
  | "dataset"
  | "plot"
  | "model"
  | "note"
  | "selection";
export type Intent = "edit" | "explore" | "connect" | "inspect";
export type CommandSelection = {
  owner: string;
  kind: "result" | "term" | "plot";
  symbol?: string;
  view?: string;
  definition?: string;
};
export type CommandTarget = {
  kind: CommandKind;
  id?: string;
  owner?: string;
  symbol?: string;
  view?: string;
  ids?: string[];
};
type SimpleOperation =
  | "selection.copy-png"
  | "selection.save-png"
  | "definition.edit"
  | "mathematics.enable"
  | "quantity.vary"
  | "quantity.trace"
  | "context.compare"
  | "dataset.inspect"
  | "dataset.connect"
  | "dataset.collapse"
  | "model.enter"
  | "model.detail"
  | "selection.organize"
  | "selection.group"
  | "selection.model"
  | "canvas.write"
  | "canvas.fit"
  | "canvas.new"
  | "model.author"
  | "model.spring"
  | "model.scale"
  | "data.import"
  | "reference.add"
  | "canvas.undo"
  | "search.open"
  | "help.shortcuts"
  | "overlay.dependencies"
  | "overlay.requirements"
  | "canvas.stack"
  | "canvas.evaluate"
  | "history.open"
  | "workspace.open"
  | "workspace.export"
  | "workspace.cleanup"
  | "system.explore"
  | "marking.open";
export type CommandRequest = { target: CommandTarget } & (
  | { operation: SimpleOperation }
  | {
      operation: "response.plot";
      input: string;
      output: string;
      request?: string;
    }
  | { operation: "definition.code"; input: string; output: string }
  | { operation: "response.open" | "dataset.visualize"; view: string }
  | {
      operation: "quantity.connect";
      connection?: ConnectionEdit;
      symbol?: string;
    }
);
type CommandOperation = CommandRequest["operation"];

/** Incomplete discovery parameters never become an executable request. */
function commandRequest(
  operation: CommandOperation,
  target: CommandTarget,
  parameters: { input?: string; output?: string; view?: string },
): CommandRequest | undefined {
  switch (operation) {
    case "response.plot":
    case "definition.code":
      return parameters.input && parameters.output
        ? {
            operation,
            target,
            input: parameters.input,
            output: parameters.output,
          }
        : undefined;
    case "response.open":
    case "dataset.visualize":
      return parameters.view
        ? { operation, target, view: parameters.view }
        : undefined;
    case "quantity.connect":
      return { operation, target };
    default:
      return { operation, target };
  }
}
export type CanvasCommand = {
  id: string;
  key: string;
  target: CommandTarget;
  targets: CommandKind[];
  label: string;
  toolbarLabel?: string;
  icon: string;
  intent?: Intent;
  keywords: string[];
  unavailable?: string;
  parameters: Record<string, string | string[]>;
  preview: string;
  undo: {
    kind: "document" | "view" | "navigation" | "none";
    description: string;
  };
  run: () => void;
};
/** Describes reversal; it never executes or changes engineering state. */
const undoEffect = (
  kind: CanvasCommand["undo"]["kind"],
  description: string,
): CanvasCommand["undo"] => ({ kind, description });
export type CommandContext = {
  page: Page;
  projection: Projection;
  target: CommandTarget;
  artifacts: readonly Artifact[];
  columns: number[];
  previewActive: boolean;
  canVary: boolean;
  collapsed: boolean;
  canUndo: boolean;
  supportsArtifacts: boolean;
};

export function commandTarget(
  p: Projection,
  selected?: string,
  detail?: CommandSelection,
  ids: string[] = [],
  isDataset = false,
  isModel = false,
): CommandTarget {
  if (ids.length > 1) return { kind: "selection", ids: [...ids] };
  if (!selected) return { kind: "canvas" };
  if (detail?.owner === selected) {
    if (detail.kind === "term") {
      const source =
        detail.symbol &&
        (p.bindings[selected]?.[detail.symbol] ||
          (p.sources[detail.symbol]?.length === 1
            ? p.sources[detail.symbol][0]
            : undefined));
      return {
        kind: "term",
        owner: selected,
        id: source || undefined,
        symbol: detail.symbol,
      };
    }
    return {
      kind: detail.kind,
      id: detail.definition || selected,
      owner: selected,
      view: detail.view,
    };
  }
  return {
    kind: isDataset
      ? "dataset"
      : isModel
        ? "model"
        : p.kinds[selected] === "quantity"
          ? "quantity"
          : p.statements.has(selected) || p.kinds[selected] === "draft"
            ? "equation"
            : "note",
    id: selected,
    owner: selected,
  };
}

export function commandSubject({
  target,
  projection: p,
  page,
  artifacts,
}: CommandContext) {
  const name = target.id && p.statements.get(target.id)?.name;
  if (target.kind === "term")
    return `Term ${target.symbol} in ${p.statements.get(target.owner!)?.name || "equation"}`;
  if (target.kind === "plot") {
    const a =
      artifacts.find((a) => a.id === target.view) ||
      page.plots.find((plot) => plot.id === target.view);
    return `Plot ${name || "response"}${a ? ` against ${p.statements.get(a.input)?.name || "input"}` : ""}`;
  }
  if (target.kind === "selection") return `${target.ids?.length} selected`;
  if (target.kind === "dataset")
    return `Dataset ${page.regions.find((r) => r.id === target.id)?.data?.name || "unavailable"}`;
  if (target.kind === "model")
    return `Model ${page.models?.find((m) => m.id === target.id)?.name || "unavailable"}`;
  return target.kind === "canvas"
    ? "Canvas"
    : `${target.kind[0].toUpperCase()}${target.kind.slice(1)}${name ? ` ${name}` : ""}`;
}

export function resolveCommands(
  c: CommandContext,
  execute: (request: CommandRequest) => void,
): CanvasCommand[] {
  const { target: t, projection: p, page } = c;
  const commands: CanvasCommand[] = [];
  const definition = t.id && p.statements.get(t.id);
  const resolved =
    !!definition &&
    !p.errors.has(t.id!) &&
    p.solved.values.has(definition.name);
  const add = (
    id: CommandOperation | "response.plot.input",
    label: string,
    icon: string,
    intent: Intent | undefined,
    options: {
      toolbar?: string;
      unavailable?: string;
      input?: string;
      output?: string;
      view?: string;
      operation?: CommandOperation;
      preview?: string;
      undo?: CanvasCommand["undo"];
      keywords?: string[];
    } = {},
  ) => {
    const request = commandRequest(
      options.operation ||
        (id === "response.plot.input" ? "response.plot" : id),
      t,
      options,
    );
    const unavailable =
      options.unavailable ||
      (!request ? "Required command inputs are unavailable." : undefined);
    commands.push({
      id,
      key: [
        id,
        t.kind,
        t.id || t.owner || "canvas",
        options.output || "",
        options.input || "",
        options.view || "",
      ].join(":"),
      target: t,
      targets: [t.kind],
      label,
      toolbarLabel: options.toolbar,
      icon,
      intent,
      keywords: [
        label,
        options.toolbar || "",
        t.symbol || "",
        definition ? definition.name : "",
        ...(options.keywords || []),
      ],
      unavailable,
      parameters: {
        ...(t.id ? { target: t.id } : {}),
        ...(t.ids ? { targets: t.ids } : {}),
        ...(options.input ? { input: options.input } : {}),
        ...(options.output ? { output: options.output } : {}),
        ...(options.view ? { view: options.view } : {}),
      },
      preview: options.preview || label,
      undo:
        options.undo ||
        undoEffect(
          "navigation",
          "Changes selection or view; engineering definitions remain unchanged.",
        ),
      run: () => {
        if (!unavailable && request) execute(request);
      },
    });
  };
  const editUndo: CanvasCommand["undo"] = undoEffect(
    "document",
    "Undo restores the previous committed definition or value.",
  );
  const missing = !t.id
    ? `Define ${t.symbol || "the quantity"} before using this command.`
    : undefined;
  if (
    ["equation", "quantity", "term", "result", "plot", "note"].includes(t.kind)
  ) {
    const editLabel =
      t.kind === "term"
        ? `Edit definition of ${t.symbol}`
        : t.kind === "quantity"
          ? "Edit value"
          : t.kind === "plot"
            ? "Edit source equation"
            : "Edit equation";
    add(
      "definition.edit",
      t.kind === "note" ? "Edit note" : editLabel,
      "edit",
      "edit",
      {
        toolbar: ["result", "plot"].includes(t.kind)
          ? undefined
          : t.kind === "term"
            ? "Edit definition"
            : t.kind === "quantity"
              ? "Edit value"
              : "Edit",
        unavailable: missing,
        undo: editUndo,
      },
    );
    if (t.kind !== "note") {
      const scalar =
        (t.kind === "quantity" || t.kind === "term") &&
        t.id &&
        p.kinds[t.id] === "quantity";
      if (scalar)
        add("quantity.vary", "Vary input", "vary", "explore", {
          toolbar: "Vary",
          unavailable: !c.canVary
            ? "This definition has no editable resolved scalar input."
            : undefined,
          preview:
            "Preview a bound value and its consequences; accept, keep an alternative or cancel without changing the baseline.",
          undo: editUndo,
        });
      if (page.regions.find((r) => r.id === t.id)?.mathVersion !== 2)
        add(
          "mathematics.enable",
          "Use scientific math (v2)",
          "edit",
          undefined,
          {
            preview:
              "Explicitly change this equation’s function/constant rules. Existing saved calculations retain their original interpretation. Undo restores the old rules.",
            undo: editUndo,
            keywords: ["math", "functions", "scientific", "upgrade"],
          },
        );
      const choices = t.id ? plotChoices(page, t.id) : [];
      const first = choices[0];
      add(
        "response.plot",
        "Plot response",
        "plot",
        scalar ? undefined : "explore",
        {
          toolbar:
            t.kind === "equation"
              ? "Plot"
              : ["result", "plot"].includes(t.kind)
                ? "Explore"
                : undefined,
          input: first?.input,
          output: first?.output,
          unavailable: c.previewActive
            ? "Accept or revert the current preview before plotting."
            : !first
              ? missing ||
                (p.errors.get(t.id!)
                  ? `Resolve the calculation: ${p.errors.get(t.id!)}`
                  : "A resolved equation and an assigned input are required to plot a response.")
              : undefined,
          preview:
            "Create a response view bound to these definitions and the current scenario.",
          undo: undoEffect(
            "view",
            "Remove the response view to reverse creation; source definitions are preserved.",
          ),
          keywords: ["explore", "visualize"],
        },
      );
      for (const choice of choices) {
        const input =
          page.regions.find((r) => r.id === choice.input)?.label ||
          p.statements.get(choice.input)?.name ||
          choice.input;
        const output = p.statements.get(choice.output)?.name || choice.output;
        add(
          "response.plot.input",
          choices.some((c) => c.output !== choice.output)
            ? `Plot ${output} against ${input}`
            : `Plot against ${input}`,
          "plot",
          undefined,
          {
            input: choice.input,
            output: choice.output,
            operation: "response.plot",
            unavailable: c.previewActive
              ? "Accept or revert the current preview before plotting."
              : undefined,
            preview: `Sample ${p.statements.get(choice.output)?.name} against ${input}; preserve the source identities.`,
            undo: undoEffect(
              "view",
              "Remove the response view to reverse creation.",
            ),
            keywords: ["plot", "response", "explore", input],
          },
        );
      }
      for (const artifact of c.artifacts.filter(
        (a) => a.output === t.id || a.input === t.id,
      ))
        add(
          "response.open",
          `Open existing response plot (${p.statements.get(artifact.output)?.name} / ${p.statements.get(artifact.input)?.name})`,
          "plot",
          undefined,
          { view: artifact.id, keywords: ["plot", "response", "open"] },
        );
      add("quantity.connect", "Connect", "connect", "connect", {
        toolbar: t.kind === "equation" ? "Connect" : undefined,
        unavailable: missing,
        preview:
          "Open connection choices and review their meaning, units and scope before acceptance.",
        undo: undoEffect(
          "document",
          "Opening the review changes nothing; Undo reverses an accepted connection.",
        ),
      });
      add(
        "quantity.trace",
        t.kind === "quantity"
          ? "Find uses"
          : ["result", "plot"].includes(t.kind)
            ? "Inspect source"
            : "Trace",
        "inspect",
        "inspect",
        {
          toolbar:
            t.kind === "quantity"
              ? "Find uses"
              : t.kind === "term"
                ? "Find uses"
                : ["result", "plot"].includes(t.kind)
                  ? "Inspect source"
                  : undefined,
          unavailable: missing,
          keywords: ["inspect", "trace", "source", "uses"],
        },
      );
      add("context.compare", "Try alternative", "compare", undefined, {
        toolbar: ["result", "plot"].includes(t.kind) ? "Compare" : undefined,
        unavailable: c.previewActive
          ? "Accept or revert the current preview first."
          : !resolved
            ? "Resolve the selected calculation before comparing assumptions."
            : !page.regions.some(
                  (r) => p.kinds[r.id] === "quantity" && !p.errors.has(r.id),
                )
              ? "Define an input before comparing alternatives."
              : undefined,
        preview:
          "Preserve the current assumptions and create a separate alternative.",
        undo: undoEffect(
          "document",
          "Undo removes the newly created alternative.",
        ),
        keywords: ["compare", "scenario", "original"],
      });
      add("definition.code", "Inspect computation", "code", undefined, {
        unavailable: !c.supportsArtifacts
          ? "Computational artifacts are not enabled in this view."
          : !first
            ? "Resolve an equation and its assigned input before inspecting sampled code."
            : undefined,
        input: first?.input,
        output: first?.output,
      });
    }
  } else if (t.kind === "dataset") {
    add("dataset.inspect", "Inspect data", "inspect", "inspect", {
      toolbar: "Inspect",
    });
    add("dataset.connect", "Connect data", "connect", "connect", {
      toolbar: "Connect",
      unavailable: !c.columns.length
        ? "Select data columns before connecting them to an equation."
        : undefined,
      preview:
        "Review column mappings, units and paired record scope before accepting.",
      undo: undoEffect(
        "document",
        "Undo reverses an accepted data relationship.",
      ),
    });
    const relation = page.dataRelations?.find((r) => r.dataset === t.id);
    add("dataset.visualize", "Visualize calculated data", "plot", "explore", {
      toolbar: "Visualize",
      unavailable: !relation
        ? "Connect columns to an equation before visualizing its calculated response."
        : undefined,
      view: relation?.id,
    });
    add(
      "dataset.collapse",
      c.collapsed ? "Expand data" : "Collapse data",
      "layers",
      "edit",
    );
  } else if (t.kind === "model") {
    add("model.enter", "Enter model", "enter", "edit");
    add("model.detail", "Show detail", "layers", "inspect");
    add("canvas.fit", "Fit canvas", "focus", "explore");
  } else if (t.kind === "selection") {
    add("selection.organize", "Organize", "organize", "edit", {
      undo: undoEffect("document", "Undo restores the previous arrangement."),
    });
    add("selection.group", "Group", "group", undefined, {
      undo: undoEffect(
        "view",
        "Detach the visual group to restore independent arrangement.",
      ),
    });
    add("selection.model", "Make model", "model", undefined, {
      preview:
        "Review the proposed model boundary and interface before creating it.",
      undo: undoEffect("document", "Undo reverses model creation."),
    });
    add("quantity.connect", "Connect", "connect", "connect", {
      unavailable: !t.ids?.some((id) => p.statements.has(id))
        ? "Select mathematical quantities to connect."
        : undefined,
    });
  } else {
    add("canvas.write", "Write here", "edit", "edit", { undo: editUndo });
    add("data.import", "Import CSV", "import", "explore", {
      undo: undoEffect("document", "Undo removes the imported source."),
    });
    add("reference.add", "Add reference", "reference", "connect", {
      undo: editUndo,
    });
    add("canvas.fit", "Fit canvas", "focus", "inspect");
  }
  if (t.kind !== "canvas") {
    for (const [operation, label] of [
      ["selection.copy-png", "Copy as PNG"],
      ["selection.save-png", "Save as PNG…"],
    ] as const)
      add(operation, label, "image", undefined, {
        preview:
          "Export the visible selection as a tightly cropped, transparent PNG. This is a visual snapshot, not an editable workspace.",
        undo: undoEffect("none", "Export changes no saved work or history."),
        keywords: [
          "image",
          "transparent",
          "background",
          "screenshot",
          "export",
        ],
      });
  }
  if (t.kind !== "canvas")
    add("canvas.write", "Write below", "edit", undefined, { undo: editUndo });
  return commands;
}

export function workspaceCommands(
  c: CommandContext,
  execute: (request: CommandRequest) => void,
): CanvasCommand[] {
  const target: CommandTarget = { kind: "canvas" };
  const commands: CanvasCommand[] = resolveCommands(
    { ...c, target },
    execute,
  ).map((command) => ({ ...command, intent: undefined }));
  const definitions: [
    SimpleOperation,
    string,
    string,
    CanvasCommand["undo"]?,
  ][] = [
    ["canvas.new", "New canvas", "create"],
    ["model.author", "Create reusable model", "layers"],
    ["model.spring", "Insert spring model", "layers"],
    ["model.scale", "Insert force scale model", "layers"],
    [
      "canvas.undo",
      "Undo",
      "undo",
      undoEffect(
        "none",
        "Undo restores the previous accepted state; Redo reapplies the undone edit.",
      ),
    ],
    ["search.open", "All actions", "search"],
    [
      "help.shortcuts",
      "Keyboard shortcuts",
      "inspect",
      undoEffect("none", "Opening help changes no saved work or history."),
    ],
    ["overlay.dependencies", "Reveal dependencies", "inspect"],
    ["overlay.requirements", "Reveal requirements", "inspect"],
    [
      "canvas.stack",
      "Stack regions",
      "organize",
      undoEffect("document", "Undo restores the previous arrangement."),
    ],
    ["canvas.evaluate", "Recalculate", "code"],
    ["history.open", "Calculation history", "inspect"],
    ["marking.open", "Marking menu (experimental)", "focus"],
    ["workspace.open", "Open workspace", "import"],
    ["workspace.export", "Export workspace", "reference"],
  ];
  if (c.supportsArtifacts)
    definitions.push([
      "workspace.cleanup",
      "Review workspace cleanup",
      "organize",
      undoEffect(
        "none",
        "Review unused history and saved data; cleanup cannot itself be undone.",
      ),
    ]);
  if (c.page.models && c.page.models.length > 1)
    definitions.push([
      "system.explore",
      "Explore system relationships",
      "layers",
    ]);
  for (const [id, label, icon, undo] of definitions) {
    const unavailable =
      id === "canvas.undo" && !c.canUndo
        ? "No changes to undo yet."
        : undefined;
    commands.push({
      id,
      key: id,
      target,
      targets: ["canvas"],
      label,
      icon,
      keywords:
        id === "help.shortcuts" ? [label, "help", "hotkeys", "keys"] : [label],
      unavailable,
      parameters: {},
      preview: label,
      undo:
        undo ??
        undoEffect(
          "navigation",
          "This workspace operation does not change engineering definitions.",
        ),
      run: () => {
        if (!unavailable) execute({ operation: id, target });
      },
    });
  }
  return commands;
}

/** Cardinal categories never rotate when the engineering object changes. */
export function markingCommands(commands: CanvasCommand[]) {
  return (["edit", "explore", "connect", "inspect"] as Intent[]).map((intent) =>
    commands.find((c) => c.intent === intent),
  );
}
export function toolbarCommands(commands: CanvasCommand[], kind: CommandKind) {
  const order =
    kind === "result" || kind === "plot"
      ? ["quantity.trace", "response.plot", "context.compare"]
      : kind === "quantity" || kind === "term"
        ? ["definition.edit", "quantity.vary", "quantity.trace"]
        : kind === "dataset"
          ? ["dataset.inspect", "dataset.connect", "dataset.visualize"]
          : ["definition.edit", "response.plot", "quantity.connect"];
  return order
    .flatMap((id) =>
      commands.filter((command) => command.id === id && command.toolbarLabel),
    )
    .slice(0, 3);
}
export function requestedPlotCommand(
  c: CommandContext,
  query: string,
  execute: (request: CommandRequest) => void,
): CanvasCommand | undefined {
  if (!/^plot\s+.+\s+(?:versus|vs\.?)\s+.+\s+from\s+/i.test(query)) return;
  const base = resolveCommands(c, execute).find(
    (command) => command.id === "response.plot",
  );
  if (!base) return;
  let input = base.parameters.input as string | undefined;
  const output = base.parameters.output as string | undefined;
  let unavailable = base.unavailable;
  if (!unavailable && output) {
    try {
      input = makeArtifact(c.page, output, query).input;
    } catch (error) {
      unavailable = (error as Error).message;
    }
  }
  return {
    ...base,
    key: `${base.key}:${query}`,
    label: "Plot response",
    unavailable,
    parameters: { ...base.parameters, request: query },
    preview: query,
    run: () => {
      if (!unavailable && output && input)
        execute({
          operation: "response.plot",
          target: base.target,
          output,
          input,
          request: query,
        });
    },
  };
}
export function searchCommands(
  commands: CanvasCommand[],
  query: string,
  recent: string[],
) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return commands
    .filter((c) =>
      words.every((word) => c.keywords.join(" ").toLowerCase().includes(word)),
    )
    .sort(
      (a, b) =>
        Number(!!a.unavailable) - Number(!!b.unavailable) ||
        (recent.includes(a.key) ? recent.indexOf(a.key) : 999) -
          (recent.includes(b.key) ? recent.indexOf(b.key) : 999),
    );
}
