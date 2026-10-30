import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { storedEdges } from "../src/local-store.ts";
import { json, canonical } from "../src/value.ts";
import { recordWriter } from "../src/record-graph.ts";
const a = "sha256:" + "a".repeat(64),
  b = "sha256:" + "b".repeat(64);
const encode = (data, assets = []) =>
  JSON.stringify({ format: "manifold-local-chunk", version: 1, data, assets });
const hash = async (text) =>
  "sha256:" + createHash("sha256").update(text).digest("hex");
function compare(text) {
  const data = JSON.parse(text).data;
  let failure;
  try {
    json(data);
  } catch (error) {
    failure = error;
  }
  if (failure)
    assert.throws(() => storedEdges(text), {
      name: failure.name,
      message: failure.message,
    });
  else assert.deepEqual(storedEdges(text).data, data);
}
test("parsed record checks match full JSON validation for seeded trees, escaping, numeric overflow and exact depth boundaries", () => {
  let seed = 0x814a;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 8;
  };
  const scalar = [
    null,
    false,
    true,
    -0,
    1e308,
    5e-324,
    '😀\ud800\u0000\n\\"',
    "",
  ];
  function value(depth = 0) {
    if (depth === 5 || next() % 3 === 0) return scalar[next() % scalar.length];
    if (next() % 2)
      return Array.from({ length: next() % 5 }, () => value(depth + 1));
    const result = Object.create(null),
      keys = ["z", "1", "10", "2", "__proto__", "constructor", "toJSON", "😀"];
    for (let n = next() % 5; n > 0; n--)
      result[keys[next() % keys.length]] = value(depth + 1);
    return result;
  }
  for (let i = 0; i < 1000; i++)
    compare(encode({ kind: "value", value: value() }));
  for (const token of ["1e400", "-1e400", "1e308", "5e-324", "-0"]) {
    const text = encode({ kind: "value", value: { number: "TOKEN" } }).replace(
      '"TOKEN"',
      token,
    );
    compare(text);
    if (token === "-0")
      assert(Object.is(storedEdges(text).data.value.number, -0));
  }
  for (const count of [126, 127, 128, 129]) {
    let nested = 1;
    for (let i = 0; i < count; i++) nested = { next: nested };
    compare(encode({ kind: "value", value: nested }));
    if (count >= 128)
      assert.throws(
        () => storedEdges(encode({ kind: "value", value: nested })),
        /nesting limit/,
      );
    else
      assert.doesNotThrow(() =>
        storedEdges(encode({ kind: "value", value: nested })),
      );
  }
});
test("all physical record kinds retain exact encoded bytes, digests, links and asset restrictions", async () => {
  const cases = [
    [{ kind: "value", value: { z: 1, a: "😀" } }, [], [a]],
    [{ kind: "map", key: "k", value: a, left: null, right: b }, [a, b], []],
    [{ kind: "context", root: {}, heads: a, revisions: null }, [a], []],
    [{ kind: "alternative", id: "alt", label: "Alt", context: a }, [a], []],
    [
      { kind: "receipt", data: { kind: "typed@1" }, context: a, snapshot: b },
      [a, b],
      [a],
    ],
    [
      {
        kind: "bundle",
        schema: "test",
        version: 1,
        metadata: {},
        roots: { a, empty: null },
      },
      [a],
      [],
    ],
    [
      {
        kind: "workspace",
        document: "doc",
        id: "root",
        sequence: 1,
        evidenceSequence: 0,
        roots: { a, empty: null },
      },
      [a],
      [],
    ],
  ];
  for (const [data, links, assets] of cases) {
    const writer = recordWriter(new Map(), hash),
      id = await writer.pack(data, links, assets),
      chunk = writer.chunks.get(id);
    const expected = canonical({
      format: "manifold-local-chunk",
      version: 1,
      data,
      assets,
    });
    assert.equal(chunk.text, expected);
    assert.equal(id, await hash(expected));
    assert.deepEqual(storedEdges(chunk.text), { data, links, assets });
    assert.deepEqual(chunk.links, links);
    assert.deepEqual(chunk.assets, assets);
  }
  const writer = recordWriter(new Map(), hash),
    id = await writer.pack({ kind: "value", value: { z: 1, a: "😀" } });
  assert.equal(
    writer.chunks.get(id).text,
    '{"assets":[],"data":{"kind":"value","value":{"a":"😀","z":1}},"format":"manifold-local-chunk","version":1}',
  );
  for (const data of [
    { kind: "map", value: a, left: null, right: null },
    {
      kind: "receipt",
      data: { kind: "legacy" },
      context: null,
      snapshot: null,
    },
  ])
    assert.throws(
      () => storedEdges(encode(data, [a])),
      /Assets on non-value chunk/,
    );
  for (const text of [
    "{",
    encode(null),
    encode([]),
    encode({ kind: "unknown" }),
    encode({ kind: "value", surprise: 1 }),
    encode({ kind: "map", value: "not-a-digest", left: null, right: null }),
    encode({ kind: "value" }, ["bad"]),
  ])
    assert.throws(() => storedEdges(text));
  assert.deepEqual(
    storedEdges(JSON.stringify({ native: { assets: { [a]: "source" } } })),
    { links: [], assets: [a] },
  );
});
test("fresh parsed records avoid descriptor rescans while still rejecting numeric overflow", () => {
  const text = encode({
    kind: "value",
    value: { points: [{ x: 1, y: 2 }], text: "😀" },
  });
  const single = Object.getOwnPropertyDescriptor,
    bulk = Object.getOwnPropertyDescriptors;
  Object.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptors = () => {
    throw Error("redundant parsed descriptor scan");
  };
  let result;
  try {
    result = storedEdges(text);
    assert.throws(
      () => storedEdges(text.replace('"x":1', '"x":1e400')),
      /Nonfinite JSON/,
    );
  } finally {
    Object.getOwnPropertyDescriptor = single;
    Object.getOwnPropertyDescriptors = bulk;
  }
  assert.equal(result.data.value.points[0].x, 1);
});

test("writer validates edges from the encoded bytes, not a mutable pre-serialization object", () => {
  let hashes = 0;
  const writer = recordWriter(new Map(), async (text) => {
    hashes++;
    return hash(text);
  });
  let reflections = 0;
  const target = { kind: "value", value: 1 };
  const toJSON = () => ({
    kind: "map",
    key: "hidden",
    value: a,
    left: null,
    right: null,
  });
  const data = new Proxy(target, {
    ownKeys() {
      return ++reflections === 1
        ? ["kind", "value"]
        : ["kind", "value", "toJSON"];
    },
    getOwnPropertyDescriptor(object, key) {
      return key === "toJSON"
        ? {
            value: toJSON,
            enumerable: true,
            configurable: true,
            writable: true,
          }
        : Reflect.getOwnPropertyDescriptor(object, key);
    },
    get(object, key) {
      return key === "toJSON" ? toJSON : Reflect.get(object, key);
    },
  });
  assert.throws(() => writer.pack(data), /Declared record links/);
  assert.equal(hashes, 0);
  assert.equal(writer.chunks.size, 0);
});
