/** Closed scalar DAG lowering. Units are normalized by the existing v3 owner. */
import * as f from "@manifold/foundation";
import { equationMethods } from "./authoredModels.ts";
import { scientificQuantity, canonicalUnit } from "../notebook/scientific.ts";
import type { AnalysisInput } from "./modelAnalysis.ts";
export const OPTIMIZER_VERSION = "manifold-numeric-optimizer/1";
export type NumericNode = { op: string; args?: number[]; value?: number };
export type NumericProgram = { nodes: NumericNode[]; output: number };
export function lowerOptimization(input: AnalysisInput): NumericProgram {
  const depths: number[] = [];
  const nodes: NumericNode[] = [],
    cache = new Map<
      string,
      { index: number; value: number; unit: string; variable: boolean }
    >();
  const put = (node: NumericNode) => {
    f.assert(nodes.length < 256, "Optimization DAG exceeds 256 nodes");
    // JSON transports cannot preserve -0; normalize deliberately before hashing.
    if (node.value === 0) node.value = 0;
    if (node.op === "const")
      f.assert(
        typeof node.value === "number" &&
          Number.isFinite(node.value) &&
          Math.abs(node.value) <= 1e12,
        "Optimization constants must be finite and within ±1e12 after unit normalization",
      );
    const depth = node.args
      ? 1 + Math.max(...node.args.map((i) => depths[i]!))
      : 1;
    f.assert(depth <= 32, "Optimization DAG exceeds depth 32");
    depths.push(depth);
    nodes.push(node);
    return nodes.length - 1;
  };
  const canonical = (value: number, unit: string) => {
    const q = scientificQuantity(value, unit);
    return { value: q.value, unit: canonicalUnit(q.dimension) };
  };
  const active = new Set<string>();
  function visit(
    target: f.ModelTarget,
    depth = 0,
  ): { index: number; value: number; unit: string; variable: boolean } {
    f.assert(
      "node" in target && depth <= 32,
      "Only bounded local scalar graphs can be optimized",
    );
    const id = target.node,
      old = cache.get(id);
    if (old) return old;
    f.assert(!active.has(id), "Cyclic optimization graph");
    active.add(id);
    const node = input.model.nodes[id];
    f.assert(node, "Missing optimization node");
    let result: {
      index: number;
      value: number;
      unit: string;
      variable: boolean;
    };
    if (node.kind === "constant" || node.kind === "input") {
      const port = Object.entries(input.model.inputs).find(
        ([, p]) => p.node === id,
      )?.[0];
      const scalar = port
        ? input.inputs[port]!
        : node.kind === "constant"
          ? node
          : { value: node.default, unit: node.unit };
      f.assert(
        typeof scalar.value === "number",
        "Every non-exposed input needs a captured default",
      );
      const q = canonical(scalar.value, scalar.unit),
        variable = port === input.x.port;
      // x is expressed in the captured input unit, all arithmetic in canonical units.
      let index = variable
        ? put({ op: "x" })
        : put({ op: "const", value: q.value });
      if (variable) {
        const zero = canonical(0, scalar.unit).value,
          scale = canonical(1, scalar.unit).value - zero;
        f.assert(
          zero === 0 && scale > 0,
          "Affine input units are not supported",
        );
        if (scale !== 1)
          index = put({
            op: "mul",
            args: [index, put({ op: "const", value: scale })],
          });
      }
      result = { index, ...q, variable };
    } else {
      f.assert(
        node.kind === "method",
        "Native or composite nodes cannot be optimized",
      );
      const method = equationMethods.find(
        (m) => f.methodKey(m.requirements) === f.methodKey(node.method),
      );
      f.assert(
        method && node.method.version === "3" && method.evaluateScalar,
        "Optimization requires reviewed scientific v3 equation methods; upgrade the authored model explicitly",
      );
      const opName = node.method.id
        .slice("manifold.equation.".length)
        .split(".")[0]!;
      const ops: Record<string, string> = {
        add: "add",
        subtract: "sub",
        multiply: "mul",
        divide: "div",
        power: "pow",
        negate: "neg",
        identity: "pos",
        log: "ln",
      };
      const op = ops[opName] || opName;
      f.assert(
        [
          "add",
          "sub",
          "mul",
          "div",
          "pow",
          "neg",
          "pos",
          "sqrt",
          "abs",
          "sin",
          "cos",
          "tan",
          "asin",
          "acos",
          "atan",
          "sinh",
          "cosh",
          "tanh",
          "exp",
          "ln",
          "log10",
          "floor",
          "ceil",
          "round",
          "cbrt",
          "atan2",
          "min",
          "max",
        ].includes(op),
        "Equation function has no reviewed numerical lowering",
      );
      const keys = Object.keys(method.inputs),
        args = keys.map((key) => visit(node.inputs[key]!, depth + 1));
      const q = method.evaluateScalar(
        Object.fromEntries(
          keys.map((key, i) => [
            key,
            {
              value: args[i]!.value,
              unit: args[i]!.unit,
              ...input.interpretation,
            },
          ]),
        ),
      );
      if (
        op === "pow" &&
        scientificQuantity(args[0]!.value, args[0]!.unit).dimension.some(
          (n) => n !== 0,
        )
      )
        f.assert(
          !args[1]!.variable,
          "A dimensional power needs a fixed exponent",
        );
      const normalized = canonical(q.value, q.unit);
      result = {
        index: put({ op, args: args.map((a) => a.index) }),
        ...normalized,
        variable: args.some((a) => a.variable),
      };
    }
    active.delete(id);
    cache.set(id, result);
    return result;
  }
  const out = visit(input.model.outputs[input.y.port]!.target);
  const scale = scientificQuantity(1, input.y.unit).value;
  f.assert(
    scientificQuantity(0, input.y.unit).value === 0 &&
      scale > 0 &&
      canonicalUnit(scientificQuantity(1, input.y.unit).dimension) === out.unit,
    "Output dimensions differ",
  );
  const output =
    scale === 1
      ? out.index
      : put({
          op: "div",
          args: [out.index, put({ op: "const", value: scale })],
        });
  return { nodes, output };
}

/** SHA-256 over the protocol's binary64-normalized canonical JSON, no decimal ambiguity. */
export function programDigest(program: NumericProgram): string {
  const normalized = {
    ...program,
    nodes: program.nodes.map((node) => {
      if (node.op !== "const") return node;
      const buffer = new ArrayBuffer(8);
      new DataView(buffer).setFloat64(0, node.value === 0 ? 0 : node.value!);
      return {
        ...node,
        value: [...new Uint8Array(buffer)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join(""),
      };
    }),
  };
  const bytes = new TextEncoder().encode(
    f.canonical({
      version: OPTIMIZER_VERSION,
      program: normalized,
    } as unknown as f.Json),
  );
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  data.set(bytes);
  data[bytes.length] = 128;
  new DataView(data.buffer).setUint32(data.length - 4, bytes.length * 8);
  const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let at = 0; at < data.length; at += 64) {
    const w = new Int32Array(64),
      view = new DataView(data.buffer);
    for (let i = 0; i < 64; i++)
      w[i] =
        i < 16
          ? view.getInt32(at + i * 4)
          : (w[i - 16]! +
              (rotate(w[i - 15]!, 7) ^
                rotate(w[i - 15]!, 18) ^
                (w[i - 15]! >>> 3)) +
              w[i - 7]! +
              (rotate(w[i - 2]!, 17) ^
                rotate(w[i - 2]!, 19) ^
                (w[i - 2]! >>> 10))) |
            0;
    let [a, b, c, d, e, g, j, l] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const t1 =
          (l +
            (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
            ((e & g) ^ (~e & j)) +
            k[i]! +
            w[i]!) |
          0,
        t2 =
          ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
            ((a & b) ^ (a & c) ^ (b & c))) |
          0;
      l = j;
      j = g;
      g = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, g, j, l].forEach((n, i) => {
      h[i] = (h[i]! + n) | 0;
    });
  }
  return h.map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}
