import type { Json } from "./value.ts";
export type Asset = Readonly<{
  digest: string;
  size: number;
  mediaType: string;
  disposition: "included" | "linked";
}>;
export type Reference = Readonly<{
  document: string;
  item: string;
  selection: Readonly<{ kind: "follow" } | { kind: "pin"; revision: string }>;
  selector: Json;
}>;
export type Revision = Readonly<{
  id: string;
  item: string;
  schema: string;
  required: boolean;
  body: Json;
}>;
export type Item = Readonly<{
  id: string;
  label: string;
  revision: string | null;
}>;
export type View = Readonly<{
  id: string;
  reference: Reference;
  renderer: string;
  x: number;
  y: number;
  alternative: string | null;
}>;
export type ResourceRead =
  | Readonly<{ status: "ready"; data: string }>
  | Readonly<{
      status: "missing" | "unavailable" | "loading" | "corrupt";
      reason: string;
    }>;
/** The port returns verified immutable bytes; providers must check both digest and size. */
export interface Resources {
  read(asset: Asset): ResourceRead;
}
export type ProjectionOrigin = Readonly<{
  document: string;
  item: string;
  revision: string;
  selector: Json;
}>;
export type Projection = Readonly<{
  type: string;
  value: Json;
  revision: string;
  item: string;
  document: string;
  selector: Json;
  dependencies?: readonly ProjectionOrigin[];
}>;
/** Reads are constrained to declared dependencies and the exact document/context of this projection. */
export interface ProjectionReader {
  read(reference: Reference): ProjectionResult;
  readFrom(parent: Projection, reference: Reference): ProjectionResult;
}
export type ProjectionResult =
  | Readonly<{ status: "resolved"; projection: Projection }>
  | Readonly<{
      status:
        | "missing"
        | "unavailable"
        | "unsupported"
        | "ambiguous"
        | "loading"
        | "corrupt";
      reason: string;
    }>;
export interface Schema {
  readonly id: string;
  validate(body: Json): void;
  references(body: Json): readonly Reference[];
  assets(body: Json): readonly Asset[];
  /** Explicit retention links to execution evidence, independent of content references. */
  evidence?(body: Json): readonly string[];
  project(
    body: Json,
    selector: Json,
    resources: Resources,
    revision: Revision,
    reader: ProjectionReader,
  ):
    | Readonly<{ type: string; value: Json }>
    | Exclude<ProjectionResult, { status: "resolved" }>;
}
export type Scalar = Readonly<{
  value: number;
  unit: string;
  subject: string;
  frame: string;
  condition: string;
}>;
export type MethodRef = Readonly<{
  id: string;
  version: string;
  runtime: string;
}>;
export type Request = Readonly<{
  method: MethodRef;
  inputs: Readonly<Record<string, Reference>>;
  output: string;
  subject: string;
  frame: string;
  condition: string;
}>;
export type Method = Readonly<{
  requirements: MethodRef;
  inputs: Readonly<Record<string, string>>;
  output: string;
  validateDomain?(inputs: Readonly<Record<string, Scalar>>): void;
}>;
export interface Methods {
  get(ref: MethodRef): Method | undefined;
  readonly typed?: Readonly<{ get(ref: MethodRef): TypedMethod | undefined }>;
}
export type TypedValue = Readonly<{ schema: string; body: Json }>;
/** An ordinary domain projection may lower to this invocation without another request owner. */
export type TypedRequest = Readonly<{
  method: MethodRef;
  input: TypedValue;
  output: string;
}>;
export type TypedMethod = Readonly<{
  requirements: MethodRef;
  input: string;
  output: string;
  limits: Readonly<{ inputBytes: number; outputBytes: number }>;
  validateInput(value: Json): void;
  validateOutput(input: Json, value: unknown): Json;
  assets?(value: Json, role: "input" | "output"): readonly Asset[];
  validateInputResources?(input: Json, resources: Resources): void;
  validateOutputResources?(
    input: Json,
    output: Json,
    resources: Resources,
  ): void;
}>;
export interface ExecutionIO extends Resources {
  stage(asset: Asset, data: string): Promise<void>;
}
export interface Schemas {
  get(id: string): Schema | undefined;
}
