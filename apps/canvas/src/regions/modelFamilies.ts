/** Built-in scalar family descriptions for discovery and authoring. No runtime installation. */
import type { ModelDefinition } from "@manifold/foundation";

export const springMethod = {
  id: "manifold.spring-force",
  version: "1",
  runtime: "manifold-native-models@1",
};
export const scaleMethod = {
  id: "manifold.force-scale",
  version: "1",
  runtime: "manifold-native-models@1",
};
export const modelFamilies = Object.freeze({
  spring: {
    label: "Spring",
    definition: {
      nodes: {
        k: { kind: "input", label: "k", unit: "N/mm", default: 10 },
        x: { kind: "input", label: "x", unit: "mm", default: 2 },
        force: {
          kind: "method",
          label: "F",
          method: springMethod,
          inputs: { k: { node: "k" }, x: { node: "x" } },
        },
      },
      children: {},
      inputs: {
        stiffness: { label: "Stiffness", node: "k" },
        displacement: { label: "Displacement", node: "x" },
      },
      outputs: { force: { label: "Force", target: { node: "force" } } },
    },
  },
  scale: {
    label: "Force scale",
    definition: {
      nodes: {
        load: { kind: "input", label: "F", unit: "N", default: 10 },
        factor: { kind: "input", label: "gain", unit: "1", default: 2 },
        force: {
          kind: "method",
          label: "F",
          method: scaleMethod,
          inputs: { load: { node: "load" }, factor: { node: "factor" } },
        },
      },
      children: {},
      inputs: {
        load: { label: "Load", node: "load" },
        factor: { label: "Gain", node: "factor" },
      },
      outputs: { force: { label: "Force", target: { node: "force" } } },
    },
  },
} satisfies Record<string, { label: string; definition: ModelDefinition }>);
export type ModelFamily = keyof typeof modelFamilies;
