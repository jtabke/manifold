/** Test-only CPU sampling attribution. Categories partition self samples; contexts overlap. */
import ts from "typescript";
export function stats(values) {
  if (!values.length || values.some((v) => !Number.isFinite(v) || v < 0))
    throw Error("Invalid timing samples");
  const sorted = values.toSorted((a, b) => a - b);
  return {
    count: sorted.length,
    median:
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
    samples: values,
  };
}
export function bundleRanges(source) {
  // A separate non-minified diagnostic build is required; never guess minified names.
  const file = ts.createSourceFile(
      "bundle.js",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    ranges = [];
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node)
    ) {
      const name =
        node.name?.getText(file) ??
        (ts.isVariableDeclaration(node.parent)
          ? node.parent.name.getText(file)
          : "");
      let tag;
      if (
        /^json(?:\$?\d+)?$/.test(name) &&
        node.getText(file).includes("Cyclic JSON")
      )
        tag = "JSON validation";
      else if (/^parsedJson(?:\$?\d+)?$/.test(name)) tag = "Parsed JSON checks";
      else if (/^freezeRetained(?:\$?\d+)?$/.test(name))
        tag = "Freeze owned clone";
      else if (/^retained(?:\$?\d+)?$/.test(name)) tag = "Retention other";
      else if (/^canonical(?:\$?\d+)?$/.test(name))
        tag = "Canonicalization other";
      else if (
        /^notify(?:\$?\d+)?$/.test(name) &&
        node.getText(file).includes("notificationErrors")
      )
        tag = "Subscriber notification";
      else if (/^CanvasStorageBudget(?:\$?\d+)?$/.test(name))
        tag = "Capacity other";
      else if (
        /^requireReactDomClient_production/.test(name) ||
        /^DrawingCanvas(?:\$?\d+)?$/.test(name)
      )
        tag = "React / drawing render";
      else if (
        /^(indexedBackend|commitRecords|recordWriter)(?:\$?\d+)?$/.test(name)
      )
        tag = "Storage JS";
      if (tag) ranges.push({ start: node.getStart(file), end: node.end, tag });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const required of [
    "JSON validation",
    "Freeze owned clone",
    "Capacity other",
    "React / drawing render",
    "Storage JS",
  ])
    if (!ranges.some((r) => r.tag === required))
      throw Error(
        "Missing diagnostic bundle range: " +
          required +
          "; build with --minify=false",
      );
  return { ranges, lines: file.getLineStarts() };
}
export function summarize(profile, bundle) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])),
    parents = new Map(),
    buckets = {},
    contexts = {},
    frames = new Map(),
    tags = new Map();
  for (const n of profile.nodes) {
    for (const child of n.children ?? []) parents.set(child, n.id);
    const f = n.callFrame,
      name = f.functionName;
    let found = [];
    if (bundle && f.url.includes("/assets/index-")) {
      const offset = bundle.lines[f.lineNumber] + f.columnNumber;
      found = bundle.ranges
        .filter((r) => offset >= r.start && offset < r.end)
        .map((r) => r.tag);
    } else if (f.url.endsWith("/foundation/src/value.ts")) {
      if (name === "json") found.push("JSON validation");
      if (name === "freezeRetained") found.push("Freeze owned clone");
      if (name === "retained") found.push("Retention other");
      if (name === "canonical" || name === "order")
        found.push("Canonicalization other");
    }
    if (f.url.endsWith("/local-store.ts") && name === "parsedJson")
      found.push("Parsed JSON checks");
    if (
      [
        "record-graph.ts",
        "record-backend.ts",
        "incremental.ts",
        "local-store.ts",
      ].some((file) => f.url.endsWith("/foundation/src/" + file))
    )
      found.push("Storage JS");
    if (f.url.endsWith("/canvasStorageBudget.ts")) found.push("Capacity other");
    if (
      (f.url.endsWith("/foundation/src/runtime.ts") && name === "notify") ||
      (f.url.endsWith("/regions/document.ts") && name === "emit")
    )
      found.push("Subscriber notification");
    if (name === "structuredClone") found.push("Structured clone");
    if (f.url.startsWith("node:inspector")) found.push("Profiler overhead");
    tags.set(n.id, found);
  }
  const priority = [
    "Profiler overhead",
    "JSON validation",
    "Parsed JSON checks",
    "Freeze owned clone",
    "Structured clone",
    "Canonicalization other",
    "Retention other",
    "Capacity other",
    "React / drawing render",
    "Subscriber notification",
    "Storage JS",
  ];
  for (let i = 0; i < (profile.samples ?? []).length; i++) {
    let id = profile.samples[i];
    const weight = profile.timeDeltas[i] / 1000,
      all = new Set(),
      seenFrames = new Set();
    const leaf = nodes.get(id).callFrame;
    while (id !== undefined) {
      const n = nodes.get(id),
        f = n.callFrame;
      for (const tag of tags.get(id)) all.add(tag);
      const key = `${f.url}:${f.lineNumber + 1} ${f.functionName}`;
      if (!seenFrames.has(key)) {
        frames.set(key, (frames.get(key) ?? 0) + weight);
        seenFrames.add(key);
      }
      id = parents.get(id);
    }
    const bucket =
      leaf.functionName === "(idle)"
        ? "Idle"
        : leaf.functionName === "(garbage collector)"
          ? "GC"
          : (priority.find((tag) => all.has(tag)) ?? "Other / unattributed");
    buckets[bucket] = (buckets[bucket] ?? 0) + weight;
    for (const tag of all) contexts[tag] = (contexts[tag] ?? 0) + weight;
  }
  return {
    sampledMs: Object.values(buckets).reduce((a, b) => a + b, 0),
    selfBucketsMs: buckets,
    inclusiveContextsMs: contexts,
    inclusiveFramesMs: [...frames].sort((a, b) => b[1] - a[1]).slice(0, 25),
  };
}
export function unionMs(spans) {
  let end = -Infinity,
    total = 0;
  for (const span of spans.toSorted((a, b) => a.start - b.start)) {
    if (span.end < span.start) throw Error("Invalid transaction span");
    total += Math.max(0, span.end - Math.max(end, span.start));
    end = Math.max(end, span.end);
  }
  return total;
}
