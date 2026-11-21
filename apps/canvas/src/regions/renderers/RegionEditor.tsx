import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { display } from "../../notebook/math";
import { noteReferences, noteToken, freeNoteAlias } from "../noteReferences";
import { worksheetReadout } from "../worksheetReadout";
import { mathematical } from "../worksheetProjection";
import { type Page, project } from "../document";
import { sourceSpans } from "../editing";
import { quantityDescription } from "../linking";
import { revealCanvasElement } from "../interaction/canvasViewport";

export type RegionEditorDraft = {
  text: string;
  links: Record<string, string>;
  selection?: { start: number; end: number };
  revision: number;
};

/** A live input buffer, not a second document owner. Commit/file guards read it
 * synchronously; keystrokes and reference-menu navigation render only here. */
export function RegionEditor({
  id,
  buffer,
  page,
  accepted,
  editor,
  skipBlur,
  commit,
  paletteOpen,
}: {
  id: string;
  buffer: RegionEditorDraft;
  page: Page;
  accepted: ReturnType<typeof project>;
  editor: RefObject<HTMLTextAreaElement | null>;
  skipBlur: RefObject<boolean>;
  commit: (continuation?: boolean) => boolean;
  paletteOpen: (mode: "search" | "slash") => void;
}) {
  const [draft, updateDraft] = useState(buffer.text),
    [selectionSpan, setSelectionSpan] = useState(buffer.selection),
    [caret, setCaret] = useState(buffer.selection?.start ?? buffer.text.length),
    [mentionIndex, setMentionIndex] = useState(0),
    [mentionDismissed, setMentionDismissed] = useState(false);
  const draftLinks = buffer.links;
  const setDraft = (value: string) => {
    buffer.text = value;
    updateDraft(value);
  };
  const setDraftLinks = (
    update: (links: Record<string, string>) => Record<string, string>,
  ) => {
    buffer.links = update(buffer.links);
  };
  useEffect(() => {
    const node = editor.current;
    node?.focus();
    const end = node?.value.length || 0;
    node?.setSelectionRange(
      selectionSpan?.start ?? end,
      selectionSpan?.end ?? end,
    );
  }, [editor, selectionSpan]);
  useLayoutEffect(() => {
    revealCanvasElement(editor.current, {
      block: "nearest",
      inline: "nearest",
    });
  }, [editor, draft, selectionSpan]);
  const mention = !mentionDismissed
    ? /@([A-Za-z_0-9 ]*)$/.exec(draft.slice(0, caret))
    : null;
  const prose = !mathematical(
    mention
      ? draft.slice(0, caret - mention[0].length) + "x" + draft.slice(caret)
      : draft,
    page.regions.find((r) => r.id === id)?.mathVersion ?? 1,
  );
  const atReference =
    !mention && prose && Object.keys(draftLinks).length
      ? noteReferences(draft, draftLinks).find(
          (r) => r.start <= caret && caret <= r.end,
        )
      : undefined;
  const atReading = atReference && worksheetReadout(accepted, atReference.id);
  const mentionCandidates = mention
    ? page.regions
        .filter((r) => {
          const s = accepted.statements.get(r.id);
          if (r.id === id) return false;
          if (prose && s && s.relation !== "=")
            return ("requirement " + accepted.texts[r.id])
              .toLowerCase()
              .includes(mention[1].toLowerCase().trim());
          if (r.data && prose)
            return r.data.name
              .toLowerCase()
              .includes(mention[1].toLowerCase().trim());
          return (
            s?.relation === "=" &&
            accepted.sources[s.name]?.length === 1 &&
            !accepted.errors.has(r.id) &&
            accepted.solved.values.has(s.name) &&
            (s.anonymous && prose
              ? `expression ${accepted.texts[r.id]}`
              : `${s.name} ${quantityDescription(s.name)}`
            )
              .toLowerCase()
              .includes(mention[1].toLowerCase().trim())
          );
        })
        .slice(0, 8)
    : [];
  useEffect(() => setMentionIndex(0), [mention?.[1]]);
  const replaceText = (start: number, end: number, token: string) => {
    const next = start + token.length;
    setDraft(draft.slice(0, start) + token + draft.slice(end));
    setCaret(next);
    setSelectionSpan({ start: next, end: next });
    setMentionDismissed(false);
  };
  const changeReference = () => {
    if (atReference && atReading)
      replaceText(
        atReference.start,
        atReference.end,
        noteToken(
          atReference.alias,
          atReference.mode === "name" ? atReading.kind : "name",
        ),
      );
  };
  const insertReference = (source: string, live = false) => {
    if (!mention) return;
    const evidence = page.regions.find((r) => r.id === source)?.data;
    const reading = worksheetReadout(accepted, source);
    const base =
      reading?.kind === "status"
        ? reading.name + "_check"
        : prose && accepted.statements.get(source)?.anonymous
          ? "result"
          : accepted.statements.get(source)?.name ||
            `data_${(evidence?.name || "source").replace(/\.csv$/i, "").replace(/[^A-Za-z_0-9]/g, "_")}`;
    const name = prose ? freeNoteAlias(base, source, draftLinks) : base;
    const mode =
      prose && reading && (live || reading.kind === "status")
        ? reading.kind
        : "name";
    replaceText(caret - mention[0].length, caret, noteToken(name, mode));
    setDraftLinks((bindings) => ({ ...bindings, [name]: source }));
  };
  const highlighted = mentionCandidates[mentionIndex];
  const canInsertValue =
    prose &&
    highlighted &&
    accepted.statements.get(highlighted.id)?.relation === "=";

  return (
    <>
      <textarea
        ref={editor}
        aria-label="Write an engineering region"
        value={draft}
        spellCheck={false}
        rows={Math.max(1, draft.split("\n").length)}
        onChange={(e) => {
          setDraft(e.target.value);
          setCaret(e.target.selectionStart);
          setMentionDismissed(false);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        aria-autocomplete="list"
        aria-describedby="er-writing-help"
        aria-controls={mention ? "er-reference-options" : undefined}
        aria-activedescendant={
          mentionCandidates[mentionIndex]
            ? `er-reference-${mentionCandidates[mentionIndex].id}`
            : undefined
        }
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          // Let the input method finish its text before treating
          // Enter, Escape or arrows as canvas commands.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.altKey && e.key === "Enter" && (canInsertValue || atReading)) {
            e.preventDefault();
            if (canInsertValue) insertReference(highlighted.id, true);
            else changeReference();
            return;
          }
          if (
            mention &&
            (e.key === "Escape" ||
              (mentionCandidates.length > 0 &&
                !e.shiftKey &&
                ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)))
          ) {
            e.preventDefault();
            if (e.key === "Escape") setMentionDismissed(true);
            else if (e.key === "ArrowDown" || e.key === "ArrowUp")
              setMentionIndex(
                (i) =>
                  (i +
                    (e.key === "ArrowDown" ? 1 : -1) +
                    Math.max(1, mentionCandidates.length)) %
                  Math.max(1, mentionCandidates.length),
              );
            else if (mentionCandidates[mentionIndex])
              insertReference(mentionCandidates[mentionIndex].id);
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            paletteOpen("search");
            return;
          }
          if (e.key === "/" && !draft.trim()) {
            e.preventDefault();
            paletteOpen("slash");
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            skipBlur.current = true;
            commit(true);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            skipBlur.current = true;
            commit();
            return;
          }
          if (e.key === "Tab") {
            const spans = sourceSpans(draft),
              cursor = e.currentTarget.selectionEnd;
            const next = e.shiftKey
              ? [...spans]
                  .reverse()
                  .find((span) => span.end < e.currentTarget.selectionStart)
              : spans.find(
                  (span) => span.start >= cursor && span.end !== cursor,
                );
            if (next) {
              e.preventDefault();
              e.currentTarget.setSelectionRange(next.start, next.end);
            } else if (!e.shiftKey) {
              e.preventDefault();
              skipBlur.current = true;
              commit(true);
            }
          }
        }}
      />
      <small id="er-writing-help" className="er-writing-help">
        {mention && mentionCandidates.length
          ? "↑↓ Choose · Enter Insert reference · Esc Dismiss · Shift+Enter New line"
          : "Enter Continue below · Esc Finish · Shift+Enter New line · @ Reference"}
      </small>
      {mention && (
        <div
          className="er-reference-menu"
          onPointerDown={(e) => e.preventDefault()}
        >
          <div
            id="er-reference-options"
            role="listbox"
            aria-label="Reference an object"
          >
            {mentionCandidates.map((candidate, index) => {
              const definition = accepted.statements.get(candidate.id),
                value =
                  definition?.relation === "=" &&
                  accepted.solved.values.get(definition.name),
                requirement = definition && definition.relation !== "=";
              return (
                <button
                  id={`er-reference-${candidate.id}`}
                  key={candidate.id}
                  role="option"
                  aria-selected={index === mentionIndex}
                  onClick={() => insertReference(candidate.id)}
                >
                  <strong>
                    {requirement || (prose && definition?.anonymous)
                      ? accepted.texts[candidate.id]
                      : definition?.name || candidate.data?.name}
                  </strong>
                  <span>
                    {requirement
                      ? "Show status"
                      : definition
                        ? prose
                          ? accepted.kinds[candidate.id] === "quantity"
                            ? "Assigned value"
                            : "Calculated value"
                          : quantityDescription(definition.name)
                        : "Evidence reference"}
                  </span>
                  <small>
                    {value
                      ? display(value)
                      : candidate.data
                        ? "Not a calculation input"
                        : ""}
                  </small>
                </button>
              );
            })}
            {!mentionCandidates.length && (
              <small role="status">
                No matching resolved quantities. Keep writing or press Esc to
                dismiss.
              </small>
            )}
          </div>
          {canInsertValue && (
            <button
              type="button"
              className="er-note-format"
              onClick={() => insertReference(highlighted.id, true)}
            >
              Show value of{" "}
              {accepted.statements.get(highlighted.id)?.anonymous
                ? accepted.texts[highlighted.id]
                : accepted.statements.get(highlighted.id)?.name}{" "}
              <small>Alt+Enter</small>
            </button>
          )}
        </div>
      )}
      {atReference && atReading && (
        <div
          className="er-reference-menu"
          onPointerDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="er-note-format"
            onClick={changeReference}
          >
            {atReference.mode === "name"
              ? atReading.kind === "status"
                ? "Show status"
                : "Show value"
              : "Show name"}{" "}
            <small>Alt+Enter</small>
          </button>
        </div>
      )}
    </>
  );
}
