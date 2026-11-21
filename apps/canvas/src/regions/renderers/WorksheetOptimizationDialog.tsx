import { useEffect, useId, useRef, useState } from "react";
import { project, type RegionSession } from "../document";
import {
  designChoices,
  defaultAxis,
  type DesignRange,
  type DesignSpec,
} from "../worksheetOptimization";
import type { EditBuffers } from "../app/workspaceFiles";
import { useEditBuffer } from "../app/useEditBuffer";
import {
  DesignCandidate,
  DesignFields,
  useWorksheetDesignRun,
} from "./WorksheetDesignControls";
import { WorksheetFeasibility } from "./WorksheetFeasibility";
import "../styles/worksheetOptimization.css";

export function WorksheetOptimizationDialog({
  session,
  goal,
  buffers,
  close,
  notify,
  onPlot,
}: {
  session: RegionSession;
  goal: string;
  buffers: EditBuffers;
  close: () => void;
  notify: (message: string) => void;
  onPlot: (spec: DesignSpec) => void;
}) {
  const [opened] = useState(() => ({
    document: session.document,
    choices: designChoices(session.state, goal),
    name: project(session.state).statements.get(goal)!.name,
  }));
  const [spec, setSpec] = useState<DesignSpec>(() => ({
    goal,
    mode: "minimize",
    axes: opened.choices.inputs[0]
      ? [defaultAxis(opened.choices.inputs[0])]
      : [],
    requirements: opened.choices.requirements
      .filter((r) => !r.error)
      .map((r) => r.id),
    reports: [],
  }));
  const [range, setRange] = useState<DesignRange>();
  const search = useWorksheetDesignRun(session, notify);
  const dialog = useRef<HTMLDialogElement>(null),
    outcome = useRef<HTMLHeadingElement>(null),
    id = useId();
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null,
      node = dialog.current!;
    node.showModal();
    node.querySelector("select")?.focus();
    return () => {
      node.close();
      if (prior?.isConnected) prior.focus();
    };
  }, []);
  useEffect(() => {
    if (search.review) {
      outcome.current?.focus({ preventScroll: true });
      if (dialog.current) dialog.current.scrollTop = 0;
    }
  }, [search.review]);
  useEffect(() => {
    if (range)
      dialog.current
        ?.querySelector<HTMLElement>(".design-feasibility h3")
        ?.focus();
  }, [range]);
  useEditBuffer(buffers, id, {
    read: () => JSON.stringify(spec),
    finish: () => {
      search.setError("Close the design review before changing files.");
      return false;
    },
  });
  const stale = session.document !== opened.document;
  function change(next: Partial<DesignSpec>) {
    setRange(undefined);
    search.clear();
    setSpec({ ...spec, ...next });
  }
  function scan() {
    search.setError("");
    try {
      setRange(session.scanWorksheetDesign(spec));
    } catch (e) {
      setRange(undefined);
      search.setError((e as Error).message);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="worksheet-optimization"
      aria-labelledby={id}
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={id}>Optimize {opened.name}</h2>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      {search.review && !stale && (
        <DesignCandidate
          review={search.review}
          heading={outcome}
          adopt={(alternative) => {
            if (search.adopt(alternative)) close();
          }}
        />
      )}
      {range && !stale && <WorksheetFeasibility range={range} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!stale) void search.run(spec);
        }}
      >
        <DesignFields
          choices={opened.choices}
          name={opened.name}
          spec={spec}
          change={change}
          disabled={search.running || stale}
        />
        <button
          className="design-primary"
          type="submit"
          disabled={search.running || stale || !spec.axes.length}
        >
          Run
        </button>
        {spec.axes.length === 1 && (
          <button
            type="button"
            onClick={scan}
            disabled={search.running || stale}
          >
            Scan range
          </button>
        )}
        {spec.axes.length === 2 && (
          <button
            type="button"
            onClick={() => {
              try {
                onPlot(spec);
                close();
              } catch (e) {
                search.setError((e as Error).message);
              }
            }}
            disabled={search.running || stale}
          >
            Plot on canvas
          </button>
        )}
        {search.running && (
          <>
            <span role="status">Searching…</span>
            <button type="button" onClick={search.cancel}>
              Cancel run
            </button>
          </>
        )}
      </form>
      {stale && (
        <p role="alert">Worksheet changed. Close and reopen Optimize.</p>
      )}
      {search.error && <p role="alert">{search.error}</p>}
    </dialog>
  );
}
