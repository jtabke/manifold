/** Proposed contracts, 2026-10-20. Not the application's storage format. */
export type Id<K extends string> = string & { readonly __kind: K };
export type DocumentId = Id<"document">;
export type DefinitionId = Id<"definition">;
export type RevisionId = Id<"revision">;
export type SourceId = Id<"source">;
export type ScopeId = Id<"scope">;
export type SnapshotId = Id<"snapshot">;
export type ContextId = Id<"context">;
export type ContextRevisionId = Id<"context-revision">;
export type ViewId = Id<"view">;
export type ReceiptId = Id<"receipt">;
export type BlobId = Id<"blob">;
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };
export type Selection<K extends string, V> = Readonly<Partial<Record<K, V>>>;

/** IDs below are document-local; a document ID qualifies references across archives. */
export type ValueTarget =
  | { readonly kind: "quantity"; readonly quantity: DefinitionId }
  | {
      readonly kind: "output";
      readonly computation: DefinitionId;
      readonly slot: string;
    }
  | {
      readonly kind: "port";
      readonly model: DefinitionId;
      readonly port: string;
    };
export type EvaluationTarget =
  | ValueTarget
  | {
      readonly kind: "condition";
      readonly condition: DefinitionId;
    };
export type UnitRef = {
  readonly registry: string;
  readonly revision: string;
  readonly unit: string;
};
export type NumericType = {
  /** Empty = scalar. Dimensions here are array extents, not physical dimensions. */
  readonly shape: readonly number[];
  readonly unit: UnitRef;
  readonly space: "linear" | "absolute";
};
export type NumericValue = {
  readonly kind: "numeric";
  readonly type: NumericType;
  readonly data:
    | { readonly kind: "scalar"; readonly value: number }
    | {
        readonly kind: "array";
        readonly blob: BlobId;
        readonly encoding: string;
      };
};
export type ArtifactType = {
  readonly kind: "artifact";
  readonly mediaType: string;
  readonly schema?: { readonly id: string; readonly version: string };
};
export type ArtifactValue = {
  readonly kind: "artifact";
  readonly type: ArtifactType;
  readonly blob: BlobId;
  readonly richerSource?: {
    readonly source: SourceId;
    readonly revision: RevisionId;
  };
};
export type EvaluatedValue =
  | NumericValue
  | ArtifactValue
  | {
      readonly kind: "condition";
      readonly satisfied: boolean;
    };
export type ReferenceOccurrence = {
  readonly id: string;
  /** UTF-16 half-open range in this exact immutable text revision. */
  readonly span: readonly [number, number];
  readonly spelling: string;
  readonly resolution:
    | { readonly kind: "bound"; readonly target: ValueTarget }
    | { readonly kind: "unresolved"; readonly reason: string };
};
export type AuthoredExpression = {
  readonly language: { readonly id: string; readonly version: string };
  readonly text: string;
  readonly syntax: "complete" | "draft";
  readonly references: readonly ReferenceOccurrence[];
};
export type SourceRead = {
  readonly source: SourceId;
  /** Coordinates are meaningful only inside the context-selected source revision. */
  readonly selector: {
    readonly kind: "cell";
    readonly row: number;
    readonly column: number;
  };
  readonly interpretedAs: NumericType;
  readonly decoder: { readonly id: string; readonly version: string };
};
export type DefinitionBody =
  | {
      readonly kind: "entity";
      readonly label: string;
      readonly description?: string;
    }
  | {
      readonly kind: "quantity";
      readonly symbol: string;
      readonly description: string;
      readonly about?: DefinitionId;
      readonly type?: NumericType;
      /** The only authoritative producer selection for this quantity. */
      readonly provider:
        | { readonly kind: "unassigned" }
        | { readonly kind: "literal"; readonly value: NumericValue }
        | { readonly kind: "measurement"; readonly read: SourceRead }
        | {
            readonly kind: "computed";
            readonly output: Extract<ValueTarget, { kind: "output" }>;
          }
        | {
            readonly kind: "model-input";
            readonly model: DefinitionId;
            readonly port: string;
          };
    }
  | {
      readonly kind: "computation";
      readonly label: string;
      /** Named quantities may point to output slots; anonymous outputs need no quantity. */
      readonly outputs: readonly {
        readonly slot: string;
        readonly type?: NumericType | ArtifactType;
      }[];
      readonly method:
        | {
            readonly kind: "expression";
            readonly expression: AuthoredExpression;
          }
        | {
            readonly kind: "adapter";
            readonly adapter: string;
            readonly contractVersion: string;
            readonly method: {
              readonly source: SourceId;
              readonly entry: string;
            };
            readonly inputs: Readonly<Record<string, ValueTarget>>;
            /** Adapter-versioned selectors; source edges are explicit, not hidden in parameters. */
            readonly sourceInputs: Readonly<
              Record<
                string,
                {
                  readonly source: SourceId;
                  readonly selector?: Json;
                }
              >
            >;
            readonly parameters: Json;
          };
    }
  | {
      readonly kind: "condition";
      readonly expression: AuthoredExpression;
      readonly role: "requirement" | "hypothesis";
    }
  | {
      readonly kind: "note";
      readonly text: string;
      readonly format: "plain" | "markdown";
    }
  | {
      /** Noncomputational association; never silently an evaluation dependency. */
      readonly kind: "association";
      readonly relation: "evidence-for" | "describes";
      readonly from: DefinitionId;
      readonly to: DefinitionId;
    }
  | {
      readonly kind: "model";
      readonly label: string;
      readonly interior: ScopeId;
      readonly ports: readonly {
        readonly id: string;
        readonly quantity: DefinitionId;
        readonly connection:
          | { readonly direction: "input"; readonly binding?: ValueTarget }
          | { readonly direction: "output" };
      }[];
    }
  | {
      /** Preserve unknown codecs. Unsupported semantics cannot evaluate as current. */
      readonly kind: "extension";
      readonly codec: { readonly id: string; readonly version: string };
      readonly payload: Json;
      readonly references: readonly DefinitionId[];
      readonly sources: readonly SourceId[];
      readonly blobs: readonly BlobId[];
    };
export type DefinitionRevision = {
  readonly id: RevisionId;
  readonly definition: DefinitionId;
  readonly scope: ScopeId;
  readonly body: DefinitionBody;
};
export type SourceRevision = {
  readonly id: RevisionId;
  readonly source: SourceId;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly digest: string;
  readonly content:
    | { readonly kind: "embedded"; readonly blob: BlobId }
    | {
        readonly kind: "external";
        readonly locator: string;
        readonly version: string;
      };
  readonly derivedFrom: readonly {
    readonly sourceRevision: RevisionId;
    readonly method: string;
    readonly loss: string;
  }[];
};
export type SemanticSnapshot = {
  readonly id: SnapshotId;
  readonly document: DocumentId;
  /** Complete logical selections; physical encoding may share persistent map nodes. */
  readonly definitions: Selection<DefinitionId, RevisionId>;
  readonly sources: Selection<SourceId, RevisionId>;
  readonly scopes: Selection<ScopeId, { readonly parent?: ScopeId }>;
};
export type ContextRevision = {
  readonly id: ContextRevisionId;
  readonly context: ContextId;
  readonly snapshot: SnapshotId;
  /** Prior revision of this same context; history, never live inheritance. */
  readonly previous?: ContextRevisionId;
  /** Original/updated baseline for an alternative's three-way comparison. */
  readonly basedOn?: ContextRevisionId;
};
export type ContextSelector =
  | { readonly kind: "follow"; readonly context: ContextId }
  | { readonly kind: "pinned"; readonly revision: ContextRevisionId };
export type View = {
  readonly id: ViewId;
  readonly target: DefinitionId;
  readonly context: ContextSelector;
  readonly renderer: { readonly id: string; readonly version: string };
  /** Presentation preferences cannot change evaluation semantics. */
  readonly settings: Json;
  readonly placement: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};
export type Comparison = {
  readonly id: string;
  readonly left: ContextRevisionId;
  readonly right: ContextRevisionId;
  readonly targets: readonly ValueTarget[];
};
export type AcceptedWorkspace = {
  readonly format: "manifold-model-proposal";
  readonly version: 1;
  readonly document: DocumentId;
  /** Advances for every accepted operation, including Undo and presentation changes. */
  readonly sequence: number;
  readonly contexts: Selection<
    ContextId,
    { readonly label: string; readonly head: ContextRevisionId }
  >;
  readonly views: Selection<ViewId, View>;
  readonly comparisons: readonly Comparison[];
};
export type RecordStore = {
  readonly definitions: Selection<RevisionId, DefinitionRevision>;
  readonly sources: Selection<RevisionId, SourceRevision>;
  readonly snapshots: Selection<SnapshotId, SemanticSnapshot>;
  readonly contexts: Selection<ContextRevisionId, ContextRevision>;
};
export type EvaluationManifest = {
  /** Actual transitive dependency closure, not every definition in the workspace. */
  readonly definitions: readonly {
    readonly definition: DefinitionId;
    readonly revision: RevisionId;
  }[];
  readonly sources: readonly {
    readonly source: SourceId;
    readonly revision: RevisionId;
  }[];
  readonly requested: readonly EvaluationTarget[];
  readonly inputs: Readonly<Record<string, EvaluatedValue>>;
  readonly method: { readonly id: string; readonly revision: string };
  readonly runtime: { readonly id: string; readonly version: string };
  readonly configuration: Json;
};
export type EvaluationReceipt = {
  readonly id: ReceiptId;
  readonly request: string;
  readonly document: DocumentId;
  readonly context: ContextRevisionId;
  readonly manifest: EvaluationManifest;
  readonly key: string;
  readonly outcome:
    | {
        readonly kind: "succeeded";
        readonly values: Readonly<Record<string, EvaluatedValue>>;
      }
    | {
        readonly kind: "failed";
        readonly code: string;
        readonly detail: string;
      };
};
export type Preview = {
  readonly base: ContextRevisionId;
  readonly replacements: readonly DefinitionRevision[];
};
export type Archive = {
  readonly workspace: AcceptedWorkspace;
  readonly records: RecordStore;
  readonly receipts: readonly EvaluationReceipt[];
  readonly blobs: readonly {
    readonly id: BlobId;
    readonly digest: string;
    readonly byteLength: number;
    /** Missing bytes preserve provenance; they cannot satisfy a source read. */
    readonly content:
      | {
          readonly kind: "inline";
          readonly encoding: "utf8" | "base64";
          readonly data: string;
        }
      | { readonly kind: "external"; readonly locator: string }
      | { readonly kind: "missing" };
  }[];
};
