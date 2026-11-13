/** Personal application chrome, never authored canvas geometry or document data. */
export const CHROME_STORAGE = "manifold.workspace-chrome.v1";
export const panelNames = {
  relationships: "Relationships",
  response: "Results",
  table: "Table",
  assistant: "Agent",
} as const;
export type PanelId = keyof typeof panelNames;
export const dockSides = ["left", "right", "bottom"] as const;
export type DockSide = (typeof dockSides)[number];
export type DockGroup = {
  tabs: PanelId[];
  active?: PanelId;
  collapsed: boolean;
  size: number;
};
export type ChromeLayout = {
  toolbar: "top" | "bottom" | "left" | "right" | "hidden";
  groups: Record<DockSide, DockGroup>;
};
export type ChromePreferences = {
  version: 1;
  layout: ChromeLayout;
  presets: { name: string; layout: ChromeLayout }[];
};
export function defaultChrome(): ChromeLayout {
  return {
    toolbar: "top",
    groups: {
      left: { tabs: [], collapsed: false, size: 300 },
      right: { tabs: [], collapsed: false, size: 340 },
      bottom: { tabs: [], collapsed: false, size: 240 },
    },
  };
}
export function panelSide(layout: ChromeLayout, id: PanelId) {
  return dockSides.find((side) => layout.groups[side].tabs.includes(id));
}
export function movePanel(
  layout: ChromeLayout,
  id: PanelId,
  side?: DockSide,
): ChromeLayout {
  const next = structuredClone(layout);
  for (const group of Object.values(next.groups)) {
    group.tabs = group.tabs.filter((tab) => tab !== id);
    if (group.active === id) {
      if (group.tabs.length) group.active = group.tabs[0];
      else delete group.active;
    }
  }
  if (side) {
    const group = next.groups[side];
    group.tabs.push(id);
    group.active = id;
    group.collapsed = false;
  }
  return next;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function validLayout(value: unknown): value is ChromeLayout {
  if (
    !object(value) ||
    !["top", "bottom", "left", "right", "hidden"].includes(
      value.toolbar as string,
    ) ||
    !object(value.groups)
  )
    return false;
  const seen = new Set<string>();
  for (const side of dockSides) {
    const group = value.groups[side];
    if (
      !object(group) ||
      !Array.isArray(group.tabs) ||
      group.tabs.length > 4 ||
      typeof group.collapsed !== "boolean" ||
      typeof group.size !== "number" ||
      !Number.isFinite(group.size) ||
      group.size < 160 ||
      group.size > 600
    )
      return false;
    for (const tab of group.tabs) {
      if (
        typeof tab !== "string" ||
        !Object.hasOwn(panelNames, tab) ||
        seen.has(tab)
      )
        return false;
      seen.add(tab);
    }
    if (
      group.tabs.length
        ? !group.tabs.includes(group.active)
        : group.active !== undefined
    )
      return false;
  }
  return true;
}
export function restoreChrome(raw: string): ChromePreferences {
  if (raw.length > 30000) throw Error("Workspace preferences are too large.");
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    value.version !== 1 ||
    !validLayout(value.layout) ||
    !Array.isArray(value.presets) ||
    value.presets.length > 12
  )
    throw Error("Unsupported workspace preferences.");
  const names = new Set<string>();
  for (const preset of value.presets) {
    if (
      !object(preset) ||
      typeof preset.name !== "string" ||
      !preset.name.trim() ||
      preset.name.length > 60 ||
      names.has(preset.name) ||
      !validLayout(preset.layout)
    )
      throw Error("Invalid workspace preset.");
    names.add(preset.name);
  }
  return value as ChromePreferences;
}
