/** React bindings for the session computation port; no renderer-owned execution or cache. */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { RegionSession } from "../document.ts";
const Computations = createContext<RegionSession | undefined>(undefined);
export function ArtifactComputationProvider({
  session,
  children,
}: {
  session: RegionSession;
  children: ReactNode;
}) {
  useEffect(() => session.attach(), [session]);
  return createElement(Computations.Provider, { value: session }, children);
}
function useSession() {
  const session = useContext(Computations);
  if (!session) throw Error("A session computation provider is required");
  return session;
}
export const useArtifactDocument = () => useSession().document;
export function useComputations() {
  const service = useSession().computations;
  useSyncExternalStore(service.subscribe, service.version, service.version);
  return service;
}
/** Representations declare desired contexts. Mounted editors do not own jobs or results. */
export function ArtifactResultsProvider({
  contexts,
  children,
}: {
  contexts: string[];
  children: ReactNode;
}) {
  const service = useSession().computations,
    key = JSON.stringify(contexts);
  useEffect(() => service.setContexts(JSON.parse(key)), [service, key]);
  return children;
}
