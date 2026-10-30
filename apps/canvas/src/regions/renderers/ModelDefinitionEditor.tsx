import { useEffect, useRef, useState, useId } from "react";
import type { RegionSession, Point } from "../document";
import { parse, quantityLiteral } from "../../notebook/math";
import { compileModel, type ModelSource } from "../authoredModels";
import {
  publishModel,
  instantiateModel,
  modelReference,
} from "../modelCommands";
import { useEditBuffer } from "../app/useEditBuffer";
import type { EditBuffers } from "../app/workspaceFiles";
import "../styles/independentModels.css";
export function ModelDefinitionEditor({
  session,
  buffers,
  initial,
  definition,
  at,
  close,
  published,
}: {
  session: RegionSession;
  buffers: EditBuffers;
  initial: { label: string; source: ModelSource };
  definition?: string;
  at: Point;
  close: () => void;
  published: (instance?: string) => void;
}) {
  const bufferId = useId();
  const dialog = useRef<HTMLDialogElement>(null),
    [expected] = useState(session.document);
  const [label, setLabel] = useState(initial.label),
    [source, setSource] = useState(initial.source),
    [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      previous?.focus();
    };
  }, []);
  useEditBuffer(buffers, bufferId, {
    read: () => JSON.stringify({ label, source }),
    finish: () => {
      setError(
        "Publish this definition or cancel editing before changing files.",
      );
      return false;
    },
  });
  const save = () => {
    try {
      if (session.document !== expected)
        throw Error(
          "Work changed since this editor opened. Cancel and reopen the definition before publishing.",
        );
      compileModel(source);
      const instance = session.atomic((staged) => {
        const item = publishModel(staged, label, source, definition);
        return definition
          ? undefined
          : instantiateModel(staged, modelReference(staged.document, item), at);
      });
      published(instance);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const toggle = (kind: "inputs" | "outputs", id: string) =>
    setSource((s) => ({
      ...s,
      [kind]: s[kind].includes(id)
        ? s[kind].filter((v) => v !== id)
        : [...s[kind], id],
    }));
  return (
    <dialog
      className="im-editor"
      ref={dialog}
      aria-labelledby="model-editor-title"
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id="model-editor-title">
          {definition ? "Revise model definition" : "Create reusable model"}
        </h2>
        <button onClick={close}>Cancel model editing</button>
      </header>
      <label>
        Model name
        <input
          autoFocus
          aria-label="Model name"
          value={label}
          maxLength={160}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <p>
        Write named equations. Expose literal assignments as inputs and select
        outputs. Instances keep their pinned revision until you review an
        update.
      </p>
      {source.rows.map((row, index) => {
        let name = `Equation ${index + 1}`,
          literal = false;
        try {
          const s = parse(row.text);
          name = s.name;
          literal = quantityLiteral(s.expression);
        } catch {
          /* Unfinished work stays in the editor. */
        }
        return (
          <fieldset key={row.id}>
            <legend>{name}</legend>
            <label>
              Equation
              <input
                aria-label={`Model equation ${index + 1}`}
                value={row.text}
                maxLength={1200}
                onChange={(e) =>
                  setSource((s) => ({
                    ...s,
                    rows: s.rows.map((r) =>
                      r.id === row.id ? { ...r, text: e.target.value } : r,
                    ),
                  }))
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                aria-label={`Expose ${name} input`}
                disabled={!literal && !source.inputs.includes(row.id)}
                checked={source.inputs.includes(row.id)}
                onChange={() => toggle("inputs", row.id)}
              />
              Input (literal assignment)
            </label>
            <label>
              <input
                type="checkbox"
                aria-label={`Expose ${name} output`}
                checked={source.outputs.includes(row.id)}
                onChange={() => toggle("outputs", row.id)}
              />
              Output
            </label>
            <button
              onClick={() =>
                setSource((s) => ({
                  rows: s.rows.filter((r) => r.id !== row.id),
                  inputs: s.inputs.filter((id) => id !== row.id),
                  outputs: s.outputs.filter((id) => id !== row.id),
                }))
              }
            >
              Remove {name}
            </button>
          </fieldset>
        );
      })}
      <button
        disabled={source.rows.length >= 32}
        onClick={() =>
          setSource((s) => ({
            ...s,
            rows: [
              ...s.rows,
              { id: "equation-" + crypto.randomUUID(), text: "" },
            ],
          }))
        }
      >
        Add model equation
      </button>
      <button onClick={save}>
        {definition ? "Publish model revision" : "Publish and insert model"}
      </button>
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
