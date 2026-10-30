/** Test-only trace collection; no server or production instrumentation. */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
export async function stopSaveTrace(cdp, destination) {
  const complete = new Promise((resolve) =>
    cdp.once("Tracing.tracingComplete", resolve),
  );
  await cdp.send("Tracing.end");
  const { stream } = await complete;
  let text = "";
  try {
    while (true) {
      const part = await cdp.send("IO.read", { handle: stream });
      text += part.base64Encoded
        ? Buffer.from(part.data, "base64").toString("utf8")
        : part.data;
      if (part.eof) break;
    }
  } finally {
    await cdp.send("IO.close", { handle: stream });
  }
  const rawTracePath = join(
    tmpdir(),
    "manifold-" + basename(destination.pathname),
  );
  await writeFile(rawTracePath, text);
  const events = JSON.parse(text).traceEvents;
  const main = events.find(
    (e) => e.name === "thread_name" && e.args?.name === "CrRendererMain",
  );
  if (!main) throw Error("Trace has no renderer main thread");
  const tasks = events.filter(
    (e) =>
      e.pid === main.pid &&
      e.tid === main.tid &&
      e.ph === "X" &&
      /RunTask$/.test(e.name),
  );
  return {
    rawTracePath,
    mainTasks: tasks.length,
    longestTaskMs: Math.max(0, ...tasks.map((e) => e.dur / 1000)),
    longest: tasks
      .toSorted((a, b) => b.dur - a.dur)
      .slice(0, 8)
      .map((t) => ({
        ms: t.dur / 1000,
        work: events
          .filter(
            (e) =>
              e.pid === t.pid &&
              e.tid === t.tid &&
              e.ph === "X" &&
              e.ts >= t.ts &&
              e.ts + e.dur <= t.ts + t.dur &&
              e !== t,
          )
          .toSorted((a, b) => b.dur - a.dur)
          .slice(0, 6)
          .map((e) => ({
            name: e.name,
            ms: e.dur / 1000,
            function: e.args?.data?.functionName,
          })),
      })),
  };
}
export function windowMetrics(start, end, tasks, gaps) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    throw Error("Invalid window");
  const overlaps = (values) =>
    values
      .map((v) =>
        Math.max(0, Math.min(end, v.start + v.ms) - Math.max(start, v.start)),
      )
      .filter((v) => v > 0);
  const durations = overlaps(tasks),
    frames = overlaps(gaps);
  return {
    windowMs: end - start,
    longTaskCount: durations.length,
    longestLongTaskOverlapMs: Math.max(0, ...durations),
    blockingOver50Ms: durations.reduce((n, v) => n + Math.max(0, v - 50), 0),
    maxRafGapOverlapMs: Math.max(0, ...frames),
  };
}
