import { useEffect, useState } from "react";
import Regions from "./Regions";
import { bootstrapCanvas, type InitialWorkspace } from "./canvasBootstrap";
/** Recovery finishes before editors/automatic computations are mounted. */
export default function CanvasApp() {
  const [initial, setInitial] = useState<InitialWorkspace>();
  useEffect(() => {
    let active = true,
      loaded: InitialWorkspace | undefined;
    void bootstrapCanvas()
      .then((value) => {
        loaded = value;
        if (active) setInitial(value);
        else value.store?.close();
      })
      .catch((error) => {
        if (active)
          setInitial({
            error: `Workspace recovery failed: ${(error as Error).message}`,
            blocked: true,
          });
      });
    return () => {
      active = false;
      loaded?.store?.close();
    };
  }, []);
  if (!initial)
    return (
      <main className="er-app" aria-busy="true">
        <p role="status">Opening workspace…</p>
      </main>
    );
  return <Regions initial={initial} />;
}
