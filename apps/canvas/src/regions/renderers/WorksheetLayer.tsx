import { useMemo, type ReactNode } from "react";
import {
  Check,
  GripVertical,
  Link2,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import { display, quantityLiteral, references } from "../../notebook/math";
import { ancestors, type Page, type Point, type Projection } from "../document";
import type { DataSelection } from "../dataFeedback";
import type { DatasetComputation, DatasetStates } from "../datasetModel";
import { matchesMeasurementText } from "../dataSources";
import type { Scrub } from "../interaction/useNumberScrub";
import {
  commandSubject,
  resolveCommands,
  toolbarCommands,
  type CanvasCommand,
  type CommandContext,
  type CommandRequest,
} from "../interaction/commands";
import { revealCanvasElement } from "../interaction/canvasViewport";
import { RegionCommandMenu } from "./RegionCommandMenu";
import { ExternalReferenceView } from "./ExternalReferenceView";
import { DataRegion } from "./DataRegion";
import { MathLine } from "./MathLine";
import { RecordFeedback } from "./DatasetViews";
import { ReferencedNote } from "./ReferencedNote";

type SheetCommands = {
  enabled: boolean;
  contextFor: (id: string) => CommandContext;
  dispatch: (command: CommandRequest) => void;
  execute: (command: CanvasCommand) => void;
  more: (x: number, y: number, id: string) => void;
};

function WorksheetCommands({
  context,
  quiet,
  maxWidth,
  dispatch,
  execute,
  more,
}: Pick<SheetCommands, "dispatch" | "execute"> & {
  context: CommandContext;
  quiet: boolean;
  maxWidth: number;
  more: (x: number, y: number) => void;
}) {
  const kind = context.target.kind,
    subject = commandSubject(context);
  return (
    <RegionCommandMenu key={JSON.stringify(context.target)}>
      {() => (
        <div
          className={quiet ? "er-object-actions" : "er-region-actions"}
          style={{ maxWidth }}
          role="toolbar"
          aria-label={`${subject} actions`}
          data-selection-kind={kind}
        >
          <span className="er-command-selection">{subject}</span>
          {toolbarCommands(resolveCommands(context, dispatch), kind).map(
            (command) => (
              <button
                key={command.key}
                data-command-id={command.id}
                data-command-key={command.key}
                disabled={!!command.unavailable}
                title={command.unavailable || command.preview}
                onClick={(event) => {
                  event.stopPropagation();
                  execute(command);
                }}
              >
                {command.toolbarLabel}
              </button>
            ),
          )}
          <button
            aria-label="More region actions"
            title="All actions"
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              more(rect.left, rect.bottom);
            }}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
      )}
    </RegionCommandMenu>
  );
}

type SheetData = {
  states: DatasetStates;
  selection?: DataSelection;
  relatedIds: ReadonlySet<string>;
  symbols: Set<string>;
  hover?: string;
  selectedQuantity?: string;
  collapsed: readonly string[];
  toggle: (id: string) => void;
  choose: (s: DataSelection) => void;
  review: (id: string, columns: number[], rows: number[]) => void;
  show: (id: string) => void;
  selectQuantity: (id: string) => void;
  define: (
    dataset: string,
    row: number,
    column: number,
    name: string,
    unit: string,
    at: Point,
  ) => void;
  clear: () => void;
  follow: (relation: DatasetComputation, row: number) => void;
};
type SheetProps = {
  page: Page;
  projection: Projection;
  original?: Projection;
  sources: Projection["sources"];
  version: unknown;
  places: Readonly<Record<string, Point>>;
  visible: (id: string) => boolean;
  attention: {
    selected?: string;
    active?: string;
    expanded?: string;
    focusedInput?: string;
    previewInput?: string;
    inspected: readonly string[];
    overlay: "none" | "dependencies" | "requirements";
    related: ReadonlySet<string>;
    quiet: boolean;
    compare: boolean;
    directEdit: boolean;
    scrubHint: boolean;
    maxWidth: number;
  };
  math: {
    scrubFor: (id: string) => Scrub | undefined;
    highlight?: string;
    expressionTarget?: string;
    resultTarget?: string;
    requirementTarget?: string;
  };
  editor: {
    id?: string;
    render: (id: string) => ReactNode;
    begin: (id: string, span?: { start: number; end: number }) => void;
    editReference: (id: string) => void;
    defineMissing: (name: string) => void;
  };
  actions: {
    select: (id: string, shift: boolean, clearDetail: boolean) => void;
    inspectConnections: (id: string) => void;
    closeRelationship: () => void;
    inspectSymbol: (source: string) => boolean | void;
    chooseTerm: (id: string, name: string) => void;
    inspectResult: (id: string, name: string) => void;
    navigateLink: (id: string) => void;
    revealSource: (id: string) => void;
  };
  data: SheetData;
  commands: SheetCommands;
};

const measurementCaption = (
  text: string,
  name: string,
  source: { raw: string; unit: string },
) => {
  try {
    return matchesMeasurementText(text, name, source.raw, source.unit)
      ? "Imported measurement"
      : "Edited assumption";
  } catch {
    // Older files may retain a units field accepted before strict unit validation.
    return "Source units need review";
  }
};

/** Render worksheet records and transient attention. Only the application intents below can edit work. */
export function WorksheetLayer({
  page,
  projection: p,
  original,
  sources,
  version,
  places,
  visible,
  attention,
  math,
  editor,
  actions,
  data,
  commands,
}: SheetProps) {
  const {
    selected,
    active: selectedId,
    expanded: expansionId,
    focusedInput,
    overlay,
    related,
    quiet,
    compare,
    maxWidth,
  } = attention;
  const {
    states: datasetStates,
    selection: activeData,
    relatedIds: dataRelatedIds,
    symbols: dataSymbols,
  } = data;
  const editing = editor.id,
    { scrubFor } = math,
    context = page.contexts.find((c) => c.id === page.active);
  const labels = useMemo(
    () =>
      Object.fromEntries(
        page.regions.map((r) => [
          r.id,
          r.data?.name ||
            p.statements.get(r.id)?.name ||
            "Unavailable reference",
        ]),
      ),
    [page.regions, p.statements],
  );
  const firstRelationByDataset = useMemo(() => {
    const index = new Map<string, DatasetComputation>();
    for (const r of page.dataRelations ?? [])
      if (!index.has(r.dataset)) index.set(r.dataset, r);
    return index;
  }, [page.dataRelations]);
  return page.regions.map((region) => {
    const id = region.id,
      at = places[id],
      s = p.statements.get(id),
      dataRelation = (page.dataRelations || []).find(
        (r) =>
          r.output === id ||
          (s?.relation !== "=" && p.statements.get(r.output)?.name === s?.name),
      ),
      dataState = dataRelation ? datasetStates[dataRelation.id] : undefined,
      error =
        dataState?.result && p.errors.get(id)?.startsWith("Define ")
          ? undefined
          : p.errors.get(id),
      q = s && p.solved.values.get(s.name),
      condition = p.solved.constraints.get(id),
      other = s && original?.solved.values.get(s.name),
      kind = p.kinds[id],
      effectiveText = p.texts[id],
      previewDependent =
        !!attention.previewInput &&
        ancestors(p, id).includes(attention.previewInput);
    return (
      <section
        key={id}
        data-region-id={id}
        data-kind={kind}
        data-interaction={
          editing === id ? "editing" : selected === id ? "selected" : "idle"
        }
        className={`er-region ${editing === id ? "is-editing" : ""} ${activeData?.view === id ? "is-navigation-target" : ""} ${dataRelatedIds.has(id) || data.hover === id ? "is-data-connected" : ""} ${attention.inspected.includes(id) ? "is-connected" : ""} ${expansionId === id ? "is-investigating" : ""} ${id === attention.previewInput || previewDependent ? "er-preview-region" : ""} ${selected === id ? "is-selected" : ""} ${overlay === "dependencies" && selectedId && !related.has(id) ? "is-dimmed" : ""} ${overlay === "requirements" && kind === "constraint" ? "er-condition-focus" : ""} ${page.active !== "original" && context?.overrides[id] ? "er-overridden" : ""}`}
        style={{
          left: at.x,
          top: at.y,
          display: visible(id) ? undefined : "none",
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) =>
          actions.select(
            id,
            e.shiftKey,
            !(e.target as Element).closest("button,[role=button],math"),
          )
        }
      >
        <button
          className="er-grip"
          aria-label={`Move ${s?.name || "region"}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
        >
          <GripVertical size={16} />
        </button>
        {s && editing !== id && (
          <button
            className="er-link-handle"
            data-link-source={id}
            aria-label={`Link ${s.relation === "=" ? s.name : `requirement ${s.name}`}`}
            title="Drag to connect · click for connections"
            onClick={(e) => {
              e.stopPropagation();
              actions.inspectConnections(id);
            }}
          >
            <Link2 size={15} />
          </button>
        )}
        {selected === id &&
          editing !== id &&
          effectiveText &&
          commands.enabled && (
            <WorksheetCommands
              context={commands.contextFor(id)}
              quiet={quiet}
              maxWidth={maxWidth}
              dispatch={commands.dispatch}
              execute={commands.execute}
              more={(x, y) => commands.more(x, y, id)}
            />
          )}
        {expansionId === id && !focusedInput && (
          <button
            className="er-investigation-close"
            aria-label="Close relationship"
            onClick={actions.closeRelationship}
          >
            <X size={14} />
          </button>
        )}
        {editing === id ? (
          editor.render(id)
        ) : region.data ? (
          <DataRegion
            data={region.data}
            navigating={!!activeData?.relation}
            dataset={region.id}
            trace={
              firstRelationByDataset.has(id)
                ? () => data.show(firstRelationByDataset.get(id)!.output)
                : undefined
            }
            collapsed={data.collapsed.includes(id)}
            toggleCollapsed={() => data.toggle(id)}
            selection={activeData}
            choose={(rows, columns, kind) =>
              data.choose({
                dataset: region.id,
                rows,
                columns,
                kind,
              })
            }
            connect={(columns, rows) => data.review(id, columns, rows)}
            selected={data.selectedQuantity}
            bound={page.regions
              .filter((r) => r.source?.dataset === id)
              .map((r) => ({
                row: r.source!.row,
                column: r.source!.column,
                id: r.id,
                name: p.statements.get(r.id)?.name || r.id,
              }))}
            select={data.selectQuantity}
            define={(row, column, name, unit) =>
              data.define(id, row, column, name, unit, at)
            }
          />
        ) : region.external ? (
          <ExternalReferenceView
            name={region.label || effectiveText}
            reference={region.external}
            edit={() => editor.editReference(id)}
          />
        ) : s ? (
          <div className="er-math-line" onDoubleClick={() => editor.begin(id)}>
            <MathLine
              statement={s}
              text={effectiveText}
              inputVersion={version}
              directEdit={attention.directEdit}
              selectOnClick
              inspectSymbols={(page.dataRelations || []).some(
                (r) => r.output === id,
              )}
              linkSources={sources}
              onSymbol={(name) => {
                const r = (page.dataRelations || []).find(
                  (r) => r.output === id,
                );
                if (r) {
                  const binding = r.bindings.find(
                    (b) =>
                      (b.quantity
                        ? p.statements.get(b.quantity)?.name
                        : b.symbol) === name,
                  );
                  if (binding) {
                    data.choose({
                      dataset: r.dataset,
                      view: id,
                      rows: [],
                      columns: [binding.column],
                      kind: "series",
                    });
                    return true;
                  }
                  if (name === s.name) {
                    data.choose({
                      dataset: r.dataset,
                      view: id,
                      rows: activeData?.rows || [],
                      columns: [],
                      kind: activeData?.rows.length ? "record" : "series",
                    });
                    return true;
                  }
                }
                const source = sources[name]?.[0];
                if (source) return actions.inspectSymbol(source);
              }}
              choose={(name) => actions.chooseTerm(id, name)}
              scrub={scrubFor(id)}
              resolved={
                expansionId === id && kind === "equation" ? p : undefined
              }
              scrubSource={scrubFor}
              edit={(span) => editor.begin(id, span)}
              highlight={math.highlight}
              highlights={dataSymbols}
              highlightExpression={math.expressionTarget === id}
            />
            {dataState && kind === "equation" && (
              <button
                className="er-data-model-result"
                onClick={() => data.show(dataRelation!.id)}
              >
                {dataState.error
                  ? `Dataset blocked · ${dataState.error}`
                  : `${dataState.result!.records.length} records · calculated`}
              </button>
            )}
            {(kind === "equation" ||
              (kind === "quantity" && s && !quantityLiteral(s.expression))) &&
              q &&
              !error && (
                <button
                  className={`er-result ${math.resultTarget === id ? "is-linked" : ""}`}
                  data-result-for={s.name}
                  aria-label={`Inspect result ${s.anonymous ? "expression" : s.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.inspectResult(id, s.name);
                  }}
                >
                  {previewDependent && (
                    <small className="er-result-preview">Preview</small>
                  )}
                  = {display(q)}
                </button>
              )}
            {kind === "constraint" && dataState?.result && !condition && (
              <span className="er-data-requirement-status">
                {
                  dataState.result.records.filter((r) => r.conditions[id])
                    .length
                }
                /{dataState.result.records.length} records within limit
              </span>
            )}
            {condition && !error && (
              <span
                className={`er-condition ${condition.pass ? "is-pass" : "is-fail"} ${math.requirementTarget === id ? "is-linked" : ""}`}
                role="status"
                title="This authored mathematical condition only; not physical validation"
              >
                {condition.pass ? <Check size={14} /> : <X size={14} />}{" "}
                {previewDependent ? "Preview · " : ""}
                {condition.pass ? "Satisfied" : "Not satisfied"}
              </span>
            )}
          </div>
        ) : (
          <div
            className={`er-note ${kind === "draft" ? "er-draft" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={
              effectiveText ? `Edit thought: ${effectiveText}` : "Write here"
            }
            onDoubleClick={() => editor.begin(id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                editor.begin(id);
              }
            }}
          >
            {effectiveText ? (
              <ReferencedNote
                text={effectiveText}
                links={page.links?.[id] || {}}
                labels={labels}
                open={actions.navigateLink}
              />
            ) : (
              <span>Continue writing…</span>
            )}
          </div>
        )}
        {attention.scrubHint && kind === "quantity" && !editing && !quiet && (
          <small className="er-value-hint">
            ↔ Drag value to explore · click to type
          </small>
        )}
        {dataRelation &&
          dataState?.result &&
          activeData?.view === id &&
          ((kind === "equation" &&
            editing !== id &&
            activeData.dataset === dataRelation.dataset &&
            activeData.detail === "calculation") ||
            (kind === "constraint" && activeData.detail === "requirement")) && (
            <RecordFeedback
              page={page}
              relation={dataRelation}
              records={dataState.result.records}
              selection={activeData}
              requirement={kind === "constraint" ? id : undefined}
              clear={data.clear}
              follow={(row) => data.follow(dataRelation, row)}
            />
          )}
        {error && editing !== id && (
          <details
            className="er-region-error"
            key={error}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget))
                e.currentTarget.open = false;
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.open = false;
                e.currentTarget.querySelector("summary")?.focus();
              }
            }}
            onToggle={(e) => {
              if (e.currentTarget.open)
                revealCanvasElement(
                  e.currentTarget.querySelector(".er-region-error-details"),
                  { block: "nearest", inline: "nearest" },
                );
            }}
          >
            <summary aria-label={error} title={error}>
              !
            </summary>
            <div
              className="er-region-error-details"
              role="status"
              style={{ maxWidth }}
            >
              {error}
              {s &&
                references(s.expression)
                  .filter((name) => !p.sources[name])
                  .slice(0, 1)
                  .map((name) => (
                    <button
                      key={name}
                      onClick={() => editor.defineMissing(name)}
                    >
                      Define {name} here <Plus size={11} />
                    </button>
                  ))}
            </div>
          </details>
        )}
        {kind === "note" &&
          !region.data &&
          effectiveText &&
          editing !== id &&
          selected === id && (
            <small className="er-informal">
              Informal thought · not executable
            </small>
          )}
        {!quiet &&
          compare &&
          page.active !== "original" &&
          other &&
          s &&
          kind === "equation" &&
          !error && (
            <small className="er-comparison">
              Original {display(other)}{" "}
              <span>
                → {context?.label} {display(q)}
              </span>
            </small>
          )}
        {!quiet && compare && page.active !== "original" && condition && (
          <small className="er-comparison">
            Original{" "}
            {original?.solved.constraints.get(id)?.pass
              ? "satisfied"
              : "not satisfied"}{" "}
            <span>
              · {context?.label}{" "}
              {condition.pass ? "satisfied" : "not satisfied"}
            </span>
          </small>
        )}
        {region.source && selected === id && (
          <button
            className="er-source-caption"
            onClick={(e) => {
              e.stopPropagation();
              actions.revealSource(region.source!.dataset);
            }}
          >
            {page.regions.find((r) => r.id === region.source!.dataset)?.data
              ?.name || "Source unavailable"}{" "}
            · row {region.source.row + 1} ·{" "}
            {measurementCaption(effectiveText, s?.name || "q", region.source)}
          </button>
        )}
      </section>
    );
  });
}
