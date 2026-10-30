/** Authored arrangements use ordinary records and pinned scene revisions, not another state owner. */
import * as f from "@manifold/foundation";
import {
  emptyScene,
  restoreScene,
  validateScene,
  type CanvasScene,
  type CanvasTool,
  type Viewpoint,
} from "./canvasScene.ts";
import { sameJson } from "./immutableJson.ts";
export const SCENE_ITEM = "canvas:scene";
/** Includes qualified references and unique pinned scene metadata, not repeated UI materializations. */
export const MAX_SCENE_BYTES = 2 * 1024 * 1024;
type Kind = "index" | "group" | "tool" | "viewpoint";
type Index = Omit<CanvasScene, "groups" | "tools" | "viewpoints"> & {
  groups: string[];
  tools: string[];
  viewpoints: string[];
};
type StoredView = Omit<Viewpoint, "groups" | "tools"> & {
  groups: string[];
  tools: string[];
};
type Body = {
  document: string;
  value: f.Json;
  bindings: Record<string, f.Reference>;
};
const schema = (kind: Kind) => "canvas-scene-" + kind + "@1";
const item = (kind: Kind, id: string) =>
  kind === "index" ? SCENE_ITEM : "canvas:scene:" + kind + ":" + id;
const json = (value: unknown) => value as f.Json;
const checked = new WeakMap<object, Kind>();
function ids(value: unknown, limit: number): asserts value is string[] {
  f.assert(
    Array.isArray(value) && value.length <= limit,
    "Invalid scene collection",
  );
  for (const id of value) {
    f.identity(id);
    f.assert(id.length <= 101, "Scene identity too long");
  }
  f.assert(new Set(value).size === value.length, "Duplicate scene identity");
}
function footprint(kind: Kind, value: unknown): string[] {
  const keys = new Set<string>();
  // Representation IDs are layout links, not engineering dependencies.
  for (const context of Object.values(
    (value as { pins?: Record<string, string> }).pins ?? {},
  ))
    keys.add("context:" + context);
  if (kind === "index") {
    const index = value as Index;
    for (const [key, family] of [
      ["groups", "group"],
      ["tools", "tool"],
      ["viewpoints", "viewpoint"],
    ] as const)
      for (const id of index[key]) keys.add(family + ":" + id);
  } else if (kind === "tool") {
    const tool = value as CanvasTool;
    keys.add("object:" + tool.object);
    if (tool.artifact) keys.add("artifact:" + tool.artifact);
    if (tool.context) keys.add("context:" + tool.context);
  } else if (kind === "viewpoint") {
    const view = value as StoredView;
    if (view.scope) keys.add("scope:" + view.scope);
    for (const id of view.groups) keys.add("capture-group:" + id);
    for (const id of view.tools) keys.add("capture-tool:" + id);
  }
  return [...keys].sort();
}

function validateBody(kind: Kind, raw: f.Json): asserts raw is f.Json & Body {
  f.assert(f.object(raw), "Invalid scene record");
  if (checked.get(raw) === kind) return;
  f.fields(raw, ["document", "value", "bindings"]);
  f.identity(raw.document);
  f.assert(f.object(raw.value) && f.object(raw.bindings), "Invalid scene body");
  const value = raw.value;
  if (kind === "index") {
    f.fields(value, [
      "version",
      "groups",
      "tools",
      "viewpoints",
      "closed",
      "pins",
    ]);
    ids(value.groups, 32);
    ids(value.tools, 24);
    ids(value.viewpoints, 12);
    validateScene({ ...value, groups: [], tools: [], viewpoints: [] });
  } else if (kind === "group") {
    f.fields(value, ["id", "name", "members", "layout", "collapsed", "auto"]);
    validateScene({ ...emptyScene(), groups: [value] });
  } else if (kind === "tool") {
    f.fields(value, [
      "id",
      "editor",
      "object",
      "artifact",
      "context",
      "at",
      "width",
      "height",
      "collapsed",
    ]);
    validateScene({ ...emptyScene(), tools: [value] });
  } else {
    f.fields(value, [
      "id",
      "name",
      "camera",
      "scope",
      "positions",
      "groups",
      "tools",
      "closed",
      "pins",
    ]);
    ids(value.groups, 32);
    ids(value.tools, 24);
    validateScene({
      ...emptyScene(),
      viewpoints: [{ ...value, groups: [], tools: [] }],
    });
  }
  const keys = footprint(kind, value);
  f.assert(
    sameJson(Object.keys(raw.bindings).sort(), keys),
    "Incomplete scene bindings",
  );
  for (const [key, ref] of Object.entries(raw.bindings)) {
    f.validateReference(ref);
    f.assert(
      ref.document === raw.document &&
        sameJson(ref.selector, f.wholeSelector) &&
        ref.selection.kind === (key.startsWith("capture-") ? "pin" : "follow"),
      "Invalid scene selection",
    );
  }
  if (f.deeplyFrozen(raw)) checked.set(raw, kind);
}
export const sceneSchemas: readonly f.Schema[] = (
  ["index", "group", "tool", "viewpoint"] as const
).map((kind) => ({
  id: schema(kind),
  validate: (body) => validateBody(kind, body),
  references(body) {
    validateBody(kind, body);
    return Object.values(body.bindings);
  },
  assets: () => [],
  project(body) {
    validateBody(kind, body);
    return { type: schema(kind), value: body.value };
  },
}));
function node(
  doc: f.Document,
  ref: f.Reference,
  kind: Kind,
): f.Revision & { body: Body } {
  const revision =
    ref.selection.kind === "pin"
      ? doc.revisions.get(ref.selection.revision)
      : f.current(doc, ref.item);
  f.assert(
    revision?.item === ref.item && revision.schema === schema(kind),
    "Missing scene component",
  );
  validateBody(kind, revision.body);
  return revision as f.Revision & { body: Body };
}
function resolve(
  doc: f.Document,
  key: string,
  prior?: f.Reference,
): f.Reference {
  const split = key.indexOf(":"),
    kind = key.slice(0, split),
    id = key.slice(split + 1);
  if (["group", "tool", "viewpoint"].includes(kind))
    return f.reference(doc.document, item(kind as Kind, id));
  if (kind === "context" || kind === "artifact" || kind === "scope") {
    const prefix = kind === "scope" ? "model" : kind;
    f.assert(doc.known.get(prefix + ":" + id), "Unknown scene " + kind);
    return f.reference(doc.document, prefix + ":" + id);
  }
  for (const candidate of [
    ...["region", "plot", "model", "relation"].map(
      (prefix) => prefix + ":" + id,
    ),
    id,
  ])
    if (doc.known.get(candidate)) return f.reference(doc.document, candidate);
  f.assert(
    prior && prior.document === doc.document && doc.known.get(prior.item),
    "Unknown scene target " + id,
  );
  return prior;
}
const materialized = new WeakMap<
  object,
  {
    current: readonly f.Revision[];
    pinned: readonly f.Revision[];
    value: CanvasScene;
  }
>();
const weights = new WeakMap<object, number>();
export function readScene(doc: f.Document): CanvasScene {
  const root = f.current(doc, SCENE_ITEM);
  if (!root) return f.freeze(emptyScene());
  f.assert(root.schema === schema("index"), "Unsupported scene index");
  validateBody("index", root.body);
  const rootBody = root.body,
    index = rootBody.value as unknown as Index,
    revisions: f.Revision[] = [root];
  const read = (kind: Kind, id: string, body: Body, prefix: string = kind) => {
    const r = node(doc, body.bindings[prefix + ":" + id]!, kind);
    f.assert(
      r.body.document === doc.document &&
        f.object(r.body.value) &&
        r.body.value.id === id &&
        r.item === item(kind, id),
      "Scene component binding mismatch",
    );
    revisions.push(r);
    return r.body;
  };
  const groupBodies = index.groups.map((id) => read("group", id, rootBody)),
    toolBodies = index.tools.map((id) => read("tool", id, rootBody)),
    viewBodies = index.viewpoints.map((id) => read("viewpoint", id, rootBody));
  const current = [...revisions],
    cached = materialized.get(root);
  if (
    cached &&
    current.length === cached.current.length &&
    current.every((revision, index) => revision === cached.current[index]) &&
    cached.pinned.every(
      (revision) => doc.revisions.get(revision.id) === revision,
    )
  )
    return cached.value;
  const viewpoints = viewBodies.map((body) => {
    const value = body.value as unknown as StoredView;
    return {
      ...value,
      groups: value.groups.map(
        (id) => read("group", id, body, "capture-group").value,
      ),
      tools: value.tools.map(
        (id) => read("tool", id, body, "capture-tool").value,
      ),
    };
  });
  const value = f.freeze({
    ...index,
    groups: groupBodies.map((b) => b.value),
    tools: toolBodies.map((b) => b.value),
    viewpoints,
  }) as unknown as CanvasScene;
  for (const groups of [
    value.groups,
    ...value.viewpoints.map((view) => view.groups),
  ]) {
    const members = groups.flatMap((group) => group.members);
    f.assert(new Set(members).size === members.length, "Scene groups overlap");
    f.assert(
      !groups.some((group) =>
        group.members.some((id) => groups.some((entry) => entry.id === id)),
      ),
      "Nested scene groups are unsupported",
    );
  }
  for (const arrangement of [value, ...value.viewpoints]) {
    const allIds = [
      ...arrangement.groups,
      ...arrangement.tools,
      ...value.viewpoints,
    ].map((part) => part.id);
    f.assert(
      new Set(allIds).size === allIds.length,
      "Scene identity collision",
    );
  }
  let bytes = 0;
  for (const revision of new Set(revisions)) {
    let weight = weights.get(revision);
    if (weight === undefined) {
      weight = f.byteLength(f.canonical(json(revision)));
      weights.set(revision, weight);
    }
    bytes += weight;
  }
  f.assert(bytes <= MAX_SCENE_BYTES, "Scene metadata budget exceeded");
  function bindings(kind: Kind, body: Body) {
    f.assert(body.document === doc.document, "Scene document mismatch");
    for (const key of footprint(kind, body.value)) {
      if (key.startsWith("capture-")) continue;
      const ref = body.bindings[key]!,
        expected = resolve(doc, key, ref);
      f.assert(sameJson(ref, expected), "Scene target binding mismatch");
    }
  }
  bindings("index", root.body);
  groupBodies.forEach((body) => bindings("group", body));
  toolBodies.forEach((body) => bindings("tool", body));
  viewBodies.forEach((body) => bindings("viewpoint", body));
  for (const revision of revisions) {
    if (revision.schema === schema("tool"))
      bindings("tool", revision.body as unknown as Body);
  }
  materialized.set(root, {
    current,
    pinned: [...new Set(revisions.slice(current.length))],
    value,
  });
  return value;
}
export function validateSceneDocument(doc: f.Document) {
  const value = readScene(doc),
    entityIds = new Set(
      [
        ...value.groups,
        ...value.tools,
        ...value.viewpoints,
        ...value.viewpoints.flatMap((view) => [...view.groups, ...view.tools]),
      ].map((entry) => entry.id),
    ),
    expected = new Set([
      SCENE_ITEM,
      ...value.groups.map((g) => item("group", g.id)),
      ...value.tools.map((t) => item("tool", t.id)),
      ...value.viewpoints.map((v) => item("viewpoint", v.id)),
    ]);
  for (const id of entityIds) {
    f.assert(
      !doc.allocated.views.get(id),
      "Scene identity collides with a current or retired representation",
    );
    for (const candidate of [
      id,
      ...["region", "plot", "model", "relation", "artifact"].map(
        (prefix) => prefix + ":" + id,
      ),
    ])
      f.assert(
        !doc.known.get(candidate),
        "Scene identity collides with content",
      );
  }
  for (const [, view] of doc.views.entries())
    f.assert(
      !(
        view.renderer === "canvas-artifact-view@1" &&
        f.object(view.reference.selector) &&
        entityIds.has(String(view.reference.selector.id))
      ),
      "Scene identity collides with representation",
    );
  for (const [id, entry] of doc.items.entries())
    if (
      entry.revision &&
      doc.revisions.get(entry.revision)!.schema.startsWith("canvas-scene-")
    )
      f.assert(expected.has(id), "Unindexed scene component");
}
export function sceneCommands(
  doc: f.Document,
  scene: CanvasScene,
): readonly f.Command[] {
  validateScene(scene);
  const result: f.Command[] = [],
    selected = new Map<string, f.Revision>(),
    historical: f.Revision[] = [];
  const previousViews = new Map(
    readScene(doc).viewpoints.map((view) => [view.id, view]),
  );
  const choose = (kind: Kind, id: string, value: unknown) => {
    const key = item(kind, id),
      old = f.current(doc, key),
      prior = old?.body as unknown as Body | undefined;
    const bindings = Object.fromEntries(
      footprint(kind, value).map((name) => [
        name,
        resolve(doc, name, prior?.bindings[name]),
      ]),
    );
    return upsert(kind, id, {
      document: doc.document,
      value: json(value),
      bindings,
    });
  };
  function upsert(kind: Kind, id: string, body: Body) {
    const key = item(kind, id),
      old = f.current(doc, key);
    if (old?.schema === schema(kind) && sameJson(old.body, body)) {
      selected.set(key, old);
      return old;
    }
    const retained =
      !old && doc.known.get(key)
        ? [...doc.revisions.entries()]
            .map(([, r]) => r)
            .find((r) => r.item === key && r.schema === schema(kind))
        : undefined;
    if (!old && doc.known.get(key)) {
      f.assert(
        retained,
        "Scene identity was retired without a retained capture",
      );
      result.push({
        kind: "restore",
        item: key,
        revision: retained.id,
        label: id,
      });
      if (sameJson(retained.body, body)) {
        selected.set(key, retained);
        return retained;
      }
    }
    const revision: f.Revision = {
      id: "scene-revision:" + crypto.randomUUID(),
      item: key,
      schema: schema(kind),
      required: true,
      body: json(body),
    };
    result.push(
      old || retained
        ? { kind: "revise", item: key, revision }
        : { kind: "create", item: key, label: id, revision },
    );
    selected.set(key, revision);
    return revision;
  }
  scene.groups.forEach((group) => choose("group", group.id, group));
  scene.tools.forEach((tool) => choose("tool", tool.id, tool));
  function capture(kind: "group" | "tool", value: { id: string }): f.Reference {
    const key = item(kind, value.id),
      current = selected.get(key);
    const match = (r: f.Revision) => {
      if (
        r.item !== key ||
        r.schema !== schema(kind) ||
        !sameJson((r.body as unknown as Body).value, value)
      )
        return false;
      const body = r.body as unknown as Body;
      return footprint(kind, value).every((name) =>
        sameJson(body.bindings[name], resolve(doc, name, body.bindings[name])),
      );
    };
    let revision =
      current && match(current)
        ? current
        : [
            ...historical,
            ...[...doc.revisions.entries()].map(([, r]) => r),
          ].find(match);
    if (!revision) {
      const old = current ?? f.current(doc, key),
        retained =
          !old && doc.known.get(key)
            ? [...doc.revisions.entries()]
                .map(([, r]) => r)
                .find((r) => r.item === key)
            : undefined;
      if (!old && doc.known.get(key)) {
        f.assert(retained, "Named arrangement identity has no retained source");
        result.push({
          kind: "restore",
          item: key,
          revision: retained.id,
          label: value.id,
        });
      }
      const body: Body = {
        document: doc.document,
        value: json(value),
        bindings: Object.fromEntries(
          footprint(kind, value).map((name) => [name, resolve(doc, name)]),
        ),
      };
      revision = {
        id: "scene-revision:" + crypto.randomUUID(),
        item: key,
        schema: schema(kind),
        required: true,
        body: json(body),
      };
      result.push(
        old || retained
          ? { kind: "revise", item: key, revision }
          : { kind: "create", item: key, label: value.id, revision },
      );
      result.push({ kind: "delete", item: key });
      if (old)
        result.push({
          kind: "restore",
          item: key,
          revision: old.id,
          label: value.id,
        });
      historical.push(revision);
    }
    return {
      ...f.reference(doc.document, key),
      selection: { kind: "pin", revision: revision.id },
    };
  }
  for (const view of scene.viewpoints) {
    const old = f.current(doc, item("viewpoint", view.id));
    if (old && sameJson(previousViews.get(view.id), view)) {
      selected.set(old.item, old);
      continue;
    }
    const value: StoredView = {
      ...view,
      groups: view.groups.map((g) => g.id),
      tools: view.tools.map((t) => t.id),
    };
    const bindings: Record<string, f.Reference> = {};
    for (const name of footprint("viewpoint", value)) {
      const split = name.indexOf(":"),
        kind = name.slice(0, split),
        id = name.slice(split + 1);
      bindings[name] =
        kind === "capture-group"
          ? capture("group", view.groups.find((g) => g.id === id)!)
          : kind === "capture-tool"
            ? capture("tool", view.tools.find((t) => t.id === id)!)
            : resolve(
                doc,
                name,
                (old?.body as unknown as Body | undefined)?.bindings[name],
              );
    }
    upsert("viewpoint", view.id, {
      document: doc.document,
      value: json(value),
      bindings,
    });
  }
  const { closed, pins, ...base } = scene;
  choose("index", SCENE_ITEM, {
    ...base,
    ...(closed?.length ? { closed } : {}),
    ...(pins && Object.keys(pins).length ? { pins } : {}),
    groups: scene.groups.map((g) => g.id),
    tools: scene.tools.map((t) => t.id),
    viewpoints: scene.viewpoints.map((v) => v.id),
  });
  for (const [id, entry] of doc.items.entries())
    if (
      entry.revision &&
      doc.revisions.get(entry.revision)!.schema.startsWith("canvas-scene-") &&
      !selected.has(id)
    )
      result.push({ kind: "delete", item: id });
  return result;
}
export function prepareSceneLoaded(
  loaded: f.Loaded,
  schemas: f.Schemas,
  legacy?: string,
): { loaded: f.Loaded; sceneError?: string } {
  if (f.current(loaded.document, SCENE_ITEM)) {
    validateSceneDocument(loaded.document);
    return { loaded };
  }
  for (const [, entry] of loaded.document.items.entries())
    if (entry.revision)
      f.assert(
        !loaded.document.revisions
          .get(entry.revision)!
          .schema.startsWith("canvas-scene-"),
        "Scene components require an index",
      );
  function prepare(scene: CanvasScene): f.Loaded {
    const document = f.prepare(
      loaded.document,
      "scene-import:" + crypto.randomUUID(),
      sceneCommands(loaded.document, scene),
      schemas,
    ).document;
    validateSceneDocument(document);
    return { ...loaded, document, original: undefined };
  }
  if (legacy) {
    try {
      return { loaded: prepare(restoreScene(legacy)) };
    } catch {
      return {
        loaded: prepare(emptyScene()),
        sceneError:
          "Saved canvas arrangements could not be attached to this workspace. Their raw copy is preserved.",
      };
    }
  }
  return { loaded: prepare(emptyScene()) };
}
