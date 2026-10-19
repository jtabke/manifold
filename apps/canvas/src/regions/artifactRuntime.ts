import {
  Fragment,
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { acceptData, prepare, type Artifact } from "./artifacts";
import type { Page } from "./document";
export type ComputedResult = NonNullable<Artifact["receipt"]>;
export type ResultCache = Map<string, ComputedResult>;
export function useArtifactResult(
  page: Page,
  a: Artifact,
  cache: ResultCache,
  enabled = true,
  onResult?: (r: ComputedResult) => void,
) {
  const [receipt, setReceipt] = useState<ComputedResult>(),
    [status, setStatus] = useState<
      "current" | "running" | "blocked" | "failed"
    >("running"),
    [error, setError] = useState(""),
    [nonce, setNonce] = useState(0);
  const latest = useRef({ page, a, onResult });
  latest.current = { page, a, onResult };
  const prepared = useMemo(() => {
    if (!enabled) return {};
    try {
      return { job: prepare(page, a) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [page, a, enabled]);
  const job = prepared.job;
  useEffect(() => {
    if (!enabled) return;
    if (!job) {
      setStatus("blocked");
      setError(prepared.error || "Resolve the source equation.");
      return;
    }
    const deliver = (result: ComputedResult) => {
      cache.set(job.key, result);
      if (cache.size > 12) cache.delete(cache.keys().next().value!);
      setReceipt(result);
      setStatus("current");
      setError("");
      latest.current.onResult?.(result);
    };
    const retained = cache.get(job.key);
    if (retained) {
      deliver(retained);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setStatus("running");
    setError("");
    fetch("/api/artifact-sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: job.code, inputs: job.inputs }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Python execution failed.");
        const hash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(job.code),
            ),
          ),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        if (data.code_sha256 !== hash)
          throw Error("Python source identity did not match.");
        if (!active) return;
        const now = latest.current;
        deliver(acceptData(now.page, now.a, job, data).receipt!);
      })
      .catch((e) => {
        if (active) {
          setStatus("failed");
          setError(e.message);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [job?.key, prepared.error, enabled, nonce, cache]);
  const current =
    enabled && !!job && status === "current" && receipt?.key === job.key;
  return {
    job,
    receipt,
    status: status === "current" && !current ? ("running" as const) : status,
    error,
    current,
    run: () => {
      if (job) cache.delete(job.key);
      setNonce((n) => n + 1);
    },
  };
}

export type ArtifactRuntime = ReturnType<typeof useArtifactResult>;
const SharedResults = createContext<
  Record<string, ArtifactRuntime> | undefined
>(undefined);
export const runtimeKey = (artifact: string, context: string) =>
  `${artifact}:${context}`;
export const useSharedResults = () => useContext(SharedResults);
/** Computation owners outlive individual editors. Layout never enters an execution key. */
export function ArtifactResultsProvider({
  page,
  artifacts,
  contexts,
  change,
  children,
}: {
  page: Page;
  artifacts: Artifact[];
  contexts: string[];
  change: (artifact: Artifact) => void;
  children: ReactNode;
}) {
  const [results, setResults] = useState<Record<string, ArtifactRuntime>>({});
  const caches = useRef(new Map<string, ResultCache>());
  const latestChange = useRef(change);
  latestChange.current = change;
  const needed = [
    ...new Set([
      page.active,
      ...contexts,
      ...artifacts
        .filter((a) => a.comparing)
        .map((a) => a.compareContext || page.active),
    ]),
  ].filter((id) => page.contexts.some((c) => c.id === id));
  const owners = artifacts.flatMap((a) =>
    needed.map((context) => {
      if (!caches.current.has(a.id)) caches.current.set(a.id, new Map());
      return createElement(ArtifactExecution, {
        key: runtimeKey(a.id, context),
        page: { ...page, active: context },
        artifact: a,
        cache: caches.current.get(a.id)!,
        deliver: (result: ArtifactRuntime) =>
          setResults((current) => ({
            ...current,
            [runtimeKey(a.id, context)]: result,
          })),
        persist:
          context === page.active
            ? (receipt: ComputedResult) =>
                latestChange.current({ ...a, receipt })
            : undefined,
      });
    }),
  );
  useEffect(() => {
    for (const id of caches.current.keys())
      if (!artifacts.some((a) => a.id === id)) caches.current.delete(id);
    setResults((values) => {
      const next = Object.fromEntries(
        Object.entries(values).filter(([key]) =>
          artifacts.some((a) => key.startsWith(`${a.id}:`)),
        ),
      );
      return Object.keys(next).length === Object.keys(values).length
        ? values
        : next;
    });
  }, [artifacts]);
  const guarded: Record<string, ArtifactRuntime> = {};
  for (const artifact of artifacts)
    for (const context of needed) {
      const key = runtimeKey(artifact.id, context),
        retained = results[key];
      if (!retained) continue;
      try {
        const job = prepare({ ...page, active: context }, artifact);
        guarded[key] =
          retained.job?.key === job.key
            ? retained
            : {
                ...retained,
                job,
                current: false,
                status: "running",
                error: "",
              };
      } catch (error) {
        guarded[key] = {
          ...retained,
          current: false,
          status: "blocked",
          error: (error as Error).message,
        };
      }
    }
  return createElement(
    SharedResults.Provider,
    { value: guarded },
    createElement(Fragment, { key: "computations" }, ...owners),
    children,
  );
}
function ArtifactExecution({
  page,
  artifact,
  cache,
  deliver,
  persist,
}: {
  page: Page;
  artifact: Artifact;
  cache: ResultCache;
  deliver: (result: ArtifactRuntime) => void;
  persist?: (result: ComputedResult) => void;
}) {
  const result = useArtifactResult(page, artifact, cache, true, persist);
  const latest = useRef(deliver);
  latest.current = deliver;
  useEffect(
    () => latest.current(result),
    [
      result.job?.key,
      result.receipt,
      result.status,
      result.error,
      result.current,
    ],
  );
  return null;
}
