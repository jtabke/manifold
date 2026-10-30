import { useEffect, useRef, useState } from "react";
import {
  Box,
  Clock3,
  Layers3,
  Fan,
  Battery,
  Scale,
  Workflow,
  X,
  MoreHorizontal,
} from "lucide-react";
import {
  MODEL_ICONS,
  MODEL_SHAPES,
  MODEL_EXTERIORS,
  type NestedModel,
  type ModelAppearancePatch,
} from "../models";
import type { Page } from "../document";
import { exteriorLabels, exteriorSources } from "../modelExteriorView";

const modelIcons = {
  box: Box,
  clock: Clock3,
  layers: Layers3,
  fan: Fan,
  battery: Battery,
  scale: Scale,
  workflow: Workflow,
};
const shapeLabels = {
  plain: "Plain",
  pill: "Pill",
  stack: "Stack",
  frame: "Frame",
  slant: "Angled",
  double: "Double edge",
  band: "Banded",
};
export type AppearanceChange = (
  id: string,
  patch: ModelAppearancePatch,
) => void;
export function ModelGlyph({ model }: { model: NestedModel }) {
  const Icon = modelIcons[model.presentation?.icon || "box"] || Box;
  return (
    <Icon
      className="model-glyph"
      aria-hidden="true"
      data-model-icon={model.presentation?.icon || "box"}
      size={25}
      strokeWidth={1.5}
    />
  );
}

/** Every model uses the same optional appearance controls; no domain classification. */
export function ModelAppearance({
  model,
  change,
  page,
}: {
  model: NestedModel;
  change: AppearanceChange;
  page: Page;
}) {
  const [open, setOpen] = useState(false);
  const [appearance, setAppearance] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: globalThis.PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setAppearance(false);
      }
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  return (
    <span
      className="model-appearance"
      ref={root}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setAppearance(false);
        }
      }}
    >
      <button
        className="model-appearance-trigger"
        aria-label={`Model options ${model.name}`}
        title="Model options"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setAppearance(false);
        }}
      >
        <MoreHorizontal size={17} />
      </button>
      {open && !appearance && (
        <span
          role="menu"
          aria-label="Model options"
          className="model-appearance-options"
        >
          <button role="menuitem" onClick={() => setAppearance(true)}>
            Appearance…
          </button>
        </span>
      )}
      {open && appearance && (
        <span
          role="dialog"
          aria-label={`Model appearance ${model.name}`}
          className="model-appearance-options"
        >
          <strong>Appearance</strong>
          <button
            className="model-appearance-close"
            aria-label="Close model appearance"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
          <label>
            Exterior
            <select
              aria-label="Model exterior"
              value={model.presentation?.exterior?.kind || "interface"}
              onChange={(e) => {
                const kind = e.target.value as (typeof MODEL_EXTERIORS)[number];
                change(model.id, {
                  exterior: {
                    kind,
                    source: exteriorSources(page, model, kind)[0]?.id,
                  },
                });
              }}
            >
              {MODEL_EXTERIORS.map((kind) => (
                <option key={kind} value={kind}>
                  {exteriorLabels[kind]}
                </option>
              ))}
            </select>
          </label>
          {model.presentation?.exterior &&
            model.presentation.exterior.kind !== "interface" && (
              <label>
                Source
                <select
                  aria-label="Model exterior source"
                  value={model.presentation.exterior.source || ""}
                  onChange={(e) =>
                    change(model.id, {
                      exterior: {
                        kind: model.presentation!.exterior!.kind,
                        source: e.target.value || undefined,
                      },
                    })
                  }
                >
                  <option value="">Choose source…</option>
                  {model.presentation.exterior.source &&
                    !exteriorSources(
                      page,
                      model,
                      model.presentation.exterior.kind,
                    ).some(
                      (s) => s.id === model.presentation!.exterior!.source,
                    ) && (
                      <option value={model.presentation.exterior.source}>
                        Unavailable source
                      </option>
                    )}
                  {exteriorSources(
                    page,
                    model,
                    model.presentation.exterior.kind,
                  ).map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          <label>
            Icon
            <select
              aria-label="Model icon"
              value={model.presentation?.icon || "box"}
              onChange={(e) =>
                change(model.id, {
                  icon: e.target.value as (typeof MODEL_ICONS)[number],
                })
              }
            >
              {MODEL_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon[0].toUpperCase() + icon.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shape
            <select
              aria-label="Model shape"
              value={model.presentation?.shape || "plain"}
              onChange={(e) =>
                change(model.id, {
                  shape: e.target.value as (typeof MODEL_SHAPES)[number],
                })
              }
            >
              {MODEL_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {shapeLabels[shape]}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => change(model.id, { icon: "box", shape: "plain" })}
          >
            Reset appearance
          </button>
        </span>
      )}
    </span>
  );
}
