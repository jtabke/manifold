import test from "node:test";
import assert from "node:assert/strict";
import {
  retained,
  deeplyFrozen,
  freeze,
  canonical,
  json,
} from "../src/value.ts";

test("JSON validation snapshots every descriptor without bulk reflection or getters", () => {
  const value = retained({ points: [{ x: 1, y: 2 }], text: "😀" });
  const bulk = Object.getOwnPropertyDescriptors,
    single = Object.getOwnPropertyDescriptor;
  let reads = 0,
    invoked = false;
  Object.getOwnPropertyDescriptors = () => {
    throw Error("redundant descriptor map");
  };
  Object.getOwnPropertyDescriptor = (object, key) => {
    reads++;
    return single(object, key);
  };
  try {
    json(value);
    json(value);
    assert.equal(
      reads,
      12,
      "even owned frozen graphs receive full JSON validation on every call",
    );
    assert.throws(
      () =>
        json({
          get x() {
            invoked = true;
            return 1;
          },
        }),
      /Accessors/,
    );
  } finally {
    Object.getOwnPropertyDescriptors = bulk;
    Object.getOwnPropertyDescriptor = single;
  }
  assert.equal(invoked, false);
});

test("JSON descriptor snapshots preserve rejection across mutating Proxy siblings", () => {
  const input = () => {
    const value = {};
    value.a = new Proxy(
      {},
      {
        getPrototypeOf() {
          value.a = 0;
          value.b = 1;
          return Object.prototype;
        },
      },
    );
    value.b = undefined;
    return value;
  };
  for (const validate of [json, retained, canonical])
    assert.throws(() => validate(input()), /Non-JSON/);
});

test("JSON snapshots keep numeric-key order and ignore descriptors removed during Proxy reflection", () => {
  const visits = [],
    target = Object.create(null);
  for (const key of ["2", "1", "__proto__"])
    target[key] = new Proxy(
      {},
      {
        getPrototypeOf() {
          visits.push(key);
          return Object.prototype;
        },
      },
    );
  const value = new Proxy(target, {
    ownKeys() {
      return ["2", Symbol("removed"), "1", "__proto__"];
    },
  });
  json(value);
  assert.deepEqual(visits, ["1", "2", "__proto__"]);
});

test("ordinary descriptor snapshots avoid keyed maps while Proxy array-index boundaries retain ordering", () => {
  const create = Object.create;
  let maps = 0;
  Object.create = (...args) => {
    maps++;
    return create(...args);
  };
  try {
    json({ points: [{ x: 1, y: 2 }], ["__proto__"]: null });
  } finally {
    Object.create = create;
  }
  assert.equal(
    maps,
    0,
    "ordinary validation must not allocate a keyed descriptor map",
  );
  const keys = [
      "1.5",
      "4294967295",
      "00",
      "-0",
      "1e2",
      "4294967294",
      "0",
      "2",
      "9007199254740991",
    ],
    visits = [],
    target = Object.create(null);
  for (const key of keys)
    target[key] = new Proxy(
      {},
      {
        getPrototypeOf() {
          visits.push(key);
          return Object.prototype;
        },
      },
    );
  json(
    new Proxy(target, {
      ownKeys() {
        return keys;
      },
    }),
  );
  assert.deepEqual(visits, [
    "0",
    "2",
    "4294967294",
    "1.5",
    "4294967295",
    "00",
    "-0",
    "1e2",
    "9007199254740991",
  ]);
});

test("compact snapshots match ordinary snapshot enumeration across seeded Proxy permutations and vanished keys", () => {
  let seed = 0x91ab;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 8;
  };
  const pool = [
    "0",
    "2",
    "10",
    "4294967294",
    "4294967295",
    "1.5",
    "-0",
    "00",
    "1e2",
    "",
    "__proto__",
    "constructor",
    "toJSON",
    "😀",
  ];
  for (let pass = 0; pass < 1000; pass++) {
    const keys = [...pool],
      visits = [],
      target = Object.create(null);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = random() % (i + 1);
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    for (const key of keys)
      target[key] = new Proxy(
        {},
        {
          getPrototypeOf() {
            visits.push(key);
            return Object.prototype;
          },
        },
      );
    const raw = ["missing-a", ...keys, Symbol("removed"), "missing-z"],
      original = [...raw];
    json(
      new Proxy(target, {
        ownKeys() {
          return raw;
        },
      }),
    );
    assert.deepEqual(visits, Object.keys(target));
    assert.deepEqual(
      raw,
      original,
      "the caller's ownKeys array must not be compacted in place",
    );
  }
});

test("retained JSON establishes deep immutability for every owned node without rescanning descriptors", () => {
  const shared = { x: 1 },
    input = { a: shared, b: [shared, { c: "value" }] };
  const output = retained(input),
    owned = new WeakSet();
  function collect(value) {
    if (!value || typeof value !== "object" || owned.has(value)) return;
    owned.add(value);
    assert(Object.isFrozen(value));
    for (const child of Object.values(value)) collect(child);
  }
  collect(output);
  assert.notEqual(output, input);
  assert.notEqual(output.a, shared);
  assert.equal(
    output.a,
    output.b[0],
    "clone preserves internal shared references, not caller aliases",
  );
  const descriptors = Object.getOwnPropertyDescriptors;
  Object.getOwnPropertyDescriptors = function (value) {
    assert(!owned.has(value), "owned JSON was redundantly inspected");
    return descriptors(value);
  };
  try {
    for (const value of [
      output,
      output.a,
      output.b,
      output.b[1],
      Object.freeze({ wrap: output }),
    ])
      assert.equal(deeplyFrozen(value), true);
  } finally {
    Object.getOwnPropertyDescriptors = descriptors;
  }
  shared.x = 99;
  input.b.push({ other: 2 });
  assert.equal(output.a.x, 1);
  assert.equal(output.b.length, 2);
  assert.equal(
    deeplyFrozen(input),
    false,
    "validation/cloning must not certify the caller's mutable graph",
  );
});

test("caller-frozen graphs still require inspection and reject shallow freezing or non-JSON data", () => {
  let invoked = false;
  const accessor = Object.freeze({
    get x() {
      invoked = true;
      return 1;
    },
  });
  const cycle = {};
  cycle.self = cycle;
  Object.freeze(cycle);
  const sparse = Object.freeze(Array(2));
  const decorated = [1];
  decorated.extra = 2;
  Object.freeze(decorated);
  const hidden = {};
  Object.defineProperty(hidden, "x", { value: 1 });
  Object.freeze(hidden);
  const inputs = [
    Object.freeze({ child: {} }),
    accessor,
    cycle,
    sparse,
    decorated,
    hidden,
    Object.freeze({ [Symbol("x")]: 1 }),
    Object.freeze(new Date()),
    Object.freeze({ x: NaN }),
  ];
  for (const input of inputs) {
    assert.equal(deeplyFrozen(input), false);
    freeze(input);
    assert.equal(
      deeplyFrozen(input),
      false,
      "generic freeze must not mint a trusted JSON proof",
    );
  }
  for (const input of inputs.slice(1)) assert.throws(() => retained(input));
  assert.equal(invoked, false);
  const foreign = Object.freeze({ a: Object.freeze([1, 2]) });
  let inspections = 0;
  const descriptors = Object.getOwnPropertyDescriptors;
  Object.getOwnPropertyDescriptors = function (value) {
    if (value === foreign || value === foreign.a) inspections++;
    return descriptors(value);
  };
  try {
    assert(deeplyFrozen(foreign));
    assert.equal(inspections, 2);
    assert(deeplyFrozen(foreign));
    assert.equal(inspections, 2);
  } finally {
    Object.getOwnPropertyDescriptors = descriptors;
  }
});

test("trusted immutability does not bypass JSON depth validation at a new retention boundary", () => {
  let input = 0;
  for (let i = 0; i < 128; i++) input = { next: input };
  const output = retained(input);
  assert(deeplyFrozen(output));
  assert.throws(() => retained({ next: output }), /nesting limit/);
  assert.throws(() => canonical({ next: output }), /nesting limit/);
});

test("retention preserves canonical bytes across scalars, arrays, unusual keys and null prototypes", () => {
  const nil = Object.create(null);
  nil["__proto__"] = ["😀", "\ud800", -0];
  nil["2"] = true;
  nil["a"] = null;
  for (const value of [
    null,
    true,
    "text",
    -0,
    1e-9,
    [],
    {},
    nil,
    { z: [1, 2, { y: false }], a: '"\\\n' },
  ]) {
    const expected = canonical(value),
      output = retained(value);
    assert.equal(canonical(output), expected);
    assert(deeplyFrozen(output));
  }
});
