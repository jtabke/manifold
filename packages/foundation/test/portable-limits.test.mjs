import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as f from "../src/index.ts";
import { schemas, methods, hash } from "./helpers.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./portable.fixture.json", import.meta.url), "utf8"),
);
const tables = (e) => [
  e.document.items,
  e.document.revisions,
  e.document.views,
  e.document.alternatives,
  e.contexts,
  e.snapshots,
  e.assets,
];
const count = (e) =>
  e.receipts.length +
  tables(e).reduce((n, table) => n + Object.keys(table).length, 0);
const decode = (e, limits) =>
  f.decode(JSON.stringify(e), schemas, methods, hash, limits);

test("native record limits cover every table and the aggregate, before hashing", async () => {
  const maxRecords = count(fixture);
  await decode(fixture, { maxRecords });
  await assert.rejects(
    decode(fixture, { maxRecords: maxRecords - 1 }),
    /Native record budget/,
  );
  for (let index = 0; index < tables(fixture).length; index++) {
    const e = structuredClone(fixture);
    tables(e)[index].extra = {};
    let hashes = 0;
    await assert.rejects(
      f.decode(
        JSON.stringify(e),
        schemas,
        methods,
        async (text) => {
          hashes++;
          return hash(text);
        },
        { maxRecords },
      ),
      /Native record budget/,
    );
    assert.equal(hashes, 0);
  }
  await assert.rejects(
    decode(fixture, { maxReceipts: 1 }),
    /Native receipt budget/,
  );
  for (const name of ["maxBytes", "maxRecords", "maxReceipts", "maxNodes"])
    await assert.rejects(
      decode(fixture, { [name]: NaN }),
      /Invalid native read limit|Native document byte budget/,
    );
});

test("native snapshots and outcomes have controlled depth and node limits before cloning", async () => {
  let nested = {};
  for (let i = 0; i < 3000; i++) nested = { nested };
  for (const location of ["snapshot", "outcome"]) {
    const e = structuredClone(fixture);
    if (location === "snapshot") e.snapshots.extra = nested;
    else e.receipts[0].outcome = nested;
    await assert.rejects(
      decode(e),
      (error) =>
        !(error instanceof RangeError) &&
        /JSON nesting limit/.test(error.message),
    );
  }
  await assert.rejects(decode(fixture, { maxNodes: 10 }), /JSON node budget/);
  await decode(fixture, { maxNodes: 10000 });
  const unsafe = {
    ...fixture,
    get unexpected() {
      throw Error("getter invoked");
    },
  };
  await assert.rejects(
    f.decodeEnvelope(unsafe, schemas, methods, hash),
    /Accessors/,
  );
});

test("object codecs match string codecs without retaining a serialized writable copy", async () => {
  const text = JSON.stringify(fixture);
  const fromText = await f.decode(text, schemas, methods, hash);
  const fromObject = await f.decodeEnvelope(fixture, schemas, methods, hash);
  const envelope = f.encodeEnvelope(
    fromObject.document,
    fromObject.receipts,
    fromObject.resources,
    schemas,
  );
  assert.equal(
    JSON.stringify(envelope),
    f.encode(fromText.document, fromText.receipts, fromText.resources, schemas),
  );
  assert.equal(fromObject.original, undefined);
  assert.equal(fromText.original, text);
  const reopened = await f.decodeEnvelope(envelope, schemas, methods, hash);
  assert.equal(reopened.receipts.length, fromText.receipts.length);
});

test("object decode owns its input before asynchronous asset verification", async () => {
  const e = structuredClone(fixture);
  const pending = f.decodeEnvelope(e, schemas, methods, hash);
  e.receipts[0].outcome = { status: "invalid" };
  e.snapshots.s0.inputs.force.scalar.value = 999;
  e.document.items.force.label = "mutated";
  e.assets = {};
  const loaded = await pending;
  assert.equal(loaded.receipts[0].snapshot.inputs.force.scalar.value, 200);
  assert.equal(loaded.receipts[0].outcome.status, "success");
  assert.equal(loaded.document.items.get("force").label, "Applied force");
});

test("writable packages reject undeclared assets while opaque packages preserve original bytes", async () => {
  const e = structuredClone(fixture),
    unused = "unreferenced payload";
  e.assets[await hash(unused)] = unused;
  await assert.rejects(decode(e), /Unreferenced package asset/);
  e.document.revisions["draft-r1"] = {
    ...e.document.revisions["draft-r1"],
    schema: "future@9",
    required: false,
    body: { opaque: true },
  };
  const text = JSON.stringify(e, null, 2);
  const loaded = await f.decode(text, schemas, methods, hash);
  assert.equal(loaded.document.readOnly, true);
  assert.equal(
    f.encode(
      loaded.document,
      loaded.receipts,
      loaded.resources,
      schemas,
      loaded.original,
    ),
    text,
  );
  assert.throws(
    () =>
      f.encodeEnvelope(
        loaded.document,
        loaded.receipts,
        loaded.resources,
        schemas,
      ),
    /Preserve the original/,
  );
  const objectLoaded = await f.decodeEnvelope(e, schemas, methods, hash);
  assert.deepEqual(JSON.parse(objectLoaded.original), e);
});
