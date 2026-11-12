import { browserOptions } from "../../../scripts/browser.mjs";
/** Diagnostic workload of the shipped UI, not a hardware or latency acceptance claim. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  bundleRanges,
  summarize,
  unionMs,
} from "./drawing-publication-profile.mjs";
import { stopSaveTrace, windowMetrics } from "./drawing-save-trace.mjs";
import { cpus, platform, arch } from "node:os";
import { chromium, expect } from "@playwright/test";
import { drawingFixture } from "./drawing-fixture.mjs";
import {
  drawings,
  editDrawings,
  MAX_DRAWINGS,
} from "../src/regions/drawing.ts";
import {
  drawingGeometry,
  previewDrawings,
} from "../src/regions/drawingGeometry.ts";
import { archive } from "../src/regions/artifacts.ts";
import { readWorkspace } from "./browser-workspace.mjs";
import { canvasSourceDigest } from "../tools/canvas-source-digest.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const stats = (values) => {
  assert(values.length);
  const sorted = values.toSorted((a, b) => a - b);
  return {
    count: sorted.length,
    samples: values,
    median:
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
function geometryProfile(entries) {
  const scene = drawingGeometry(entries),
    ids = new Set(entries.map((e) => e.id));
  let checksum = 0,
    start = performance.now();
  for (const e of entries) checksum += scene.bounds(e).width;
  const materializeMs = performance.now() - start;
  const sample = (fn) => {
    const times = [];
    for (let i = 0; i < 15; i++) {
      start = performance.now();
      checksum += fn(i);
      if (i >= 3) times.push(performance.now() - start);
    }
    return stats(times);
  };
  const previews = (resize) => {
    const transform = scene.transform(ids, { x: 0, y: 0 }, resize);
    return sample((i) => {
      const next = previewDrawings(entries, transform({ x: i + 1, y: i + 1 })),
        projected = drawingGeometry(next);
      return next.reduce((n, e) => n + projected.bounds(e).width, 0);
    });
  };
  const selectionBoundsMs = sample(() => scene.selectionBounds(ids).width);
  const eraserSweepMs = sample(
    () =>
      entries.filter((e) =>
        scene.sweptHit(e, { x: 0, y: 140 }, { x: 5000, y: 140 }, 9),
      ).length,
  );
  const longest = entries.reduce((a, b) =>
    a.mark.points.length > b.mark.points.length ? a : b,
  );
  const box = scene.bounds(longest),
    from = { x: box.x + box.width, y: box.y + box.height + 9 },
    to = { x: from.x + 9, y: from.y };
  assert.equal(
    scene.sweptHit(longest, from, to, 9),
    false,
    "near-miss fixture exercises the longest stroke without an early successful hit",
  );
  const longStrokeNearMissMs = sample(() =>
    Number(scene.sweptHit(longest, from, to, 9)),
  );
  const movePreviewMs = previews(false),
    resizePreviewMs = previews(true);
  return {
    materializeMs,
    selectionBoundsMs,
    eraserSweepMs,
    longStrokeNearMissMs,
    movePreviewMs,
    resizePreviewMs,
    checksum,
  };
}
function ownerProfile(session, entries) {
  const transform = drawingGeometry(entries).transform(
    new Set(entries.map((e) => e.id)),
    { x: 0, y: 0 },
    true,
  );
  const commit = [],
    undo = [];
  for (let i = 0; i < 3; i++) {
    const edits = transform({ x: i + 10, y: i + 10 });
    let start = performance.now();
    editDrawings(session, edits);
    const ms = performance.now() - start;
    start = performance.now();
    session.undo();
    const undoMs = performance.now() - start;
    if (i) {
      commit.push(ms);
      undo.push(undoMs);
    }
  }
  assert.deepEqual(drawings(session.document), entries);
  return { resizeCommitMs: stats(commit), undoMs: stats(undo) };
}
const rows = [],
  errors = [];
const replicates = Number(process.env.MANIFOLD_DRAWING_PROFILE_REPLICATES ?? 1);
assert(Number.isInteger(replicates) && replicates >= 1 && replicates <= 3);
const attribution = process.env.MANIFOLD_DRAWING_PROFILE_CPU === "1";
const trace = process.env.MANIFOLD_DRAWING_PROFILE_TRACE === "1";
assert(!(trace && attribution), "Separate trace and CPU-attribution runs");
const counts = process.env.MANIFOLD_DRAWING_PROFILE_MARKS
  ? [Number(process.env.MANIFOLD_DRAWING_PROFILE_MARKS)]
  : [100, 1000, MAX_DRAWINGS - 1];
assert(counts.every((n) => [100, 1000, MAX_DRAWINGS - 1].includes(n)));
let version;
for (let replicate = 0; replicate < replicates; replicate++)
  for (const count of counts) {
    console.log(`Drawing profile ${count}/${replicate + 1}: source fixture`);
    const { session, ids, points, longestStroke } = drawingFixture(count);
    const entries = drawings(session.document),
      geometry = geometryProfile(entries);
    console.log(
      `Drawing profile ${count}/${replicate + 1}: source geometry complete`,
    );
    const bounds = drawingGeometry(entries).selectionBounds(new Set(ids));
    const source = archive(session.native());
    const owner = ownerProfile(session, entries);
    session.dispose();
    console.log(`Drawing profile ${count}/${replicate + 1}: opening browser`);
    const browser = await chromium.launch({
      ...browserOptions(),
      headless: true,
    });
    version = browser.version();
    try {
      const context = await browser.newContext({
        viewport: { width: 1600, height: 1100 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on("pageerror", (error) => errors.push(error.message));
      let jobs = 0;
      page.on("request", (r) => {
        if (r.url().endsWith("/api/artifact-sample")) jobs++;
      });
      await page.addInitScript(
        (source) =>
          localStorage.setItem("manifold.artifact-experiment.v1", source),
        source,
      );
      const started = performance.now();
      await page.goto(base);
      const saved = () =>
        expect(page.getByLabel("Workspace save status")).toHaveText(
          "Saved locally",
        );
      await saved();
      await expect(page.locator("[data-drawing-id]")).toHaveCount(count);
      const paint = () =>
        page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
      await page.getByRole("button", { name: "Fit page", exact: true }).click();
      await paint();
      const openToFramesMs = performance.now() - started;
      const baseline = await readWorkspace(page);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      const resizeCpu = [],
        translateCpu = [],
        traces = [];
      let ranges;
      if (attribution) {
        const asset = await page
          .locator('script[type="module"][src]')
          .first()
          .getAttribute("src");
        ranges = bundleRanges(
          await readFile(
            new URL("../dist/" + asset.replace(/^\//, ""), import.meta.url),
            "utf8",
          ),
        );
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
      }
      const heap = async () => {
        await cdp.send("HeapProfiler.collectGarbage");
        return (await cdp.send("Performance.getMetrics")).metrics.find(
          (m) => m.name === "JSHeapUsedSize",
        ).value;
      };
      const initialHeapBytes = await heap();
      await page.evaluate((attribution) => {
        window.drawingPhase = null;
        window.drawingPass = null;
        window.drawingTransactions = [];
        window.drawingSaved = [];
        const status = document.querySelector(
          '[aria-label="Workspace save status"]',
        );
        let lastStatus = status.textContent;
        new MutationObserver(() => {
          const next = status.textContent,
            release = window.drawingRelease;
          if (
            next !== lastStatus &&
            next === "Saved locally" &&
            release &&
            window.drawingPhase === release.phase &&
            window.drawingPass === release.pass
          ) {
            const end = performance.now();
            window.drawingSaved.push({
              phase: release.phase,
              pass: release.pass,
              start: release.start,
              end,
              ms: end - release.start,
            });
          }
          lastStatus = next;
        }).observe(status, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        if (attribution) {
          const transaction = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (...args) {
            const tx = transaction.apply(this, args);
            if (window.drawingPhase) {
              const span = {
                phase: window.drawingPhase,
                pass: window.drawingPass,
                stores: [...tx.objectStoreNames],
                mode: tx.mode,
                start: performance.now(),
              };
              window.drawingTransactions.push(span);
              tx.addEventListener(
                "complete",
                () => {
                  span.end = performance.now();
                },
                { once: true },
              );
              tx.addEventListener(
                "abort",
                () => {
                  span.end = performance.now();
                  span.aborted = true;
                },
                { once: true },
              );
            }
            return tx;
          };
        }
        window.drawingFrames = [];
        window.drawingLongTasks = [];
        window.drawingFrameGaps = [];
        let lastFrame = performance.now();
        const heartbeat = (now) => {
          if (window.drawingPhase === "resize")
            window.drawingFrameGaps.push({
              start: lastFrame,
              ms: now - lastFrame,
            });
          lastFrame = now;
          requestAnimationFrame(heartbeat);
        };
        requestAnimationFrame(heartbeat);
        window.drawingIo = {};
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...args) {
          const request = get.apply(this, args),
            phase = window.drawingPhase;
          if (phase) {
            const key = phase + ":" + this.name;
            const io = (window.drawingIo[key] ??= {
              reads: 0,
              pending: 0,
              maxPending: 0,
            });
            io.reads++;
            io.maxPending = Math.max(io.maxPending, ++io.pending);
            const complete = () => io.pending--;
            request.addEventListener("success", complete, { once: true });
            request.addEventListener("error", complete, { once: true });
          }
          return request;
        };
        for (const event of ["pointermove", "pointerup"])
          document.addEventListener(
            event,
            (e) => {
              if (
                (event === "pointermove" && !e.buttons) ||
                !e.target.closest("[data-drawing-surface]") ||
                !window.drawingPhase
              )
                return;
              const phase = window.drawingPhase,
                pass = window.drawingPass,
                start = performance.now();
              if (event === "pointerup")
                window.drawingRelease = {
                  phase,
                  pass: window.drawingPass,
                  start,
                };
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  window.drawingFrames.push({
                    event,
                    phase,
                    pass,
                    start,
                    ms: performance.now() - start,
                  }),
                ),
              );
            },
            true,
          );
        new PerformanceObserver((list) => {
          for (const task of list.getEntries())
            window.drawingLongTasks.push({
              start: task.startTime,
              ms: task.duration,
            });
        }).observe({ type: "longtask", buffered: false });
      }, attribution);
      const phase = (name, pass = null) =>
        page.evaluate(
          ({ name, pass }) => {
            window.drawingPhase = name;
            window.drawingPass = pass;
          },
          { name, pass },
        );
      const toolbar = page.getByRole("toolbar", {
        name: "Drawing and diagram tools",
      });
      const tool = (name) =>
        toolbar.getByRole("button", { name, exact: true }).click();
      const screen = (p) =>
        page.locator(".er-canvas").evaluate((node, p) => {
          const rect = node.getBoundingClientRect(),
            zoom = Number(
              node
                .querySelector(".er-paper")
                .style.transform.match(/scale\(([^)]+)\)/)[1],
            );
          return {
            x:
              rect.left +
              p.x * zoom -
              node.scrollLeft +
              Number(node.dataset.canvasOriginX),
            y:
              rect.top +
              p.y * zoom -
              node.scrollTop +
              Number(node.dataset.canvasOriginY),
          };
        }, p);
      const move = async (start, dx, dy, steps = 12) => {
        for (let i = 1; i <= steps; i++) {
          await page.mouse.move(
            start.x + (dx * i) / steps,
            start.y + (dy * i) / steps,
          );
          await paint();
        }
      };
      const undo = async () => {
        await phase(null);
        await page.keyboard.press("ControlOrMeta+z");
        await saved();
        await paint();
      };
      const durable = { draw: [], move: [], resize: [], translate: [] },
        selection = [];
      // Each phase has one warmup and two measured gestures; accepted edits are undone.
      await tool("Pen");
      const canvas = await page.locator(".er-canvas").boundingBox();
      for (let pass = 0; pass < 3; pass++) {
        const at = { x: canvas.x + 700, y: canvas.y + 80 };
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await phase(pass ? "draw" : null);
        await move(at, 120, 15);
        const start = performance.now();
        await page.mouse.up();
        await saved();
        await paint();
        if (pass) durable.draw.push(performance.now() - start);
        await expect(page.locator("[data-drawing-id]")).toHaveCount(count + 1);
        await undo();
        await expect(page.locator("[data-drawing-id]")).toHaveCount(count);
      }
      await tool("Lasso drawings");
      const corner = await screen({ x: bounds.x, y: bounds.y }),
        far = await screen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        });
      const startCorner = { x: corner.x - 15, y: corner.y - 15 };
      for (let pass = 0; pass < 3; pass++) {
        await page.mouse.move(startCorner.x, startCorner.y);
        await page.mouse.down();
        await phase(pass ? "lasso" : null);
        for (const p of [
          { x: far.x + 15, y: startCorner.y },
          { x: far.x + 15, y: far.y + 15 },
          { x: startCorner.x, y: far.y + 15 },
          startCorner,
        ]) {
          await page.mouse.move(p.x, p.y, { steps: 3 });
          await paint();
        }
        const start = performance.now();
        await page.mouse.up();
        await paint();
        if (pass) selection.push(performance.now() - start);
        await expect(
          toolbar.getByRole("button", { name: "Duplicate drawings" }),
        ).toBeEnabled();
      }
      await tool("Select drawings");
      for (let pass = 0; pass < 3; pass++) {
        const h = await page.locator("[data-drawing-resize]").boundingBox();
        assert(h);
        const at = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await phase(pass ? "resize" : null, pass);
        await move(at, 6, 4);
        if (pass && trace && count === MAX_DRAWINGS - 1)
          await cdp.send("Tracing.start", {
            categories: "toplevel,devtools.timeline,v8.execute",
            transferMode: "ReturnAsStream",
          });
        if (pass && attribution) await cdp.send("Profiler.start");
        const start = performance.now();
        await page.mouse.up();
        await saved();
        await paint();
        if (pass) durable.resize.push(performance.now() - start);
        if (pass && attribution)
          resizeCpu.push(
            summarize((await cdp.send("Profiler.stop")).profile, ranges),
          );
        if (pass && trace && count === MAX_DRAWINGS - 1)
          traces.push(
            await stopSaveTrace(
              cdp,
              new URL(
                `../../../evidence/current/canvas/drawing-save-trace-${replicate + 1}-${pass}.json`,
                import.meta.url,
              ),
            ),
          );
        if (!pass) {
          const resized = await readWorkspace(page);
          assert.equal(
            resized.document.revisions.size - baseline.document.revisions.size,
            3 + count,
            "the lasso must resize every fixture mark; three earlier strokes are retained history",
          );
        }
        await undo();
      }
      console.log(
        `Drawing profile ${count}/${replicate + 1}: translation baseline`,
      );
      const translationBaseline = await readWorkspace(page);
      const translationEntries = drawings(translationBaseline.document);
      const groupStart = await screen({ x: 160, y: 140 });
      for (let pass = 0; pass < 3; pass++) {
        console.log(
          `Drawing profile ${count}/${replicate + 1}: translate ${pass}`,
        );
        await page.mouse.move(groupStart.x, groupStart.y);
        await page.mouse.down();
        await phase(pass ? "translate" : null, pass);
        if (pass && attribution) await cdp.send("Profiler.start");
        await move(groupStart, 8, 5);
        const start = performance.now();
        await page.mouse.up();
        await saved();
        await paint();
        if (pass) durable.translate.push(performance.now() - start);
        if (pass && attribution)
          translateCpu.push(
            summarize((await cdp.send("Profiler.stop")).profile, ranges),
          );
        if (!pass) {
          console.log(
            `Drawing profile ${count}/${replicate + 1}: verify translation`,
          );
          const moved = await readWorkspace(page),
            marks = drawings(moved.document);
          assert.equal(
            moved.document.revisions.size,
            translationBaseline.document.revisions.size,
            "translation must not revise mark bodies",
          );
          const dx = marks[0].view.x - translationEntries[0].view.x,
            dy = marks[0].view.y - translationEntries[0].view.y;
          assert(dx !== 0 && dy !== 0);
          for (let i = 0; i < marks.length; i++) {
            assert(
              Math.abs(marks[i].view.x - translationEntries[i].view.x - dx) <
                1e-6,
            );
            assert(
              Math.abs(marks[i].view.y - translationEntries[i].view.y - dy) <
                1e-6,
            );
            assert.deepEqual(marks[i].mark, translationEntries[i].mark);
          }
        }
        await undo();
      }
      console.log(
        `Drawing profile ${count}/${replicate + 1}: translation complete`,
      );
      const outside = { x: canvas.x + canvas.width - 20, y: canvas.y + 20 };
      await page.mouse.click(outside.x, outside.y);
      const shape = await screen({ x: 160, y: 140 });
      await page.mouse.click(shape.x, shape.y);
      for (let pass = 0; pass < 3; pass++) {
        await page.mouse.move(shape.x, shape.y);
        await page.mouse.down();
        await phase(pass ? "move" : null);
        await move(shape, 8, 5);
        const start = performance.now();
        await page.mouse.up();
        await saved();
        await paint();
        if (pass) durable.move.push(performance.now() - start);
        await undo();
      }
      console.log(
        `Drawing profile ${count}/${replicate + 1}: verify final state`,
      );
      const after = await readWorkspace(page);
      assert.deepEqual(
        drawings(after.document),
        drawings(baseline.document),
        "all measured gestures undo to the admitted authored baseline",
      );
      console.log(
        `Drawing profile ${count}/${replicate + 1}: collect settled heap`,
      );
      const settledHeapBytes = await heap();
      const frames = await page.evaluate(() => window.drawingFrames),
        longTasks = await page.evaluate(() => window.drawingLongTasks);
      const frameStats = Object.fromEntries(
        ["draw", "lasso", "resize", "translate", "move"].map((phase) => [
          phase,
          stats(
            frames
              .filter((f) => f.phase === phase && f.event === "pointermove")
              .map((f) => f.ms),
          ),
        ]),
      );
      assert.equal(jobs, 0);
      const savedTransitions = await page.evaluate(() => window.drawingSaved);
      for (const phase of ["draw", "resize", "translate", "move"])
        assert.equal(
          savedTransitions.filter((s) => s.phase === phase).length,
          2,
          "each measured edit must expose one page-side Saved transition",
        );
      const transactions = await page.evaluate(
        () => window.drawingTransactions,
      );
      assert(
        transactions.every((s) => Number.isFinite(s.end) && !s.aborted),
        "diagnostic transactions must complete",
      );
      const gaps = await page.evaluate(() => window.drawingFrameGaps);
      const resizeResponsiveness = [1, 2].map((pass) => {
        const saved = savedTransitions.find(
            (s) => s.phase === "resize" && s.pass === pass,
          ),
          frame = frames.find(
            (f) =>
              f.phase === "resize" &&
              f.pass === pass &&
              f.event === "pointerup",
          );
        assert(saved && frame);
        return {
          pass,
          releaseToSaved: windowMetrics(
            saved.start,
            saved.end,
            longTasks,
            gaps,
          ),
          afterTwoFramesToSaved: windowMetrics(
            Math.min(frame.start + frame.ms, saved.end),
            saved.end,
            longTasks,
            gaps,
          ),
        };
      });
      rows.push({
        replicate: replicate + 1,
        traces,
        resizeResponsiveness,
        attribution: attribution
          ? {
              resizeCpu,
              translateCpu,
              transactions,
              resizeTransactionUnionMs: [1, 2].map((pass) =>
                unionMs(
                  transactions.filter(
                    (s) => s.phase === "resize" && s.pass === pass,
                  ),
                ),
              ),
            }
          : null,
        baselineMarks: count,
        peakMarks: count + 1,
        fixturePoints: points,
        longestStroke,
        sourceBytes: Buffer.byteLength(source),
        geometry,
        owner,
        openToFramesMs,
        eventToTwoFramesMs: frameStats,
        releaseToTwoFramesMs: Object.fromEntries(
          ["draw", "lasso", "resize", "translate", "move"].map((phase) => [
            phase,
            stats(
              frames
                .filter((f) => f.phase === phase && f.event === "pointerup")
                .map((f) => f.ms),
            ),
          ]),
        ),
        pageSideReleaseToSavedMs: Object.fromEntries(
          ["draw", "resize", "translate", "move"].map((phase) => [
            phase,
            stats(
              savedTransitions
                .filter((s) => s.phase === phase)
                .map((s) => s.ms),
            ),
          ]),
        ),
        pointerUpToSavedAndTwoFramesMs: Object.fromEntries(
          Object.entries(durable).map(([key, values]) => [key, stats(values)]),
        ),
        lassoReleaseToTwoFramesMs: stats(selection),
        initialHeapBytes,
        settledHeapBytes,
        retainedHeapGrowthBytes: settledHeapBytes - initialHeapBytes,
        svgDescendants: await page
          .locator(".drawing-surface")
          .evaluate((node) => node.querySelectorAll("*").length),
        longTasks,
        indexedDbGetRequests: await page.evaluate(() => window.drawingIo),
        executionJobs: jobs,
      });
    } finally {
      await browser.close();
    }
  }
assert.deepEqual(errors, []);
const report = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  browser: version,
  replicates,
  counts,
  attribution,
  trace,
  responsivenessMethod:
    "A page-side RAF heartbeat and long-task observer cover resize release through Saved and the subwindow after the release's two-RAF callback. Durations are clipped to those windows; only PerformanceObserver long tasks (>50ms originally) are available. RAF gaps are rendering opportunities, not input/compositor latency. Trace mode captures full main-thread tasks only for the 1999-mark measured resizes and is separate from clean production/CPU-attribution runs.",
  diagnosticMethod:
    "Replicates use fresh browser/owner fixtures, retaining the original three-gesture history per phase instead of accumulating more revisions. CPU attribution, when enabled, requires a separate non-minified build; resize sampling covers pointer-up through Saved plus two RAFs, while translation sampling covers all twelve moves plus release/Saved/two RAFs. These phase totals are not interchangeable. It changes timing and is not comparable to clean production runs. Categories partition sampled self time by stack ancestry; inclusive contexts overlap. Transaction spans measure native transaction creation to complete/abort, not disk-active time; union avoids double-counting overlap. Render samples measure JS React/drawing work, not compositor/GPU paint. A status-node MutationObserver records the page-side transition to Saved from the captured pointer-up timestamp. The older automation-side wait includes polling and two RAFs, so the two are reported separately. Raw per-gesture samples and independent replicate rows are retained; no significance or universal latency claim.",
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0].model,
  },
  method:
    "Fresh headless Chrome process per 100/1000/1999 admitted mixed-mark fixture, at 1600×1100 and Fit page; one existing 8192-point stroke plus 64-point ordinary ink. Drawing temporarily reaches 2000 marks in the largest row. Real trusted pointer input: one warmup plus two measured drawing, whole-scene lasso/resize/translation, and single-shape move gestures. Twelve moves per draw/move/resize, waiting two RAFs per move; lasso uses twelve moves over four edges. Event-to-two-RAF is a page-side rendering opportunity, not compositor paint latency. Page-side release-to-two-RAF includes synchronous publication/render opportunities but not necessarily durable saving; pointer-up-to-Saved-and-two-RAF includes automation and IndexedDB. Source owner timings isolate accepted full-scene resize/Undo (one warmup plus two samples), excluding geometry lowering and storage. Source geometry timings are Node CPU diagnostics (three warmups plus twelve samples), include preview bounds queries (the legacy materializeMs field measures a cold bounds pass, not necessarily point materialization) and an 8192-point stroke near-miss without early successful hit, and exclude JSX/SVG/paint. Forced-GC browser heap before and after includes twelve accepted/undone edits and retained revisions, not a leak-isolation experiment. Long tasks cover the whole measured interaction period, including saves and test probes. Per-phase/per-store IndexedDB get counts and maximum pending requests use an identical lightweight get wrapper on before/after runs; getAll/cursors are not instrumented. Timing/heap values are device-specific diagnostics, not universal SLOs; deterministic assertions cover admitted capacity, actual full-scene resizing, Undo and no computation jobs. This is not the combinatorial 2000×8192-point case or physical tablet evidence.",
  rows,
};
await writeFile(
  new URL(
    trace
      ? "../../../evidence/current/canvas/drawing-browser-trace.json"
      : attribution
        ? "../../../evidence/current/canvas/drawing-browser-attribution.json"
        : replicates > 1
          ? "../../../evidence/current/canvas/drawing-browser-replicates.json"
          : "../../../evidence/current/canvas/drawing-browser-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  "Drawing workload: admitted near-capacity fixtures, actual drawing/lasso/resize/move, Undo, frame opportunities, heap and geometry diagnostics recorded.",
);
