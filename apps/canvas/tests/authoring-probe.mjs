/** Counts actual clone/serialization calls containing the fixture source; not a heap estimate. */
export function observeAuthoring(source, operation) {
  const clone = globalThis.structuredClone,
    stringify = JSON.stringify;
  const counters = {
    cloneCalls: 0,
    clonedObjects: 0,
    sourceCloneCalls: 0,
    sourceSerializationCalls: 0,
  };
  function inspect(root) {
    const seen = new WeakSet();
    let objects = 0,
      containsSource = false;
    function visit(value) {
      if (typeof value === "string") {
        if (value === source) containsSource = true;
      } else if (value && typeof value === "object" && !seen.has(value)) {
        seen.add(value);
        objects++;
        for (const child of Object.values(value)) visit(child);
      }
    }
    visit(root);
    return { objects, containsSource };
  }
  globalThis.structuredClone = (value, options) => {
    const inspected = inspect(value);
    counters.cloneCalls++;
    counters.clonedObjects += inspected.objects;
    if (inspected.containsSource) counters.sourceCloneCalls++;
    return clone(value, options);
  };
  JSON.stringify = (...args) => {
    if (inspect(args[0]).containsSource) counters.sourceSerializationCalls++;
    return stringify(...args);
  };
  try {
    const value = operation();
    if (value?.then) throw Error("Authoring observation must be synchronous");
    return { value, counters };
  } finally {
    globalThis.structuredClone = clone;
    JSON.stringify = stringify;
  }
}
