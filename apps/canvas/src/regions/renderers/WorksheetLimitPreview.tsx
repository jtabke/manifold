import { useId, useRef, useState } from "react";
import type {
  DesignLimitPreview,
  DesignResponseMap,
} from "../worksheetOptimization";

export function WorksheetLimitPreview({
  map,
  preview,
  disabled,
  change,
}: {
  map: DesignResponseMap;
  preview: DesignResponseMap["preview"];
  disabled: boolean;
  change: (limit?: DesignLimitPreview) => void;
}) {
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [edit, setEdit] = useState<{
    map: DesignResponseMap;
    id: string;
    text: string;
    error?: string;
  }>();
  const draft = edit?.map === map ? edit : undefined;
  const limits = map.requirements.filter((r) => r.fixedValue !== undefined);
  if (!limits.length) return null;
  return (
    <div className="design-limit-preview">
      <div className="design-limit-actions">
        <button
          type="button"
          ref={toggle}
          disabled={disabled}
          aria-expanded={!!draft}
          onClick={() => {
            const first = limits[0];
            setEdit(
              draft
                ? undefined
                : {
                    map,
                    id: preview?.id ?? first.id,
                    text: preview?.text ?? first.fixedValue!,
                  },
            );
          }}
        >
          Preview limit
        </button>
        {preview && (
          <button
            type="button"
            onClick={() => {
              change(undefined);
              setEdit(undefined);
              toggle.current?.focus({ preventScroll: true });
            }}
          >
            Reset limit
          </button>
        )}
      </div>
      {preview && (
        <strong className="design-limit-current" role="status">
          Preview only: {preview.label}
        </strong>
      )}
      {(preview || draft) && (
        <small>
          Map-only preview. The worksheet is unchanged. Reset the preview to run
          against worksheet limits.
        </small>
      )}
      {draft && (
        <form
          aria-label="Preview a fixed requirement"
          onSubmit={(e) => {
            e.preventDefault();
            if (disabled) return;
            try {
              change({ id: draft.id, text: draft.text });
              setEdit(undefined);
              toggle.current?.focus({ preventScroll: true });
            } catch (error) {
              setEdit({ ...draft, error: (error as Error).message });
            }
          }}
        >
          <label htmlFor={`${id}-requirement`}>Requirement</label>
          <select
            id={`${id}-requirement`}
            value={draft.id}
            disabled={disabled}
            onChange={(e) => {
              const limit = limits.find((r) => r.id === e.target.value);
              if (limit)
                setEdit({ map, id: limit.id, text: limit.fixedValue! });
            }}
          >
            {limits.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-value`}>Preview value</label>
          <input
            id={`${id}-value`}
            value={draft.text}
            disabled={disabled}
            maxLength={256}
            autoComplete="off"
            aria-invalid={!!draft.error}
            aria-describedby={draft.error ? `${id}-error` : undefined}
            onChange={(e) =>
              setEdit({ ...draft, text: e.target.value, error: undefined })
            }
          />
          <button type="submit" disabled={disabled}>
            Show preview
          </button>
          {draft.error && (
            <p id={`${id}-error`} role="alert">
              {draft.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
