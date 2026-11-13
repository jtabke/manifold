import { Search, X } from "lucide-react";
import type { Page } from "../document";
import { project } from "../document";
import { modelPath } from "../models";
import {
  commandSubject,
  type CanvasCommand,
  type CommandContext,
} from "../interaction/commands";
import { concepts } from "./paletteConcepts";

type Props = {
  palette: "slash" | "search";
  query: string;
  setQuery: (query: string) => void;
  setPalette: (mode: "slash" | "search" | undefined) => void;
  addConcept: (name: string) => void;
  requestedConnection?: CanvasCommand;
  requestedPlot?: CanvasCommand;
  selectedContext: CommandContext;
  scopeLabel: string;
  page: Page;
  p: ReturnType<typeof project>;
  paletteCommands: CanvasCommand[];
  recentCommands: string[];
  executeCommand: (command: CanvasCommand) => void;
  enterModel: (id: string) => void;
  revealRegion: (id: string) => void;
  regionOwner: (id: string) => string | undefined;
};
export function CommandPalette({
  palette,
  query,
  setQuery,
  setPalette,
  addConcept,
  requestedConnection,
  requestedPlot,
  selectedContext,
  scopeLabel,
  page,
  p,
  paletteCommands,
  recentCommands,
  executeCommand,
  enterModel,
  revealRegion,
  regionOwner,
}: Props) {
  const commandItem = (command: CanvasCommand) => (
    <button
      className="er-command-item"
      key={command.key}
      aria-label={command.label}
      data-command-id={command.id}
      data-command-key={command.key}
      disabled={!!command.unavailable}
      title={`${command.preview} · ${command.undo.description}`}
      onClick={() => executeCommand(command)}
    >
      <b>{command.label}</b>
      <span>
        {command.unavailable ||
          (recentCommands.includes(command.key) ? "Recently used · " : "") +
            command.preview}
      </span>
    </button>
  );

  return (
    <div className="er-scrim" onMouseDown={() => setPalette(undefined)}>
      <section
        className="er-palette"
        aria-label={
          palette === "slash" ? "Add to canvas" : "Objects and commands"
        }
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (
            !["ArrowUp", "ArrowDown"].includes(e.key) ||
            e.nativeEvent.isComposing ||
            e.keyCode === 229
          )
            return;
          const items = [
            ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
              ".er-command-item:not(:disabled)",
            ),
          ];
          if (!items.length) return;
          e.preventDefault();
          e.stopPropagation();
          const active = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            active === -1
              ? e.key === "ArrowDown"
                ? 0
                : items.length - 1
              : (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
          items[next].focus();
        }}
      >
        <header>
          <Search size={16} />
          <input
            aria-label="Search commands"
            autoFocus
            placeholder={
              palette === "slash"
                ? "Write, import, or plot…"
                : "Find a quantity or action…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Escape") {
                e.stopPropagation();
                setPalette(undefined);
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const first = e.currentTarget
                  .closest("section")
                  ?.querySelector<HTMLButtonElement>(
                    ".er-command-item:not(:disabled)",
                  );
                first?.click();
              }
            }}
          />
          <button
            aria-label="Close commands"
            onClick={() => setPalette(undefined)}
          >
            <X size={15} />
          </button>
        </header>
        {palette === "slash" ? (
          <>
            <small className="er-palette-caption">Add to canvas</small>
            {concepts
              .filter(([name]) =>
                ["Equation", "Note", "Data", "Plot"].includes(name),
              )
              .filter(([name, description]) =>
                (name + description)
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map(([name, description]) => (
                <button
                  className="er-command-item"
                  key={name}
                  onClick={() => {
                    setPalette(undefined);
                    addConcept(name);
                  }}
                >
                  <b>{name}</b>
                  <span>{description}</span>
                </button>
              ))}
          </>
        ) : (
          <>
            {requestedConnection && commandItem(requestedConnection)}
            {requestedPlot && commandItem(requestedPlot)}
            <p className="er-command-context" aria-label="Command context">
              {commandSubject(selectedContext)} · {scopeLabel} ·{" "}
              {
                page.contexts.find((context) => context.id === page.active)
                  ?.label
              }
            </p>
            {paletteCommands.map(commandItem)}
            {(page.models || [])
              .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
              .map((m) => (
                <button
                  className="er-command-item"
                  key={m.id}
                  onClick={() => {
                    setPalette(undefined);
                    enterModel(m.id);
                  }}
                >
                  <b>{m.name}</b>
                  <span>Model · {m.members.length} objects</span>
                </button>
              ))}
            {page.regions
              .filter(
                (r) =>
                  `${p.statements.get(r.id)?.name || ""} ${r.label || ""} ${r.data?.name || ""} ${r.text}`
                    .toLowerCase()
                    .includes(query.toLowerCase()) && r.text,
              )
              .map((r) => (
                <button
                  className="er-command-item"
                  key={r.id}
                  onClick={() => {
                    setPalette(undefined);
                    revealRegion(r.id);
                  }}
                >
                  <b>{p.statements.get(r.id)?.name || "Thought"}</b>
                  <span>
                    {p.texts[r.id]}
                    {regionOwner(r.id) &&
                      ` · ${modelPath(page, regionOwner(r.id))
                        .map((m) => m.name)
                        .join(" / ")}`}
                  </span>
                </button>
              ))}
          </>
        )}
      </section>
    </div>
  );
}
