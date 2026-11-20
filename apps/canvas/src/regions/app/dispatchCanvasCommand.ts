/** Execute reviewed UI commands against the live session. Menus, shortcuts and search share this path. */
import { parse, quantityLiteral } from "../../notebook/math";
import {
  project,
  type Page,
  type Point,
  type Projection,
  type RegionSession,
} from "../document";
import { sourceSpans } from "../editing";
import { insertModel } from "../modelCommands";
import type { ModelSource } from "../authoredModels";
import type { DataSelection } from "../dataFeedback";
import type { CommandRequest } from "../interaction/commands";
import { canvasScroll } from "../interaction/canvasViewport";
import { exportSelectionPng } from "../renderers/selectionPng";

type ShellAction =
  | "selection.organize"
  | "selection.group"
  | "canvas.fit"
  | "canvas.new"
  | "data.import"
  | "reference.add"
  | "canvas.undo"
  | "help.shortcuts"
  | "search.open"
  | "overlay.dependencies"
  | "overlay.requirements"
  | "history.open"
  | "workspace.open"
  | "workspace.export"
  | "workspace.cleanup"
  | "system.explore"
  | "marking.open";
type CommandPorts = {
  session: RegionSession;
  accepted: Projection;
  canvas: { readonly current: HTMLElement | null };
  zoom: number;
  menu?: { world: Point; target?: string };
  writingPoint: () => Point;
  message: (text: string) => void;
  reveal: (id: string) => void;
  select: (id: string) => void;
  worksheet: {
    edit: (id: string, span?: { start: number; end: number }) => void;
    vary: (id: string) => void;
    trace: (id: string, at?: Point) => void;
    compare: (id?: string) => void;
    reviewLink: (
      source: string,
      target: string,
      symbol: string | undefined,
      at: Point,
    ) => void;
    pickLink: (source?: string, target?: string) => void;
    write: (at: Point) => void;
  };
  plots: {
    artifactsEnabled: boolean;
    create: (
      output: string,
      input: string,
      request?: string,
    ) => string | undefined;
    reopen: (view: string) => void;
    code: (output: string, artifact: string) => void;
  };
  datasets: {
    selection?: DataSelection;
    choose: (selection: DataSelection) => void;
    expand: (id: string) => void;
    collapse: (id: string) => void;
    review: (id: string, columns: number[], rows: number[], at?: Point) => void;
  };
  models: {
    beforeCreate: () => boolean;
    selected: readonly string[];
    views: readonly Point[];
    author: (source: ModelSource, at: Point) => void;
    enter: (id: string) => void;
    detail: (id: string) => void;
    group: (ids: string[]) => void;
  };
  shell: Record<ShellAction, () => void>;
};

function modelSource(page: Page, selection: readonly string[]): ModelSource {
  const { texts } = project(page);
  const rows: ModelSource["rows"][number][] = [],
    inputs: string[] = [],
    outputs: string[] = [];
  for (const r of page.regions) {
    if (
      (selection.length && !selection.includes(r.id)) ||
      Object.keys(page.links?.[r.id] ?? {}).length
    )
      continue;
    const text = texts[r.id] || r.text;
    try {
      const statement = parse(text, undefined, r.mathVersion ?? 1);
      if (statement.relation !== "=") continue;
      rows.push({
        id: r.id,
        text,
        ...(r.mathVersion ? { mathVersion: r.mathVersion } : {}),
      });
      (quantityLiteral(statement.expression) ? inputs : outputs).push(r.id);
    } catch {
      /* Retain drafts on the worksheet; do not turn them into model definitions. */
    }
  }
  if (!rows.length)
    rows.push({
      id: "equation-" + crypto.randomUUID(),
      text: "",
      mathVersion: 3,
    });
  return { rows, inputs, outputs };
}

export function dispatchCanvasCommand(
  command: CommandRequest,
  o: CommandPorts,
): void {
  const { target } = command,
    { id } = target;
  const { session, accepted, worksheet, plots, datasets, models } = o;
  switch (command.operation) {
    case "selection.copy-png":
    case "selection.save-png":
      if (o.canvas.current) {
        o.message("Rendering transparent PNG…");
        void exportSelectionPng(
          o.canvas.current,
          target,
          o.zoom,
          command.operation === "selection.copy-png",
        ).then(o.message, (error: unknown) =>
          o.message(
            `PNG export failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
      return;
    case "mathematics.enable":
    case "mathematics.enable-v3":
      if (id) {
        if (command.operation === "mathematics.enable") {
          session.enableScientificMath(id);
          o.message(
            "Scientific math v2 enabled. Undo restores its earlier rules.",
          );
        } else {
          session.enableScientificMathV3(id);
          o.message(
            "Scientific math enabled for this equation. Undo restores its earlier rules.",
          );
        }
      }
      return;
    case "definition.edit":
      if (id)
        worksheet.edit(
          id,
          accepted.kinds[id] === "quantity"
            ? sourceSpans(accepted.texts[id] || "")[0]
            : undefined,
        );
      return;
    case "quantity.vary":
      if (id) {
        worksheet.vary(id);
        const focus = document.activeElement;
        requestAnimationFrame(() => {
          if (
            document.activeElement === focus ||
            document.activeElement === document.body
          )
            o.canvas.current
              ?.querySelector<HTMLElement>(
                `[data-region-id="${id}"] .er-scrubbable`,
              )
              ?.focus();
        });
        o.message(
          "Explore without changing the baseline. Accept the value, keep an alternative, or cancel.",
        );
      }
      return;
    case "response.plot":
      if (plots.artifactsEnabled)
        plots.create(command.output, command.input, command.request);
      else o.select(session.addPlot(command.output, command.input));
      return;
    case "response.open":
      plots.reopen(command.view);
      requestAnimationFrame(() => o.reveal(command.view));
      return;
    case "quantity.connect": {
      const { connection, symbol } = command;
      if (connection) {
        const reversed = connection.kind === "constrain",
          scroll = canvasScroll(o.canvas.current);
        worksheet.reviewLink(
          reversed ? connection.target : connection.source,
          reversed ? connection.source : connection.target,
          symbol,
          { x: (scroll.x + 160) / o.zoom, y: (scroll.y + 120) / o.zoom },
        );
      } else if (target.kind === "selection") {
        const source = target.ids?.find(
          (i) =>
            accepted.statements.get(i)?.relation === "=" &&
            !accepted.errors.has(i),
        );
        worksheet.pickLink(
          undefined,
          target.ids?.find((i) => i !== source),
        );
      } else if (id) {
        if (accepted.statements.get(id)?.relation === "=")
          worksheet.pickLink(id);
        else worksheet.pickLink(undefined, id);
      }
      return;
    }
    case "quantity.trace":
      if (id) worksheet.trace(id, o.menu?.world);
      return;
    case "context.compare":
      worksheet.compare(id);
      return;
    case "definition.code": {
      const { output, input } = command;
      const artifact =
        session.artifacts.find((a) => a.output === output && a.input === input)
          ?.id || plots.create(output, input);
      if (artifact) plots.code(output, artifact);
      return;
    }
    case "dataset.inspect":
      if (id) {
        datasets.expand(id);
        datasets.choose({ dataset: id, rows: [], columns: [], kind: "series" });
        o.reveal(id);
      }
      return;
    case "dataset.connect":
      if (id)
        datasets.review(
          id,
          datasets.selection?.columns || [],
          datasets.selection?.rows || [],
          o.menu?.world,
        );
      return;
    case "dataset.visualize":
      if (id) {
        datasets.choose({
          dataset: id,
          relation: command.view,
          view: command.view,
          rows: [],
          columns: [],
          kind: "series",
        });
        o.reveal(command.view);
      }
      return;
    case "dataset.collapse":
      if (id) datasets.collapse(id);
      return;
    case "model.enter":
      if (id) models.enter(id);
      return;
    case "model.detail":
      if (id) models.detail(id);
      return;
    case "selection.model":
      models.group(target.ids || []);
      return;
    case "canvas.write":
      worksheet.write(
        o.menu
          ? { x: o.menu.world.x, y: o.menu.world.y + (o.menu.target ? 110 : 0) }
          : o.writingPoint(),
      );
      return;
    case "model.author":
      if (models.beforeCreate())
        models.author(
          modelSource(session.state, models.selected),
          o.writingPoint(),
        );
      return;
    case "model.spring":
    case "model.scale": {
      if (!models.beforeCreate()) return;
      const desired = o.menu?.world || o.writingPoint();
      const at = models.views.some(
        (v) =>
          Math.abs(v.x - desired.x) < 430 && Math.abs(v.y - desired.y) < 500,
      )
        ? { x: Math.max(...models.views.map((v) => v.x)) + 450, y: desired.y }
        : desired;
      const instance = insertModel(
        session,
        command.operation === "model.spring" ? "spring" : "scale",
        at,
      );
      requestAnimationFrame(() => o.reveal(instance + ":view"));
      return;
    }
    case "canvas.stack":
      session.stack();
      return;
    case "canvas.evaluate":
      session.evaluate();
      return;
    default:
      return o.shell[command.operation]();
  }
}
