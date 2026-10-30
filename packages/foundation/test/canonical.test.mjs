import test from "node:test";
import assert from "node:assert/strict";
import { canonical, json, object } from "../src/value.ts";
// Exact previous algorithm, deliberately retained as an independent encoding oracle.
function reference(value) {
  json(value);
  const order = (x) =>
    Array.isArray(x)
      ? x.map(order)
      : object(x)
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((key) => [key, order(x[key])]),
          )
        : x;
  return JSON.stringify(order(value));
}
test("canonical bytes equal the previous algorithm across seeded JSON and unusual keys/scalars", () => {
  let seed = 0x4141;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 8;
  };
  const scalars = [
    null,
    false,
    true,
    -0,
    Number.MAX_VALUE,
    Number.MIN_VALUE,
    1e21,
    1e-9,
    "",
    '😀汉字\ud800\udfff\u0000\n\\"',
  ];
  const keys = [
    "a",
    "z",
    "2",
    "10",
    "00",
    "1.5",
    "4294967294",
    "4294967295",
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "toJSON",
    "",
    "😀",
    "\ud800",
  ];
  function value(depth = 0) {
    if (depth === 5 || random() % 3 === 0)
      return scalars[random() % scalars.length];
    if (random() % 2)
      return Array.from({ length: random() % 5 }, () => value(depth + 1));
    const result = random() % 2 ? {} : Object.create(null);
    for (let n = random() % 7; n > 0; n--)
      Object.defineProperty(result, keys[random() % keys.length], {
        value: value(depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return result;
  }
  const shared = { z: "same", a: 1 },
    nil = Object.create(null);
  for (const key of keys) nil[key] = key;
  for (const input of [
    ...scalars,
    nil,
    { z: shared, a: shared },
    ...Array.from({ length: 1000 }, () => value()),
  ])
    assert.equal(canonical(input), reference(input));
  assert.equal(
    canonical({ z: 1, a: { y: 2, b: 3 } }),
    '{"a":{"b":3,"y":2},"z":1}',
  );
});
test("canonical object construction avoids entry tuple materialization", () => {
  const input = {
      z: [{ y: 2, a: 1 }],
      ["__proto__"]: { nested: true },
      constructor: "data",
    },
    expected = reference(input);
  const fromEntries = Object.fromEntries;
  Object.fromEntries = () => {
    throw Error("redundant entry tuples");
  };
  try {
    assert.equal(canonical(input), expected);
  } finally {
    Object.fromEntries = fromEntries;
  }
});

test("canonical output shadows inherited setters/read-only properties without invoking them", () => {
  const key = "__manifold_canonical_probe__",
    input = { [key]: "own data" };
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, key);
  let invoked = false;
  try {
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      set() {
        invoked = true;
      },
      get() {
        invoked = true;
        throw Error("inherited getter");
      },
    });
    assert.equal(canonical(input), reference(input));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value: "inherited",
      writable: false,
    });
    assert.equal(canonical(input), reference(input));
  } finally {
    if (prior) Object.defineProperty(Object.prototype, key, prior);
    else delete Object.prototype[key];
  }
  assert.equal(invoked, false);
});
test("canonical data-property descriptors do not inherit get/set pollution", () => {
  for (const key of ["get", "set"]) {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, key);
    try {
      Object.defineProperty(Object.prototype, key, {
        __proto__: null,
        value: undefined,
        configurable: true,
      });
      assert.throws(
        () => Object.defineProperty({}, "constructor", { value: 1 }),
        TypeError,
        "ordinary descriptor literals inherit the polluted accessor slot",
      );
      const input = { constructor: 1, ["__proto__"]: { own: true } };
      assert.equal(canonical(input), reference(input));
    } finally {
      delete Object.prototype[key];
      if (prior) Object.defineProperty(Object.prototype, key, prior);
    }
  }
});

test("canonical builder preserves Proxy read order, copied prototypes and injected toJSON behavior", () => {
  function input(log) {
    let reflections = 0;
    const target = { z: 1, a: 2 };
    const toJSON = function (key) {
      const property = Object.getOwnPropertyDescriptor(this, "a");
      return {
        key,
        prototype: Object.getPrototypeOf(this) === Object.prototype,
        keys: Object.keys(this),
        descriptor: [
          property.enumerable,
          property.writable,
          property.configurable,
        ],
        value: this.a,
      };
    };
    return new Proxy(target, {
      ownKeys() {
        log.push("keys");
        return ++reflections === 1 ? ["z", "a"] : ["z", "a", "toJSON"];
      },
      getOwnPropertyDescriptor(object, key) {
        log.push("descriptor:" + key);
        return key === "toJSON"
          ? {
              value: toJSON,
              configurable: true,
              enumerable: true,
              writable: true,
            }
          : Reflect.getOwnPropertyDescriptor(object, key);
      },
      get(object, key) {
        log.push("get:" + key);
        return key === "toJSON" ? toJSON : Reflect.get(object, key);
      },
    });
  }
  const oldLog = [],
    newLog = [];
  assert.equal(canonical(input(newLog)), reference(input(oldLog)));
  assert.deepEqual(newLog, oldLog);
  for (const key of [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ]) {
    const source = { [key]: { a: 1 } };
    assert.equal(canonical(source), reference(source));
  }
});
