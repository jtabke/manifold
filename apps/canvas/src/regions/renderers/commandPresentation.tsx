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
  unavailable: command.unavailable,
  run: () => executeCommand(command),
});
