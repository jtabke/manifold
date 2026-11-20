import type { ReactNode } from "react";
import {
  Pencil,
  Hand,
  ChartNoAxesCombined,
  Link2,
  Route,
  GitBranch,
  Scan,
  FileInput,
  ExternalLink,
  Group,
  Box,
  DoorOpen,
  Layers,
  LayoutGrid,
  Undo2,
  Search,
  Plus,
  MoreHorizontal,
  Image,
} from "lucide-react";
import type { CanvasCommand } from "../interaction/commands";
import type { CanvasAction } from "./CanvasActionMenu";

const commandIcons: Record<string, ReactNode> = {
  image: <Image />,
  edit: <Pencil />,
  vary: <Hand />,
  plot: <ChartNoAxesCombined />,
  connect: <Link2 />,
  inspect: <Route />,
  compare: <GitBranch />,
  focus: <Scan />,
  import: <FileInput />,
  reference: <ExternalLink />,
  group: <Group />,
  model: <Box />,
  enter: <DoorOpen />,
  layers: <Layers />,
  organize: <LayoutGrid />,
  undo: <Undo2 />,
  search: <Search />,
  code: <Layers />,
  create: <Plus />,
};
/** Object menus lead with the same editing, exploration, connection and inspection commands as the wheel. */
export function compactContextActions(actions: CanvasAction[]): CanvasAction[] {
  const first = ["edit", "explore", "connect", "inspect"].flatMap((intent) =>
    actions.filter((a) => a.intent === intent),
  );
  // Keep explicit multi-selection operations at the top level too.
  first.push(
    ...actions.filter(
      (a) => a.id === "selection.group" || a.id === "selection.model",
    ),
  );
  const plots = actions.filter(
    (a) => !first.includes(a) && a.id.startsWith("response."),
  );
  const secondary = actions.filter(
    (a) => !first.includes(a) && !plots.includes(a),
  );
  if (plots.length)
    first.push({
      id: "menu.plots",
      key: "menu.plots",
      label: "Plot options…",
      icon: commandIcons.plot,
      items: plots,
    });
  if (secondary.length)
    first.push({
      id: "menu.more",
      key: "menu.more",
      label: "More actions…",
      icon: <MoreHorizontal />,
      items: secondary,
    });
  return first;
}
export const presentCommand = (
  command: CanvasCommand,
  executeCommand: (command: CanvasCommand) => void,
  label = command.label,
): CanvasAction => ({
  id: command.id,
  key: command.key,
  label,
  icon: commandIcons[command.icon] || <MoreHorizontal />,
  hint: command.label,
  intent:
    command.intent ?? (command.icon === "inspect" ? "inspect" : undefined),
  unavailable: command.unavailable,
  run: () => executeCommand(command),
});
