/** Stable errors at the headless API boundary; domain messages remain human-readable. */
export type HeadlessErrorCode =
  | "WORKSPACE_CLOSED"
  | "STALE_DOCUMENT"
  | "ITEM_NOT_FOUND"
  | "UNSUPPORTED_CONTENT"
  | "INVALID_INPUT"
  | "INVALID_WORKSPACE"
  | "OPERATION_REJECTED";

export class HeadlessError extends Error {
  readonly details: Readonly<Record<string, string | null>>;
  readonly code: HeadlessErrorCode;
  constructor(
    code: HeadlessErrorCode,
    message: string,
    details: Readonly<Record<string, string | null>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HeadlessError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/** Do not infer classifications by matching domain error text. */
export function headlessOperation<T>(
  operation: string,
  run: () => T,
  code: HeadlessErrorCode = "OPERATION_REJECTED",
): T {
  try {
    return run();
  } catch (cause) {
    if (cause instanceof HeadlessError) throw cause;
    throw new HeadlessError(
      code,
      cause instanceof Error ? cause.message : String(cause),
      { operation },
      { cause },
    );
  }
}
