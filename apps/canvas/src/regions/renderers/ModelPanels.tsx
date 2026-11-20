import type { View } from "@manifold/foundation";
import type { ComponentProps } from "react";
import { IndependentModels } from "./IndependentModels";
import { ModelAnalyses } from "./ModelAnalyses";
import { ModelOptimizations } from "./ModelOptimizations";

/** Only loaded for a canvas with model representations. Reuse the layout's view selections. */
export default function ModelPanels({
  models,
  analyses,
  optimizations,
  askAgent,
  ...ports
}: Omit<ComponentProps<typeof ModelAnalyses>, "views"> & {
  models: readonly View[];
  analyses: readonly View[];
  optimizations: readonly View[];
  askAgent: ComponentProps<typeof IndependentModels>["askAgent"];
}) {
  return (
    <>
      <ModelOptimizations {...ports} views={optimizations} />
      <ModelAnalyses {...ports} views={analyses} />
      <IndependentModels
        session={ports.session}
        positions={ports.positions}
        move={ports.move}
        beforeAction={ports.beforeAction}
        editBuffers={ports.buffers}
        views={models}
        askAgent={askAgent}
      />
    </>
  );
}
