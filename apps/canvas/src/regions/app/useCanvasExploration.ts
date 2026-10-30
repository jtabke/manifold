/** View-local worksheet exploration. Accepted writes/Keep/Undo remain owned by the session. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Quantity } from "../../notebook/math";
import { ancestors, project, type Page, type RegionSession } from "../document";
import {
  proposeValue,
  isCurrentExploration,
  previewPage,
  responseFor,
  boundedValue,
  variationRange,
  type Exploration,
  type VariationRange,
} from "../exploration";
import type { Scrub } from "../renderers/Interactions";

type Options = {
  session: RegionSession;
  page: Page;
  accepted: ReturnType<typeof project>;
  explicit: boolean;
  scrubEnabled: boolean;
  select: (id: string) => void;
  message: (text: string) => void;
  compare: (value: { context: string; output: string; input?: string }) => void;
};

export function useCanvasExploration({
  session,
  page,
  accepted,
  explicit,
  scrubEnabled,
  select,
  message,
  compare,
}: Options) {
  const [exploration, setExploration] = useState<Exploration>();
  const [variation, setVariation] = useState<{
    input: string;
    range: VariationRange;
  }>();
  const proposalRef = useRef<Exploration | undefined>(undefined);
  const previewAnchor = useRef<Element | undefined>(undefined);
  const [gestureActive, setGestureActive] = useState(false);
  const [lastEdit, setLastEdit] = useState<{
    page: typeof page;
    before: typeof page;
    previous: Quantity;
    input: string;
    anchor?: Element;
  }>();
  useEffect(() => {
    proposalRef.current = exploration;
  }, [exploration]);
  const working = useMemo(
    () => previewPage(page, exploration),
    [page, exploration],
  );
  const p = useMemo(() => project(working), [working]);
  const immediate = !explicit && !variation;
  function revertExploration() {
    proposalRef.current = undefined;
    setExploration(undefined);
    setGestureActive(false);
    setVariation(undefined);
  }
  useEffect(() => {
    if (exploration && !isCurrentExploration(page, exploration)) {
      revertExploration();
    }
  }, [page, exploration]);
  const exploreValue = (id: string, value: number, anchor?: Element) => {
    try {
      if (session.foundation.preview()) session.cancelPreview();
      if (variation) {
        const statement = accepted.statements.get(id);
        const quantity =
          statement && accepted.solved.values.get(statement.name);
        if (!quantity)
          throw Error("Choose a resolved assigned quantity to explore.");
        const range =
          variation.input === id ? variation.range : variationRange(quantity);
        if (variation.input !== id) setVariation({ input: id, range });
        value = boundedValue(value, range);
      }
      const proposal = proposeValue(page, id, value);
      proposalRef.current = proposal;
      if (anchor) previewAnchor.current = anchor;
      setGestureActive(true);
      setLastEdit(undefined);
      select(id);
      setExploration(proposal);
      message("");
    } catch (e) {
      message((e as Error).message);
    }
  };
  const startVariation = (id: string, anchor?: Element) => {
    if (variation?.input === id && exploration) return;
    const statement = accepted.statements.get(id);
    const quantity = statement && accepted.solved.values.get(statement.name);
    if (
      !quantity ||
      accepted.kinds[id] !== "quantity" ||
      accepted.errors.has(id)
    )
      return;
    previewAnchor.current = anchor;
    setVariation({ input: id, range: variationRange(quantity) });
    exploreValue(id, quantity.value, anchor);
    setGestureActive(false);
  };
  const scrubFor = (id: string): Scrub | undefined => {
    const s = p.statements.get(id),
      q = s && p.solved.values.get(s.name);
    if (!scrubEnabled || !q || p.kinds[id] !== "quantity" || p.errors.has(id))
      return;
    return {
      quantity: q,
      range: variation?.input === id ? variation.range : undefined,
      explore: (value, anchor) => exploreValue(id, value, anchor),
      finish: finishValue,
      revert: revertExploration,
    };
  };
  const applyProposal = (proposal?: Exploration) => {
    if (!isCurrentExploration(page, proposal)) {
      revertExploration();
      return;
    }
    const projection = project(previewPage(page, proposal));
    const invalid = [...projection.errors].some(
      ([id]) =>
        id === proposal.input ||
        ancestors(projection, id).includes(proposal.input),
    );
    if (invalid) {
      if (immediate) {
        revertExploration();
        message("Undefined result. The value was restored.");
      }
      return;
    }
    const name = accepted.statements.get(proposal.input)?.name;
    const previous = name && accepted.solved.values.get(name);
    const result = session.write(proposal.input, proposal.text);
    if (result.ok) {
      if (previous)
        setLastEdit({
          page: session.state,
          before: page,
          previous,
          input: proposal.input,
          anchor: previewAnchor.current,
        });
      revertExploration();
    } else {
      revertExploration();
      message(result.error || "Could not change this value.");
    }
  };
  function finishValue() {
    setGestureActive(false);
    if (immediate) applyProposal(proposalRef.current);
  }
  const acceptExploration = () => applyProposal(exploration);
  const keepExploration = () => {
    if (!isCurrentExploration(page, exploration)) {
      revertExploration();
      return;
    }
    try {
      const input = exploration.input;
      const context = session.keepAlternative(
        input,
        exploration.text,
        exploration,
      );
      const output = responseFor(page, input)?.output;
      if (output) compare({ context, output, input });
      revertExploration();
      setLastEdit(undefined);
      message(
        "Alternative preserved. The baseline is unchanged; switch scenarios to compare.",
      );
    } catch (e) {
      message((e as Error).message);
    }
  };
  const setInput = (id: string, value: number, anchor?: Element) => {
    if (scrubEnabled) exploreValue(id, value, anchor);
    else {
      try {
        const proposal = proposeValue(page, id, value);
        const result = session.write(id, proposal.text);
        if (!result.ok) message(result.error || "Could not change this input.");
      } catch (e) {
        message((e as Error).message);
      }
    }
  };

  return {
    exploration,
    variation,
    gestureActive,
    lastEdit,
    working,
    p,
    anchor: previewAnchor.current,
    revertExploration,
    exploreValue,
    startVariation,
    scrubFor,
    finishValue,
    acceptExploration,
    keepExploration,
    setInput,
    clearRecovery: () => setLastEdit(undefined),
    changeRange: (range: VariationRange) => {
      if (variation) setVariation({ ...variation, range });
    },
  };
}
