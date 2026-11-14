import {
  ShortcutBindingsContext,
  useShortcutPreferences,
} from "./useShortcutPreferences";
import {
  shortcutLabel,
  type ShortcutAction,
} from "../interaction/shortcutBindings";
import { KeyboardShortcuts } from "../renderers/KeyboardShortcuts";
import { CanvasAssistant } from "../renderers/CanvasAssistant";
import { captureAssistantCanvas } from "../renderers/assistantCapture";
import { CanvasMcp } from "./CanvasMcp";
import { isCanvasControlEvent, isDialogEvent } from "../interaction/modalInput";
import {
  useCanvasOverlaps,
  canvasObjectId,
  canvasObjectSelector,
} from "./useCanvasOverlaps";
import { DrawingCanvas } from "../renderers/DrawingCanvas";
import { CanvasCommandMenu } from "../renderers/CanvasCommandMenu";
import { CanvasDocumentTitle } from "../renderers/CanvasDocumentTitle";
import {
  documentTitle,
  documentFilename,
  UNTITLED_DOCUMENT,
} from "../documentTitle";
import { CanvasSelectionToolbar } from "../renderers/CanvasSelectionToolbar";
import { CanvasConnectionPopover } from "../renderers/CanvasConnectionPopover";
import { drawings } from "../drawing";
import { drawingGeometry } from "../drawingGeometry";
import {
  duplicateSelection,
  deleteSelection,
  selectionEditReason,
} from "../selectionOperations";
import { ModelDefinitionEditor } from "../renderers/ModelDefinitionEditor";
import { parse } from "../../notebook/math";
import type { ModelSource } from "../authoredModels";
import { useCanvasExploration } from "./useCanvasExploration";
import { CommandPalette } from "../renderers/CommandPalette";
import { CanvasNavigationControls } from "../renderers/CanvasNavigationControls";
import { concepts } from "../renderers/paletteConcepts";
import { presentCommand } from "../renderers/commandPresentation";
import { MathLine } from "../renderers/MathLine";
import { ReferencedNote } from "../renderers/ReferencedNote";
import { CurveRegion } from "../renderers/CurveRegion";
import {
  canvasScroll as viewportScroll,
  scrollCanvasTo,
  recenterCanvas,
  SCROLL_SURFACE,
  revealCanvasElement,
} from "../interaction/canvasViewport";
import {
  createElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import CalculationHistory from "../renderers/CalculationHistory";
import { ModelAnalyses } from "../renderers/ModelAnalyses";
import { ModelOptimizations } from "../renderers/ModelOptimizations";
import { optimizationViews } from "../modelOptimizationCommands";
import { analysisViews } from "../modelAnalysisCommands";
import { IndependentModels } from "../renderers/IndependentModels";
import { insertModel, modelViews } from "../modelCommands";
import CanvasCleanupDialog from "../renderers/CanvasCleanupDialog";
import {
  ArrowUpRight,
  Bookmark,
  ArrowLeft,
  Check,
  GripVertical,
  FilePlus2,
  Download,
  Sparkles,
  Layers,
  LayoutGrid,
  Link2,
  MoreHorizontal,
  MessageSquare,
  FileInput,
  Plus,
  Search,
  Undo2,
  X,
} from "lucide-react";
import {
  display,
  same,
  references,
  quantityLiteral,
} from "../../notebook/math";
import {
  RegionSession,
  ancestors,
  positions,
  project,
  type Point,
  type ConnectionEdit,
} from "../document";
import { responseFor } from "../exploration";
import { ExplorationControls } from "../renderers/ExplorationControls";
import {
  RelationshipExpansion,
  InlineExploration,
  InlineRecovery,
  SpatialComparison,
} from "../renderers/Interactions";
import "../styles/regions.css";
import { exportSelectionPng } from "../renderers/selectionPng";
import {
  CanvasActionMenu,
  type ActionMenuLocation,
} from "../renderers/CanvasActionMenu";
import {
  commandTarget,
  commandSubject,
  resolveCommands,
  markingCommands,
  toolbarCommands,
  searchCommands,
  requestedPlotCommand,
  workspaceCommands as resolveWorkspaceCommands,
  type CanvasCommand,
  type CommandContext,
  type CommandSelection,
  type CommandRequest,
} from "../interaction/commands";
import { workspaceStorage } from "../workspaceStorage";
import {
  canvasWorkspace,
  createEditBuffers,
  type WorkspaceEdits,
} from "./workspaceFiles";
import { type InitialWorkspace } from "./canvasBootstrap";
import { ArtifactComputationProvider } from "./artifactRuntime";
import { REGION_STEP, regionAdvance, freeRegionPosition } from "../pageLayout";
import { DataRegion } from "../renderers/DataRegion";
import {
  DatasetReview,
  DatasetResult,
  RecordFeedback,
  type DataSelection,
} from "../renderers/DatasetViews";
import { evaluateDataset } from "../datasetModel";
import { matchesMeasurementText } from "../dataSources";
import { placeDataResult } from "../dataFeedback";
import { DataRelationshipOverlay } from "../renderers/DataRelationshipOverlay";
import { useRelationshipNavigation } from "../interaction/useRelationshipNavigation";
import { RelationshipTrail } from "../renderers/RelationshipTrail";
import { MEMORY_STORAGE, restoreMemory } from "../workspaceMemory";
import { useWorkspaceMemory } from "./useWorkspaceMemory";
import { useModels } from "./useModels";
import {
  SystemInvestigation,
  type InvestigationView,
  type InvestigationPath,
} from "../renderers/SystemInvestigation";
import { placeInvestigation } from "../systemPresentation";
import { SystemOverview } from "../renderers/SystemOverview";
import {
  ExternalReferenceView,
  ExternalReferenceEditor,
} from "../renderers/ExternalReferenceView";
import {
  quantityTitle,
  findBalance,
  balanceInputs,
} from "../systemExploration";

import { useCanvasNavigation } from "../interaction/useCanvasNavigation";
import { useFrameTask } from "../interaction/frameTask";
import { assessConstraint } from "../systemAssessment";
import { type NestedModel } from "../models";
import {
  ModelObject,
  ModelReview,
  ModelBreadcrumb,
  ModelConnection,
  ModelTrace,
} from "../renderers/ModelViews";
import "../styles/investigation.css";
import { ArtifactView } from "../renderers/ArtifactView";
import WorkspaceAreas from "../renderers/WorkspaceAreas";
import { WorkspaceDock, WorkspaceControls } from "../renderers/WorkspaceDock";
import { useWorkspaceChrome } from "./useWorkspaceChrome";
import { panelSide } from "../workspaceChrome";
import { AreaEditor } from "../renderers/AreaEditors";
import { useCanvasScene } from "./useCanvasScene";
import { CanvasToolView, CanvasGroupView } from "../renderers/CanvasObjects";
import { dockObjects } from "../canvasScene";
import type { EditorProps } from "../renderers/AreaEditors";
import { sourceSpans } from "../editing";
import {
  planConnection,
  connectionChoices,
  plotChoices,
  quantityDescription,
} from "../linking";
import {
  frameBounds,
  organizeFrames,
  selectionRect,
  touches,
  type CanvasFrame,
  type CanvasRect,
} from "../selection";
import {
  makeArtifact,
  STORAGE,
  type Artifact,
  type ArtifactFocus,
} from "../artifacts";

const label = (name: string) => (name === "T_inf" ? "T∞" : name);
const measurementCaption = (
  text: string,
  name: string,
  source: { raw: string; unit: string },
) => {
  try {
    return matchesMeasurementText(text, name, source.raw, source.unit)
      ? "Imported measurement"
      : "Edited assumption";
  } catch {
    // Older files may retain a units field accepted before strict unit validation.
    return "Source units need review";
  }
};

export default function Regions({ initial }: { initial: InitialWorkspace }) {
  const renders = useRef(0);
  renders.current++;
  // Product authoring includes persistence; explicit research trials stay isolated.
  const params = new URLSearchParams(window.location.search);
  const artifactMode = params.has("artifacts") || !params.has("trial");
  const [saved] = useState(initial);
  const [storageError, setStorageError] = useState(saved?.error || "");
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const chrome = useWorkspaceChrome();
  const assistantOpen = !!panelSide(chrome.preferences.layout, "assistant");
  const setAssistantOpen = (open: boolean) => chrome.show("assistant", open);
  const [assistantPresentation, setAssistantPresentation] = useState({
    floating: false,
    minimized: false,
  });
  const detachedPanels = useMemo(
    () =>
      assistantOpen &&
      (assistantPresentation.floating || assistantPresentation.minimized)
        ? ["assistant" as const]
        : [],
    [assistantOpen, assistantPresentation],
  );
  const [assistantAnchor, setAssistantAnchor] = useState<Point>({
    x: 200,
    y: 120,
  });
  const [assistantPoint, setAssistantPoint] = useState<Point>({ x: 0, y: 0 });
  const assistantButton = useRef<HTMLButtonElement>(null);
  const [mcpStatusHost, setMcpStatusHost] = useState<HTMLDivElement | null>(
    null,
  );
  const shortcutPreferences = useShortcutPreferences();
  const [authoringModel, setAuthoringModel] = useState<{
    source: ModelSource;
    at: Point;
  }>();
  const [referenceEditor, setReferenceEditor] = useState<string>();
  const [session] = useState(() => {
    const session = new RegionSession(
      saved.data?.page,
      () => [],
      saved.data?.document,
      saved.data?.artifacts || [],
      false,
      saved.data?.recovery,
    );
    saved.store?.acknowledgeRecovery(session);
    return session;
  });
  const [workspace] = useState(() =>
    canvasWorkspace({
      session,
      key: STORAGE,
      store: initial.store,
      blocked: initial.blocked,
      error: initial.error,
      legacyRescue: initial.legacyRescue,
      legacyScene: initial.legacyScene,
      reportError: setStorageError,
    }),
  );
  const saveLocal = workspace.save;
  const artifacts = session.artifacts;
  const setArtifacts = (
    update: Artifact[] | ((items: Artifact[]) => Artifact[]),
  ) => session.setArtifacts(update);
  const [artifactFocus, setArtifactFocus] = useState<ArtifactFocus>();
  const [areaSelection, setAreaSelection] = useState<string>();
  const [areaCanvasVisible, setAreaCanvasVisible] = useState(true);
  const revealAreaCanvas = useRef<(() => void) | undefined>(undefined);
  const [artifactHeights, setArtifactHeights] = useState<
    Record<string, number>
  >({});
  const artifactFrames = useMemo(
    () =>
      artifacts
        .flatMap((a) => [a, ...(a.views || [])])
        .map((v) => ({ ...v, height: artifactHeights[v.id] || v.height })),
    [artifacts, artifactHeights],
  );
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => session.subscribe(refresh), [session]);
  const page = session.state;
  const acceptedDocument = session.document;
  const drawingEntries = useMemo(
    () => drawings(acceptedDocument),
    [acceptedDocument],
  );
  const drawingFrames = useMemo(() => {
    const geometry = drawingGeometry(drawingEntries);
    return drawingEntries.map((entry) => ({
      id: entry.id,
      kind: "drawing" as const,
      ...geometry.bounds(entry),
    }));
  }, [drawingEntries]);
  const independentViews = useMemo(
    () => modelViews(acceptedDocument),
    [acceptedDocument],
  );
  const analysisFrames = useMemo(
    () => analysisViews(acceptedDocument),
    [acceptedDocument],
  );
  const modelFrames = useMemo(
    () => [
      ...independentViews,
      ...analysisFrames,
      ...optimizationViews(acceptedDocument),
    ],
    [acceptedDocument, independentViews, analysisFrames],
  );
  const extraFrames = useMemo(
    () => [
      ...drawingFrames,
      ...modelFrames.map((v) => ({
        id: v.id,
        x: v.x,
        y: v.y,
        width: v.renderer === "canvas-model-analysis-view@1" ? 546 : 406,
        height: v.renderer === "canvas-model-analysis-view@1" ? 740 : 470,
        kind: "plot" as const,
      })),
    ],
    [drawingFrames, modelFrames],
  );
  const [resume] = useState(() => {
    if (!artifactMode || saved?.blocked) return;
    try {
      const toolIds = session.scene.tools.map((t) => t.id);
      return restoreMemory(
        localStorage.getItem(MEMORY_STORAGE),
        page,
        [
          ...toolIds,
          ...artifacts.flatMap((a) => [
            a.id,
            ...(a.views || []).map((v) => v.id),
          ]),
        ],
        session.document.document,
      );
    } catch {
      return;
    }
  });
  const csvFile = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (artifactMode && !saved.blocked && !session.isSaved) void saveLocal();
  }, [artifactMode, acceptedDocument, artifacts, saved]);
  const accepted = useMemo(() => project(page), [page]);
  const datasetStates = useMemo<
    Record<
      string,
      { result?: ReturnType<typeof evaluateDataset>; error?: string }
    >
  >(
    () =>
      Object.fromEntries(
        (page.dataRelations || []).map((r) => {
          try {
            return [r.id, { result: evaluateDataset(page, r) }];
          } catch (e) {
            return [r.id, { error: (e as Error).message }];
          }
        }),
      ),
    [page],
  );
  const trial = params.get("trial");
  const quiet = trial !== "baseline";
  const explicit = params.get("interaction") === "A";
  const {
    exploration,
    variation,
    gestureActive,
    lastEdit,
    working,
    p,
    anchor: explorationAnchor,
    revertExploration,
    exploreValue,
    startVariation,
    scrubFor,
    finishValue,
    acceptExploration,
    keepExploration,
    setInput,
    clearRecovery,
    changeRange,
  } = useCanvasExploration({
    session,
    page,
    accepted,
    explicit,
    scrubEnabled: !trial || trial === "scrub",
    select: (id) => {
      if (!expansionId) setSelected(id);
    },
    message: (text) => setMessage(text),
    compare: (value) => setComparison(value),
  });
  const [regionHeights, setRegionHeights] = useState<Record<string, number>>(
    () => Object.create(null),
  );
  const basePlaces = useMemo(
    () => positions(page, regionHeights),
    [page, regionHeights],
  );
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const trials = {
    scrub: !trial || trial === "scrub",
    expand: !trial || trial === "expand",
    spatial: !trial || trial === "compare",
  };
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const [selected, setSelected] = useState<string | undefined>(
      resume?.selected,
    ),
    [editing, setEditing] = useState<string>(),
    [draft, setDraft] = useState(""),
    [selectionSpan, setSelectionSpan] = useState<{
      start: number;
      end: number;
    }>();
  const [canvasSelection, setCanvasSelection] = useState<string[]>(
    resume?.selection || [],
  );
  const [actionMenu, setActionMenu] = useState<ActionMenuLocation>();
  const [choosingOverlap, setChoosingOverlap] = useState(false);
  const [selectionDetail, setSelectionDetail] = useState<CommandSelection>();
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const actionPointer = useRef<Point | undefined>(undefined);
  const lastCanvasPress = useRef<{ id?: string; point: Point } | undefined>(
    undefined,
  );
  const [draftLinks, setDraftLinks] = useState<Record<string, string>>({});
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  type LinkTarget = {
    region?: string;
    artifact?: string;
    view?: string;
    symbol?: string;
    unsupported?: string;
  };
  const [dataSelection, setDataSelection] = useState<DataSelection>();
  const [collapsedData, setCollapsedData] = useState<string[]>([]);
  const [dataReview, setDataReview] = useState<{
    dataset: string;
    columns: number[];
    rows: number[];
    output?: string;
    at: Point;
    kind?: DataSelection["kind"];
  }>();
  const dataGesture = useRef<
    | {
        pointer: number;
        dataset: string;
        columns: number[];
        start: Point;
        client: Point;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const [dataDrag, setDataDrag] = useState<{
    start: Point;
    end: Point;
    target?: string;
  }>();
  const openDataReview = (
    dataset: string,
    columns: number[],
    rows: number[],
    output?: string,
    at?: Point,
  ) => {
    setDataReview({
      dataset,
      columns,
      rows,
      output,
      kind: dataSelection?.kind,
      at: at || {
        x: viewportScroll(canvas.current).x / zoom + 80,
        y: viewportScroll(canvas.current).y / zoom + 45,
      },
    });
  };
  const chooseData = (selection: DataSelection) => {
    setDataSelection(selection);
    setSelected(selection.view || selection.dataset);
    setArtifactFocus(undefined);
    setTerm(undefined);
    const bound = page.regions.find(
      (r) =>
        r.source?.dataset === selection.dataset &&
        selection.rows.includes(r.source.row) &&
        selection.columns.includes(r.source.column),
    );
    setAreaSelection(bound?.id);
  };
  const linkGesture = useRef<
    | {
        pointer: number;
        source: string;
        start: Point;
        client: Point;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const [linkDrag, setLinkDrag] = useState<{
    source: string;
    start: Point;
    end: Point;
    target?: LinkTarget;
  }>();
  const [linkMenu, setLinkMenu] = useState<{
    source: string;
    at: Point;
    mode: "actions" | "inspect" | "review" | "choose";
    target?: LinkTarget;
  }>();
  const [selectedFrames, setSelectedFrames] = useState<CanvasFrame[]>([]);
  const [marquee, setMarquee] = useState(false);
  const marqueeRect = useRef<CanvasRect | undefined>(undefined);
  const marqueeElement = useRef<HTMLDivElement>(null);
  const marqueeGesture = useRef<
    | {
        start: Point;
        client: Point;
        pointerId: number;
        moved: boolean;
        previous: string[];
        additive: boolean;
        frames?: CanvasFrame[];
        areaIds?: Set<string>;
      }
    | undefined
  >(undefined);
  const suppressCanvasClick = useRef(false);
  const directDrag = useRef<number | undefined>(undefined);
  const [term, setTerm] = useState<string>(),
    [overlay, setOverlay] = useState<"none" | "dependencies" | "requirements">(
      "none",
    ),
    [compare, setCompare] = useState(false),
    [palette, setPalette] = useState<"slash" | "search">(),
    [query, setQuery] = useState(""),
    [concept, setConcept] = useState<string>(),
    [history, setHistory] = useState(false),
    [feedback, setFeedback] = useState<{ text: string; at?: Point }>({
      text: "",
    });
  const message = feedback.text;
  function setMessage(text: string) {
    if (!text) {
      setFeedback({ text });
      return;
    }
    const control = document.activeElement?.closest(
      "button,input,textarea,select,[role=button],summary",
    );
    const rect = control?.getBoundingClientRect();
    const at =
      rect?.width && rect.height
        ? { x: rect.left, y: rect.bottom }
        : actionPointer.current;
    setFeedback({ text, at });
  }
  const initialSystem =
    (resume?.system?.open ?? false) &&
    !resume?.scope &&
    (page.models?.length || 0) > 1;
  const fitSystemZoom = () =>
    Math.max(
      0.35,
      Math.min(
        1,
        (window.innerWidth - 80) / 1680,
        (window.innerHeight - 130) / 900,
      ),
    );
  const [zoom, setZoom] = useState(
    initialSystem && !resume?.system
      ? fitSystemZoom()
      : resume?.camera.zoom || 1,
  );
  const [legacyTitle] = useState(() => {
    try {
      const saved = localStorage.getItem(
        workspaceStorage("manifold.canvas-title.v1"),
      );
      return saved && saved !== "Untitled page"
        ? documentTitle(saved)
        : undefined;
    } catch {
      return undefined;
    }
  });
  const title = page.title ?? legacyTitle ?? UNTITLED_DOCUMENT;
  const [dragPreview, setDragPreview] = useState<Record<string, Point>>({});
  const dragFrame = useFrameTask<Record<string, Point>>(setDragPreview);
  useEffect(() => {
    document.title = `${title} — Manifold`;
    if (!artifactMode) return;
    if (page.title === undefined && legacyTitle)
      session.renameDocument(legacyTitle);
    if (page.title !== undefined) {
      try {
        localStorage.removeItem(workspaceStorage("manifold.canvas-title.v1"));
      } catch {
        /* The engineering archive reports unavailable local storage. */
      }
    }
  }, [title, page.title, legacyTitle, session, artifactMode]);
  const flowPlaces = useMemo(() => {
    const places = { ...basePlaces, ...dragPreview };
    if (dataSelection && !!dataSelection.detail && dataSelection.rows.length) {
      const expanded = (page.dataRelations || []).filter(
        (r) =>
          r.dataset === dataSelection.dataset &&
          (!dataSelection.relation || r.id === dataSelection.relation) &&
          !(dataSelection.detail === "calculation"
            ? page.layout[r.output]
            : page.layout[dataSelection.view || ""]) &&
          editing !== r.output,
      );
      for (const r of page.regions)
        if (!page.layout[r.id])
          for (const relation of expanded)
            if (
              basePlaces[r.id].y >
              basePlaces[
                dataSelection.detail === "requirement"
                  ? dataSelection.view!
                  : relation.output
              ].y
            )
              places[r.id] = {
                ...places[r.id],
                y:
                  places[r.id].y +
                  (dataSelection.detail === "requirement"
                    ? 115
                    : dataSelection.rows.length > 1
                      ? 170
                      : 145),
              };
    }
    return places;
  }, [basePlaces, dragPreview, dataSelection, page, editing]);

  const editor = useRef<HTMLTextAreaElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    skipBlur = useRef(false),
    drag = useRef<
      { id: string; x: number; y: number; start: Point } | undefined
    >(undefined);
  const navigation = useCanvasNavigation(
    canvas,
    zoom,
    setZoom,
    !artifactMode || areaCanvasVisible,
    () => fit(),
  );
  const selectedPlot = page.plots.find((plot) => plot.id === selected),
    selectedId =
      selectedPlot?.output ||
      (selected && p.statements.has(selected) ? selected : undefined);
  const [comparison, setComparison] = useState<{
    context: string;
    output: string;
    input?: string;
  }>();
  const comparisonContext =
    comparison?.context &&
    page.contexts.some((c) => c.id === comparison.context)
      ? comparison.context
      : page.active !== "original"
        ? page.active
        : page.contexts.at(-1)?.id !== "original"
          ? page.contexts.at(-1)?.id
          : undefined;
  const expansionId =
    trials.expand && !editing
      ? term
        ? selectedId
        : overlay === "dependencies"
          ? selectedId ||
            page.regions.find((r) => p.kinds[r.id] === "equation")?.id
          : undefined
      : undefined;
  const showComparison =
    trials.spatial &&
    !(artifactMode && artifacts.length) &&
    compare &&
    comparison &&
    comparisonContext &&
    p.statements.has(comparison.output) &&
    !expansionId;
  const focusedInput =
    term &&
    p.sources[term]?.length === 1 &&
    p.kinds[p.sources[term][0]] === "quantity"
      ? p.sources[term][0]
      : undefined;
  const attachmentAnchor =
    (expansionId && focusedInput ? expansionId : undefined) ||
    (showComparison ? comparison!.output : undefined);
  const attachmentId = expansionId
    ? "relationship-expansion"
    : `comparison-${comparisonContext}`;
  const anchor = attachmentAnchor && basePlaces[attachmentAnchor];
  const [attachmentSizes, setAttachmentSizes] = useState({
    expansion: 420,
    comparison: 280,
  });
  const attachmentHeight = expansionId
    ? attachmentSizes.expansion
    : attachmentSizes.comparison;
  useEffect(() => {
    const node = document.querySelector(
      expansionId
        ? ".er-investigation"
        : showComparison
          ? ".er-spatial-compare"
          : ".er-no-attachment",
    );
    if (!node) return;
    const key = expansionId ? "expansion" : "comparison";
    const measure = () => {
      const height = node.getBoundingClientRect().height / zoom;
      setAttachmentSizes((s) =>
        Math.abs(s[key] - height) > 1 ? { ...s, [key]: height } : s,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [expansionId, focusedInput, !!showComparison, zoom]);
  const attachmentManual = !expansionId && page.layout[attachmentId];
  const inlineAttachment =
    !!anchor &&
    !attachmentManual &&
    (Boolean(expansionId) || viewportWidth / zoom < 1330);
  const attachmentAt = anchor
    ? attachmentManual || {
        x: expansionId
          ? anchor.x + 130
          : inlineAttachment
            ? anchor.x
            : anchor.x + 630,
        y: inlineAttachment
          ? anchor.y + (expansionId ? 165 : 90)
          : Math.max(
              anchor.y,
              ...page.plots
                .filter(
                  (plot) =>
                    Math.abs(basePlaces[plot.id].x - (anchor.x + 630)) < 500,
                )
                .map((plot) => basePlaces[plot.id].y + plot.height + 65),
            ),
      }
    : { x: 110, y: 110 };
  let places = useMemo(() => {
    const places = { ...flowPlaces };
    if (inlineAttachment) {
      for (const region of page.regions)
        if (
          region.id !== attachmentAnchor &&
          !page.layout[region.id] &&
          basePlaces[region.id].y > anchor!.y
        )
          places[region.id] = {
            ...places[region.id],
            y:
              places[region.id].y + attachmentHeight + (expansionId ? 100 : 25),
          };
      for (const plot of page.plots)
        if (!plot.at)
          places[plot.id] = { ...places[plot.id], y: places[plot.output].y };
    }
    if (expansionId && !focusedInput)
      for (const region of page.regions)
        if (
          region.id !== expansionId &&
          !page.layout[region.id] &&
          basePlaces[region.id].y > basePlaces[expansionId].y
        )
          places[region.id] = {
            ...places[region.id],
            y: places[region.id].y + 85,
          };
    // Automatic flow finds room around fixed work; authored placements never move.
    if (artifactMode) {
      const occupied = [
        ...artifactFrames.map((a) => ({
          ...a.at,
          width: a.width,
          height: a.height,
        })),
        ...page.regions
          .filter((r) => page.layout[r.id])
          .map((r) => ({
            ...page.layout[r.id],
            width: 500,
            height: regionAdvance(r.text, regionHeights[r.id]) - 16,
          })),
      ];
      let nextY = page.origin.y;
      for (const r of page.regions) {
        if (page.layout[r.id] || dragPreview[r.id]) continue;
        const height = regionAdvance(r.text, regionHeights[r.id]);
        places[r.id] = freeRegionPosition(
          { ...places[r.id], y: Math.max(places[r.id].y, nextY) },
          height,
          occupied,
        );
        nextY = places[r.id].y + height;
      }
    }
    return places;
  }, [
    flowPlaces,
    inlineAttachment,
    page,
    basePlaces,
    anchor,
    attachmentAnchor,
    attachmentHeight,
    expansionId,
    focusedInput,
    artifactMode,
    artifactFrames,
    regionHeights,
    dragPreview,
  ]);
  const canvasPoint = (clientX: number, clientY: number): Point => {
    const node = canvas.current!,
      rect = node.getBoundingClientRect();
    return {
      x: (clientX - rect.left + viewportScroll(node).x) / zoom,
      y: (clientY - rect.top + viewportScroll(node).y) / zoom,
    };
  };
  const readCanvasFrames = (ids?: ReadonlySet<string>): CanvasFrame[] => {
    if (marqueeGesture.current?.frames)
      return marqueeGesture.current.frames.filter((f) => !ids || ids.has(f.id));
    const node = canvas.current;
    if (!node) return [];
    const origin = node.getBoundingClientRect(),
      scroll = viewportScroll(node);
    const frames: CanvasFrame[] = [
      ...node.querySelectorAll<HTMLElement>(
        "[data-region-id],[data-plot-id],[data-view-id],[data-tool-id],[data-data-relation-id],[data-model-id]",
      ),
    ]
      .filter(
        (el) =>
          (!ids || ids.has(canvasObjectId(el)!)) &&
          el.getClientRects().length > 0,
      )
      .map((el) => {
        const rect = el.getBoundingClientRect(),
          region = el.dataset.regionId;
        let right = rect.right,
          bottom = rect.bottom;
        if (region) {
          const parts = [
            ...el.querySelectorAll(
              "math,.er-result,.er-condition,.er-region-error,textarea,.er-data,.er-external-reference,.er-source-caption,.er-record-feedback",
            ),
          ].map((part) => part.getBoundingClientRect());
          const note = el.querySelector(".er-note");
          if (note) {
            const range = document.createRange();
            range.selectNodeContents(note);
            parts.push(range.getBoundingClientRect());
          }
          if (parts.length) {
            right = Math.max(...parts.map((r) => r.right));
            bottom = Math.max(
              rect.top + 50 * zoom,
              ...parts.map((r) => r.bottom),
            );
          }
        }
        return {
          id:
            region ||
            el.dataset.viewId ||
            el.dataset.toolId ||
            el.dataset.modelId ||
            el.dataset.dataRelationId ||
            el.dataset.plotId!,
          kind: region ? "region" : "plot",
          x: (rect.left - origin.left + scroll.x) / zoom,
          y: (rect.top - origin.top + scroll.y) / zoom,
          width: Math.max(30, (right - rect.left) / zoom),
          height: Math.max(30, (bottom - rect.top) / zoom),
        };
      });
    // One traversal, not one selector search per drawing (quadratic on dense scenes).
    const visibleDrawings = new Set(
      [...node.querySelectorAll<HTMLElement>("[data-drawing-id]")]
        .filter(
          (el) =>
            (!ids || ids.has(el.dataset.drawingId!)) &&
            el.getClientRects().length,
        )
        .map((el) => el.dataset.drawingId!),
    );
    return [
      ...frames,
      ...spatial.frames.filter(
        (f) => f.kind === "drawing" && visibleDrawings.has(f.id),
      ),
    ];
  };
  function updateMarquee(clientX: number, clientY: number, pointerId: number) {
    const gesture = marqueeGesture.current;
    if (
      !gesture ||
      gesture.pointerId !== pointerId ||
      (!gesture.moved &&
        Math.hypot(clientX - gesture.client.x, clientY - gesture.client.y) < 5)
    )
      return;
    if (!gesture.moved) {
      // Measure once, after any writer commit has rendered, not on every move.
      gesture.frames = readCanvasFrames();
      gesture.areaIds = new Set(
        drawingEntries.filter((e) => e.mark.kind === "area").map((e) => e.id),
      );
      setMarquee(true);
      setSelected(undefined);
      setArtifactFocus(undefined);
      setTerm(undefined);
      setOverlay("none");
    }
    gesture.moved = true;
    suppressCanvasClick.current = true;
    const rect = selectionRect(gesture.start, canvasPoint(clientX, clientY));
    marqueeRect.current = rect;
    paintMarquee();
    // A marquee inside an area selects its contents, not the entire physical area.
    const areaIds = gesture.areaIds!;
    const hits = gesture
      .frames!.filter(
        (f) =>
          touches(rect, f) &&
          (!areaIds.has(f.id) ||
            (rect.x <= f.x &&
              rect.y <= f.y &&
              rect.x + rect.width >= f.x + f.width &&
              rect.y + rect.height >= f.y + f.height)),
      )
      .map((f) => f.id);
    const ids = [
      ...new Set([...(gesture.additive ? gesture.previous : []), ...hits]),
    ];
    setCanvasSelection((previous) =>
      previous.length === ids.length && previous.every((id, i) => id === ids[i])
        ? previous
        : ids,
    );
  }
  function paintMarquee() {
    const node = marqueeElement.current,
      rect = marqueeRect.current;
    if (!node || !rect) return;
    node.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }
  useLayoutEffect(paintMarquee, [marquee]);
  const marqueeFrame = useFrameTask(
    (event: { clientX: number; clientY: number; pointerId: number }) =>
      updateMarquee(event.clientX, event.clientY, event.pointerId),
  );
  const overlaps = useCanvasOverlaps({
    canvas,
    zoom,
    readFrames: readCanvasFrames,
    point: canvasPoint,
    epoch: `${session.document.document}:${session.document.id}`,
  });
  useEffect(() => {
    lastCanvasPress.current = undefined;
  }, [session.document.document]);
  const objectLabel = (id: string) => {
    const region = page.regions.find((r) => r.id === id),
      tool = session.scene.tools.find((t) => t.id === id),
      plot = page.plots.find((p) => p.id === id),
      artifact = artifacts.find(
        (a) => a.id === id || a.views?.some((v) => v.id === id),
      );
    if (region)
      return `${p.statements.get(id)?.name || region.label || region.data?.name || region.text.slice(0, 48) || "Text"} · ${region.data ? "dataset" : p.kinds[id] || "note"}`;
    if (tool)
      return `${tool.editor} tool · ${p.statements.get(tool.object)?.name || tool.object}`;
    if (plot)
      return `${p.statements.get(plot.output)?.name || "Result"} vs ${p.statements.get(plot.input)?.name || "input"} · response plot`;
    if (artifact)
      return `${p.statements.get(artifact.output)?.name || "Result"} · ${artifact.id === id ? artifact.renderer : artifact.views?.find((v) => v.id === id)?.renderer || "view"}`;
    return (
      page.models?.find((m) => m.id === id)?.name || `View ${id.slice(-8)}`
    );
  };
  const spatial = useCanvasScene({
    sceneError: initial.data?.sceneError,
    page,
    session,
    artifacts,
    canvas,
    zoom,
    setZoom,
    places,
    readFrames: readCanvasFrames,
    extraFrames,
  });
  useEffect(() => {
    dragFrame.cancel();
    drag.current = undefined;
    setDragPreview({});
  }, [spatial.cancelVersion, dragFrame]);
  places = { ...places, ...spatial.preview };
  const drawingPlacements = useMemo(
    () =>
      Object.fromEntries(
        spatial.frames
          .filter((f) => f.kind === "drawing")
          .map((f) => [f.id, { x: f.x, y: f.y }]),
      ),
    [spatial.frames],
  );
  const [viewName, setViewName] = useState("");
  const [modelReview, setModelReview] = useState<{
    members: string[];
    existing?: NestedModel;
  }>();
  const [modelTrace, setModelTrace] = useState<string>();
  const [modelConnection, setModelConnection] = useState<string>();
  const [modelConnectionTarget, setModelConnectionTarget] = useState<string>();
  const hierarchy = useModels({
    initial: resume,
    page,
    artifacts,
    tools: spatial.scene.tools,
    canvas,
    zoom,
    setZoom,
    frames: readCanvasFrames,
    clear: () => {
      setDataSelection(undefined);
      setCanvasSelection([]);
      setArtifactFocus(undefined);
      setTerm(undefined);
      setOverlay("none");
      setLinkMenu(undefined);
      setModelTrace(undefined);
    },
    select: setSelected,
    view: () => (systemActive ? "system" : "canvas"),
    restoreView: (view) => setSystemOpen(view === "system"),
  });
  const [systemOpen, setSystemOpen] = useState(resume?.system?.open ?? false);
  const [systemInvestigating, setSystemInvestigating] = useState(
    resume?.system?.investigating ?? false,
  );
  const [systemFailure, setSystemFailure] = useState<string | undefined>(
    resume?.system?.failure,
  );
  const [systemPath, setSystemPath] = useState<InvestigationPath>();
  const [systemReference, setSystemReference] = useState<string>();
  const [systemResponse, setSystemResponse] = useState<InvestigationView>(
    resume?.system?.inspectionVersion === 2
      ? resume.system.response || "contextual"
      : resume?.system?.response === "detached"
        ? "detached"
        : "contextual",
  );
  const [systemAnchor, setSystemAnchor] = useState<string | undefined>(
    resume?.system?.anchor,
  );
  const [systemPositions, setSystemPositions] = useState<Record<string, Point>>(
    resume?.system?.positions || {},
  );
  const [systemInput, setSystemInput] = useState<string | undefined>(
    resume?.system?.input ||
      page.models?.find((m) => m.presentation?.exploreInput)?.presentation
        ?.exploreInput,
  );
  const [systemOutput, setSystemOutput] = useState<string | undefined>(
    resume?.system?.output || findBalance(page)?.output,
  );
  const systemCanvasCamera = useRef(
    resume?.system?.canvas ||
      (initialSystem ? resume?.camera || { x: 0, y: 0, zoom: 1 } : undefined),
  );
  const systemActive =
    systemOpen && !hierarchy.scope && (page.models?.length || 0) > 1;
  const openSystem = () => {
    if (editing && !commit()) return;
    setEditing(undefined);
    if (!systemOpen)
      systemCanvasCamera.current = {
        x: viewportScroll(canvas.current).x,
        y: viewportScroll(canvas.current).y,
        zoom,
      };
    if (hierarchy.scope) hierarchy.go(undefined);
    setSystemOpen(true);
    if (!systemOutput) setSystemOutput(findBalance(page)?.output);
    if (!systemInput)
      setSystemInput(
        page.models?.find((m) => m.presentation?.exploreInput)?.presentation
          ?.exploreInput ||
          (findBalance(page)
            ? balanceInputs(page, findBalance(page)!)[0]
            : undefined) ||
          page.regions.find((r) => p.kinds[r.id] === "quantity")?.id,
      );
    if (!hierarchy.scope) {
      setZoom(fitSystemZoom());
      requestAnimationFrame(() =>
        scrollCanvasTo(canvas.current, { left: 0, top: 0 }),
      );
    }
  };
  const closeSystem = () => {
    setOverlay("none");
    setSystemOpen(false);
    const prior = systemCanvasCamera.current;
    if (prior) {
      setZoom(prior.zoom);
      hierarchy.cameras.set("root", prior);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          scrollCanvasTo(canvas.current, { left: prior.x, top: prior.y }),
        ),
      );
    }
  };
  const enterSystemModel = (id: string) => {
    if (editing && !commit()) return;
    setEditing(undefined);
    hierarchy.go(id);
  };
  const followSystemQuantity = (id: string) => {
    if (editing && !commit()) return;
    setEditing(undefined);
    if (p.kinds[id] === "quantity" && !systemInvestigating) setSystemInput(id);
    hierarchy.reveal(id);
    if (!hierarchy.owner(id)) setSystemOpen(false);
  };
  const investigateFailure = (id: string) => {
    if (editing && !commit()) return;
    const check = assessConstraint(working, id);
    if (!check) {
      followSystemQuantity(id);
      return;
    }
    setEditing(undefined);
    setSystemFailure(id);
    setSystemOutput(check.definition);
    setSystemAnchor(hierarchy.owner(id));
    setSelected(hierarchy.owner(id) || id);
    setSystemPath(undefined);
    setSystemResponse("contextual");
    setSystemInvestigating(true);
    setOverlay("none");
    // Follow the engineering question with the camera; never move its models.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        revealCanvasElement(canvas.current?.querySelector(".sx-failure"), {
          block: "nearest",
          inline: "nearest",
        }),
      ),
    );
  };
  const hierarchyRepresentations = artifacts.map((a) => ({
    id: a.id,
    input: a.input,
    output: a.output,
  }));
  const prepareModel = (ids: string[]) => {
    if (editing && !commit()) return;
    const members = [...new Set(ids.map(hierarchy.canonical))];
    if (!members.length) return;
    setModelReview({ members });
  };
  for (const f of spatial.frames)
    if (!hierarchy.visible(f.id)) spatial.hidden.add(f.id);

  useLayoutEffect(() => {
    const frames = canvasSelection.length
      ? (spatial.moving() ? spatial.frames : readCanvasFrames()).filter((f) =>
          canvasSelection.includes(f.id),
        )
      : [];
    setSelectedFrames((previous) =>
      previous.length === frames.length &&
      previous.every(
        (f, i) =>
          f.id === frames[i].id &&
          f.x === frames[i].x &&
          f.y === frames[i].y &&
          f.width === frames[i].width &&
          f.height === frames[i].height,
      )
        ? previous
        : frames,
    );
  }, [
    canvasSelection,
    page,
    artifacts,
    artifactHeights,
    drawingEntries,
    zoom,
    editing,
    term,
    overlay,
    dragPreview,
    spatial.preview,
  ]);
  // Measured heights are presentation state, never accepted layout or history.
  useLayoutEffect(() => {
    const nodes =
      canvas.current?.querySelectorAll<HTMLElement>("[data-region-id]");
    if (!nodes) return;
    const ids = new Set(page.regions.map((r) => r.id));
    let active = true;
    const measure = () => {
      if (!active) return;
      const heights: Record<string, number> = Object.create(null);
      for (const node of nodes) {
        const id = node.dataset.regionId!;
        if (id === editing) continue;
        const height = node.getBoundingClientRect().height / zoom;
        if (height > 0) heights[id] = height;
      }
      setRegionHeights((previous) => {
        const next: Record<string, number> = Object.create(null);
        for (const [id, height] of Object.entries(previous))
          if (ids.has(id)) next[id] = height;
        let changed = Object.keys(next).length !== Object.keys(previous).length;
        for (const [id, height] of Object.entries(heights))
          if (Math.abs((previous[id] ?? 0) - height) > 0.5) {
            next[id] = height;
            changed = true;
          }
        return changed ? next : previous;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const node of nodes) observer.observe(node);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [page.regions, editing, zoom]);
  const selectionBounds = frameBounds(selectedFrames);
  const organizeSelection = () => {
    const frames = readCanvasFrames().filter((f) =>
        canvasSelection.includes(f.id),
      ),
      bounds = frameBounds(frames);
    if (!bounds || frames.length < 2) return;
    const available =
      (canvas.current!.clientWidth + viewportScroll(canvas.current!).x - 32) /
        zoom -
      bounds.x;
    const placements = organizeFrames(frames, available);
    if (
      !frames.some(
        (f) =>
          Math.abs(f.x - placements[f.id].x) > 0.5 ||
          Math.abs(f.y - placements[f.id].y) > 0.5,
      )
    )
      return;
    spatial.patchPositions(placements);
  };
  const groupSelection = () => {
    const ids = selectedFrames.map((f) => f.id);
    if (ids.length < 2) return;
    let groups = spatial.scene.groups;
    for (const id of ids.slice(1))
      groups = dockObjects(groups, id, ids[0], "stack");
    spatial.setScene((s) => ({
      ...s,
      groups: groups.map((g) =>
        g.members.includes(ids[0]) ? { ...g, auto: false } : g,
      ),
    }));
    setCanvasSelection([]);
  };
  const selectionReason = selectionEditReason(session, canvasSelection);
  const duplicateSelected = () => {
    try {
      const placements = Object.fromEntries(
        readCanvasFrames().map((f) => [f.id, { x: f.x, y: f.y }]),
      );
      setCanvasSelection(
        duplicateSelection(session, canvasSelection, placements),
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const deleteSelected = () => {
    try {
      deleteSelection(session, canvasSelection);
      setCanvasSelection([]);
      setSelected(undefined);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const nudgeSelection = (delta: Point) => {
    const frames = readCanvasFrames().filter((f) =>
      canvasSelection.includes(f.id),
    );
    spatial.patchPositions(
      Object.fromEntries(
        frames.map((f) => [f.id, { x: f.x + delta.x, y: f.y + delta.y }]),
      ),
    );
  };
  const selectedEvidence = page.regions.find(
    (r) => r.id === (areaSelection || selected),
  )?.source;
  const activeData =
    dataSelection ||
    (selectedEvidence
      ? {
          dataset: selectedEvidence.dataset,
          rows: [selectedEvidence.row],
          columns: [selectedEvidence.column],
        }
      : undefined);
  const scalarData = activeData
    ? page.regions.filter(
        (r) =>
          r.source?.dataset === activeData?.dataset &&
          (!activeData?.columns.length ||
            activeData.columns.includes(r.source!.column)),
      )
    : [];
  const scalarDataIds = new Set(scalarData.map((r) => r.id));
  for (const r of page.regions)
    if (ancestors(accepted, r.id).some((id) => scalarDataIds.has(id)))
      scalarDataIds.add(r.id);
  const relatedData = (page.dataRelations || []).filter(
    (r) =>
      r.dataset === activeData?.dataset &&
      (!activeData?.relation || activeData.relation === r.id),
  );
  const dataSymbols = new Set([
    ...scalarData.map((r) => accepted.statements.get(r.id)?.name || ""),
    ...relatedData.flatMap((r) =>
      r.bindings
        .filter(
          (b) =>
            !activeData?.columns.length ||
            activeData.columns.includes(b.column),
        )
        .map((b) =>
          b.quantity
            ? accepted.statements.get(b.quantity)?.name || b.symbol
            : b.symbol,
        ),
    ),
  ]);
  const dataRelatedIds = new Set([
    ...scalarDataIds,
    ...(activeData ? [activeData.dataset] : []),
    ...relatedData.flatMap((r) => [
      r.dataset,
      r.output,
      ...r.bindings.map((b) => b.quantity).filter((id): id is string => !!id),
      ...[...accepted.statements]
        .filter(
          ([, s]) =>
            s.relation !== "=" &&
            s.name === accepted.statements.get(r.output)?.name,
        )
        .map(([id]) => id),
    ]),
  ]);
  const relationshipNav = useRelationshipNavigation({
    page,
    selection: activeData,
    canvas,
    zoom,
    setZoom,
    frames: readCanvasFrames,
    collapsed: collapsedData,
    setCollapsed: setCollapsedData,
    persist: (positions) => spatial.patchPositions(positions),
    choose: (selection) => {
      if (selection) {
        const target = selection.view || selection.dataset;
        if (!hierarchy.visible(target)) hierarchy.reveal(target);
        chooseData(selection);
      } else {
        setDataSelection(undefined);
        setAreaSelection(undefined);
        setSelected(undefined);
      }
    },
  });
  const activeRelation =
    relatedData.find(
      (r) => r.id === (activeData?.relation || relationshipNav.focus?.relation),
    ) || relatedData[0];
  if (relationshipNav.focus)
    places = { ...places, ...relationshipNav.focus.positions };
  const linkedArtifact = artifacts.find((a) => a.id === artifactFocus?.id);
  const linkedName =
    linkedArtifact &&
    accepted.statements.get(
      artifactFocus?.target === "input" ||
        artifactFocus?.target === "point" ||
        artifactFocus?.target === "range"
        ? artifactFocus?.quantity || linkedArtifact.input
        : linkedArtifact.output,
    )?.name;
  const linkedRequirement =
    linkedArtifact &&
    (linkedArtifact.requirement ||
      [...accepted.statements].find(
        ([, s]) =>
          s.relation !== "=" &&
          s.name === accepted.statements.get(linkedArtifact.output)?.name,
      )?.[0]);
  const pointControls = artifactFocus?.target === "point" && linkedArtifact;
  function undo(mode: "workspace" | "artifact" | "recovery" = "workspace") {
    if (mode === "workspace" && exploration) {
      revertExploration();
      return;
    }
    session.undo();
    if (mode === "workspace") setEditing(undefined);
    else clearRecovery();
    if (mode !== "recovery") revertExploration();
  }
  const chooseTerm = (id: string, name: string) => {
    setSelectionDetail({
      owner: id,
      kind: accepted.statements.get(id)?.name === name ? "result" : "term",
      symbol: name,
    });
    revealAreaCanvas.current?.();
    const source = accepted.sources[name]?.[0];
    if (source && !hierarchy.visible(source)) {
      setModelTrace(source);
      return;
    }
    setSelected(id);
    const a =
      artifactMode && artifacts.find((a) => a.output === id || a.input === id);
    if (a) {
      const quantity = accepted.sources[name]?.[0];
      setArtifactFocus({
        id: a.id,
        target:
          quantity && accepted.kinds[quantity] === "quantity"
            ? "input"
            : "expression",
        quantity,
      });
      setTerm(undefined);
      return;
    }
    setTerm(name);
  };
  const related = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    ids.add(selectedId);
    ancestors(p, selectedId).forEach((id) => ids.add(id));
    for (const r of page.regions)
      if (ancestors(p, r.id).includes(selectedId)) ids.add(r.id);
    return ids;
  }, [page, selectedId, p]);
  const begin = (id: string, span?: { start: number; end: number }) => {
    if (page.regions.find((r) => r.id === id)?.external) {
      setReferenceEditor(id);
      return;
    }
    revealAreaCanvas.current?.();
    setCanvasSelection([]);
    revertExploration();
    setSelected(id);
    setEditing(id);
    setDraft(accepted.texts[id] ?? "");
    setDraftLinks(page.links?.[id] || {});
    setCaret(span?.start ?? (accepted.texts[id] || "").length);
    setMentionDismissed(false);
    setLinkMenu(undefined);
    setSelectionSpan(
      exploration?.input === id
        ? sourceSpans(accepted.texts[id] || "")[0]
        : span,
    );
    setTerm(undefined);
    setMessage("");
    skipBlur.current = false;
  };
  useEffect(() => {
    if (editing) {
      editor.current?.focus();
      const end = editor.current?.value.length || 0;
      editor.current?.setSelectionRange(
        selectionSpan?.start ?? end,
        selectionSpan?.end ?? end,
      );
    }
  }, [editing, selectionSpan]);
  useLayoutEffect(() => {
    if (editing)
      revealCanvasElement(editor.current, {
        block: "nearest",
        inline: "nearest",
      });
  }, [editing, draft, selectionSpan]);
  const writingPoint = () => {
    const at = {
      x: viewportScroll(canvas.current).x / zoom + 110,
      y: viewportScroll(canvas.current).y / zoom + 110,
    };
    // Find room below existing work. Explicit pointer placement stays freeform.
    for (const frame of readCanvasFrames().sort((a, b) => a.y - b.y)) {
      if (
        at.x < frame.x + frame.width &&
        at.x + 460 > frame.x &&
        at.y < frame.y + frame.height &&
        at.y + 70 > frame.y
      )
        at.y = frame.y + frame.height + 28;
    }
    return at;
  };
  const fresh = (at?: Point, text = "") => {
    if (systemActive) closeSystem();
    setDataSelection(undefined);
    setAreaSelection(undefined);
    setDataReview(undefined);
    revealAreaCanvas.current?.();
    if (editing && !commit()) return;
    setCanvasSelection([]);
    revertExploration();
    const id = session.create(at, hierarchy.scope);
    setSelected(id);
    setEditing(id);
    setDraft(text);
    setSelectionSpan(undefined);
    setDraftLinks({});
    setCaret(0);
    setMentionDismissed(false);
    setLinkMenu(undefined);
    setTerm(undefined);
    skipBlur.current = false;
  };
  const commit = (continuation = false) => {
    if (!editing) return true;
    let result: ReturnType<RegionSession["write"]>;
    try {
      result = session.atomic((staged) => {
        const result = staged.write(
          editing,
          draft,
          continuation,
          Object.keys(draftLinks).length ? draftLinks : undefined,
        );
        if (!result.ok) throw Error(result.error || "Could not use this edit.");
        if (continuation && result.next && page.layout[editing]) {
          const at = places[editing];
          const advance = Math.max(
            regionAdvance(draft, regionHeights[editing]),
            (editor.current?.getBoundingClientRect().height ?? 0) / zoom + 16,
          );
          const occupied = readCanvasFrames().filter(
            (f) =>
              f.id !== editing &&
              f.id !== result.next &&
              hierarchy.visible(f.id),
          );
          staged.move(
            result.next,
            freeRegionPosition(
              { x: at.x, y: at.y + advance },
              REGION_STEP,
              occupied,
            ),
          );
        }
        return result;
      });
    } catch (error) {
      setMessage((error as Error).message);
      return false;
    }
    if (continuation && result.next) {
      setSelected(result.next);
      setEditing(result.next);
      setDraft("");
      setDraftLinks({});
      setCaret(0);
      setMentionDismissed(false);
      setSelectionSpan(undefined);
    } else {
      setEditing(undefined);
      const retained = session.state.regions.some((r) => r.id === editing);
      setCanvasSelection(retained ? [editing] : []);
      if (!retained) setSelected(undefined);
    }
    return true;
  };
  const plotSelection = (candidate?: string) => {
    if (artifactMode) {
      createArtifact(undefined, candidate);
      return;
    }
    const id = candidate || (term && p.sources[term]?.[0]) || selectedId;
    if (!id) return;
    let output = id,
      input: string | undefined;
    if (p.kinds[id] === "quantity") {
      input = id;
      output =
        page.regions.find(
          (r) =>
            p.kinds[r.id] === "equation" && ancestors(p, r.id).includes(id),
        )?.id || "";
    } else
      input = ancestors(p, id)
        .filter((ref) => p.kinds[ref] === "quantity")
        .sort((a, b) =>
          (p.statements.get(a)?.name || "").localeCompare(
            p.statements.get(b)?.name || "",
          ),
        )[0];
    if (!input || !output) {
      setMessage(
        "Select a resolved equation or an assigned quantity with a downstream equation.",
      );
      return;
    }
    try {
      const id = session.addPlot(output, input);
      setSelected(id);
      setTerm(undefined);
      setPalette(undefined);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const branchFor = (focus?: string) => {
    if (exploration) {
      setMessage(
        "Accept or revert the preview before creating an alternative.",
      );
      return;
    }
    if (
      !page.regions.some(
        (r) =>
          accepted.kinds[r.id] === "quantity" && !accepted.errors.has(r.id),
      )
    ) {
      setMessage("Define an assigned quantity before trying an alternative.");
      return;
    }
    const output =
      focus && accepted.kinds[focus] === "equation"
        ? focus
        : responseFor(page, focus || "")?.output ||
          page.regions.find((r) => accepted.kinds[r.id] === "equation")?.id;
    const context = session.atomic((staged) => {
      const context = staged.branch();
      if (output && artifactMode)
        staged.setArtifacts((items) =>
          items.map((item) =>
            item.output === output
              ? { ...item, compareContext: page.active, comparing: true }
              : item,
          ),
        );
      return context;
    });
    const input =
      focus && accepted.kinds[focus] === "quantity"
        ? focus
        : output && responseFor(page, output)?.input;
    if (output) setComparison({ context, output, input: input || undefined });
    setCompare(!quiet);
    setOverlay("none");
    setPalette(undefined);
    setTerm(undefined);
    setMessage("");
  };
  const branch = () => branchFor(selectedId);
  const fit = () => {
    revealAreaCanvas.current?.();
    requestAnimationFrame(() => {
      const bounds = systemActive
          ? frameBounds([
              ...readCanvasFrames().filter((f) =>
                page.models?.some((m) => m.id === f.id),
              ),
              {
                id: "$system",
                kind: "plot",
                x: 40,
                y: 90,
                width:
                  canvas.current?.querySelector<HTMLElement>(
                    "[data-system-overview]",
                  )?.offsetWidth || 1600,
                height:
                  canvas.current?.querySelector<HTMLElement>(
                    "[data-system-overview]",
                  )?.offsetHeight || 850,
              },
            ])
          : frameBounds([
              ...drawingFrames,
              ...spatial.frames
                .filter(
                  (f) => hierarchy.visible(f.id) && !spatial.closed.has(f.id),
                )
                .map((f) => ({ ...f, ...places[f.id] })),
              ...(attachmentAnchor
                ? [
                    {
                      id: attachmentId,
                      kind: "plot" as const,
                      ...attachmentAt,
                      width: 600,
                      height: attachmentHeight,
                    },
                  ]
                : []),
            ]),
        viewport = canvas.current;
      if (!bounds || !viewport) return;
      const z = Math.max(
        0.1,
        Math.min(
          1,
          (viewport.clientWidth - 120) / bounds.width,
          (viewport.clientHeight - 160) / bounds.height,
        ),
      );
      setZoom(z);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          scrollCanvasTo(viewport, {
            left: bounds.x * z - 60,
            top: bounds.y * z - 110,
          }),
        ),
      );
    });
  };
  const openShortcuts = () => {
    if (
      document.activeElement instanceof HTMLTextAreaElement &&
      document.activeElement.closest(".er-region.is-editing")
    )
      skipBlur.current = true;
    setPalette(undefined);
    setActionMenu(undefined);
    setShortcutsOpen(true);
  };
  const performShortcut = (action: ShortcutAction) => {
    switch (action) {
      case "search.open":
        paletteOpen("search");
        break;
      case "canvas.fit":
        fit();
        break;
      case "canvas.undo":
        undo();
        break;
      case "canvas.redo":
        session.redo();
        break;
      case "help.shortcuts":
        openShortcuts();
        break;
    }
  };
  const paletteOpen = (kind: "slash" | "search") => {
    setPalette(kind);
    setQuery("");
    setConcept(undefined);
  };
  useEffect(() => {
    // Capture document actions before editors consume their own key events.
    const fileAction = (event: KeyboardEvent) => {
      if (isDialogEvent(event) || actionMenu) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        !(event.ctrlKey && event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        !event.isComposing &&
        !event.getModifierState("AltGraph") &&
        ["s", "o"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          if (event.key.toLowerCase() === "s") void exportArtifacts();
          else workspaceFile.current?.click();
        }
      }
    };
    window.addEventListener("keydown", fileAction, true);
    return () => window.removeEventListener("keydown", fileAction, true);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isCanvasControlEvent(event)) return;
      const active = (event.target as HTMLElement).closest(
        "input,textarea,select,[role=separator],[contenteditable=true]",
      );
      if (actionMenu) return;
      const shortcut = shortcutPreferences.resolve(event);
      if (shortcut) {
        event.preventDefault();
        performShortcut(shortcut);
        return;
      }
      if (
        !active &&
        ((event.shiftKey &&
          event.code === "Space" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.isComposing) ||
          event.key === "ContextMenu" ||
          (event.shiftKey && event.key === "F10"))
      ) {
        event.preventDefault();
        const rect = canvas.current?.getBoundingClientRect();
        if (rect) {
          const focusedObject = canvasObjectId(event.target as Element);
          const point = (event.code !== "Space" &&
            focusedObject &&
            overlaps.keyboardPoint(focusedObject)) ||
            actionPointer.current || {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            };
          const hit = document.elementFromPoint(point.x, point.y);
          if (hit && actionTarget(hit))
            setSelectionDetail(actionDetail(hit, actionTarget(hit)));
          openActionMenu(
            point.x,
            point.y,
            (hit && actionTarget(hit)) || selected,
            event.code === "Space" ? "pie" : "context",
            event.code === "Space",
          );
        }
        return;
      }
      if (!active && event.key === "Escape" && overlaps.picked) {
        overlaps.clear();
        return;
      }
      // Editor-specific search stays fixed; only canvas bindings are configurable.
      if (
        active &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        paletteOpen("search");
        return;
      }
      if (active || navigation.hand) return;
      if (canvasSelection.length && !event.altKey && !event.defaultPrevented) {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "d"
        ) {
          event.preventDefault();
          duplicateSelected();
          return;
        }
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          ["Delete", "Backspace"].includes(event.key)
        ) {
          event.preventDefault();
          deleteSelected();
          return;
        }
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          event.key.startsWith("Arrow") &&
          !(event.target as Element).closest(
            "button,input,textarea,[role=button]",
          )
        ) {
          event.preventDefault();
          const step = event.shiftKey ? 20 : 5;
          nudgeSelection({
            x:
              event.key === "ArrowLeft"
                ? -step
                : event.key === "ArrowRight"
                  ? step
                  : 0,
            y:
              event.key === "ArrowUp"
                ? -step
                : event.key === "ArrowDown"
                  ? step
                  : 0,
          });
          return;
        }
      }
      if (
        (event.target as HTMLElement).closest(
          "button,a,[role=button],summary",
        ) &&
        [
          "Enter",
          " ",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(event.key)
      )
        return;
      // Begin writing in the viewport without choosing an object type.
      // Preserve control activation, composition input, shortcuts and Space-pan.
      if (
        event.key.length === 1 &&
        event.key !== " " &&
        event.key !== "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.isComposing &&
        !event.defaultPrevented &&
        !(event.target as HTMLElement).closest(
          "button,a,summary,[role=button]",
        ) &&
        !editing &&
        !selected &&
        !canvasSelection.length &&
        !palette &&
        !concept &&
        !referenceEditor &&
        !history &&
        !systemActive &&
        !exploration &&
        !dataReview &&
        !linkMenu &&
        !navigation.className
      ) {
        event.preventDefault();
        fresh(writingPoint(), event.key);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        paletteOpen("slash");
      }
      if (event.key === "Escape") {
        if (session.foundation.preview()) {
          session.cancelPreview();
          return;
        }
        if (relationshipNav.focus) {
          event.preventDefault();
          relationshipNav.restore();
          return;
        }
        if (relationshipNav.trace) {
          relationshipNav.setTrace(false);
          return;
        }
        if (dataReview || dataDrag || dataSelection) {
          dataGesture.current = undefined;
          setDataDrag(undefined);
          setDataReview(undefined);
          setDataSelection(undefined);
          suppressCanvasClick.current = true;
          return;
        }
        if (linkGesture.current || linkDrag || linkMenu) {
          linkGesture.current = undefined;
          setLinkDrag(undefined);
          setLinkMenu(undefined);
          suppressCanvasClick.current = true;
          return;
        }
        if (spatial.focus && !exploration && !palette && !term) {
          spatial.restoreFocus();
          return;
        }
        if (marqueeGesture.current) {
          marqueeFrame.cancel();
          const gesture = marqueeGesture.current;
          setCanvasSelection(gesture.previous);
          marqueeGesture.current = undefined;
          setMarquee(false);
          suppressCanvasClick.current = true;
          if (canvas.current?.hasPointerCapture(gesture.pointerId))
            canvas.current.releasePointerCapture(gesture.pointerId);
          return;
        }
        if (canvasSelection.length) {
          setCanvasSelection([]);
          setSelected(undefined);
          return;
        }
        if (exploration) {
          revertExploration();
          return;
        }
        if (artifactFocus) {
          setArtifactFocus(undefined);
          return;
        }
        if (palette) setPalette(undefined);
        else if (term) setTerm(undefined);
        else if (trials.expand && overlay !== "none") setOverlay("none");
        else if (concept) setConcept(undefined);
        else if (history) setHistory(false);
        else setSelected(undefined);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (selectedId || selected) begin(selectedId || selected!);
        else fresh();
      }
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        !systemActive &&
        selected &&
        places[selected]
      ) {
        event.preventDefault();
        const point = places[selected],
          step = event.shiftKey ? 20 : 5;
        session.move(selected, {
          x:
            point.x +
            (event.key === "ArrowRight"
              ? step
              : event.key === "ArrowLeft"
                ? -step
                : 0),
          y:
            point.y +
            (event.key === "ArrowDown"
              ? step
              : event.key === "ArrowUp"
                ? -step
                : 0),
        });
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  useWorkspaceMemory({
    document: session.document.document,
    enabled: artifactMode && !saved?.blocked,
    canvas,
    page,
    zoom,
    scope: hierarchy.scope,
    selected,
    selection: canvasSelection,
    cameras: hierarchy.cameras,
    history: hierarchy.history,
    initial:
      resume && initialSystem && !resume.system
        ? { ...resume, camera: { x: 0, y: 0, zoom } }
        : resume,
    system: {
      open: systemOpen,
      input: systemInput,
      investigating: systemInvestigating,
      anchor: systemAnchor,
      response: systemResponse,
      inspectionVersion: 2,
      positions: systemPositions,
      output: systemOutput,
      failure: systemFailure,
      canvas: systemCanvasCamera.current,
    },
    stable:
      !relationshipNav.focus &&
      !hierarchy.transitioning &&
      !spatial.focus &&
      !editing &&
      !marquee &&
      !spatial.moving(),
  });
  const dependencyEdges = page.regions.flatMap((r) =>
    Object.entries(p.bindings[r.id] || {}).map(([name, id]) => ({
      name,
      from: id,
      to: r.id,
    })),
  );
  const writeSystemInput: (id: string, value: string) => string | undefined = (
    id,
    value,
  ) => {
    const before = project(page),
      statement = before.statements.get(id);
    if (!statement || before.kinds[id] !== "quantity")
      return "Enter the model to edit this relationship.";
    const text = `${statement.name} := ${value}`;
    const trial = new RegionSession(
      page,
      () => [],
      session.document,
      artifacts,
      true,
    );
    const result = trial.write(id, text);
    if (!result.ok) return result.error;
    const after = project(trial.state),
      a = before.solved.values.get(statement.name),
      b = after.solved.values.get(statement.name);
    if (
      !a ||
      !b ||
      !Number.isFinite(b.value) ||
      after.errors.has(id) ||
      after.kinds[id] !== "quantity" ||
      !same(a.dimension, b.dimension) ||
      !!a.absolute !== !!b.absolute
    )
      return "Use a value with the same units as this input.";
    if (
      [...after.errors].some(
        ([key]) =>
          !before.errors.has(key) && ancestors(after, key).includes(id),
      )
    )
      return "This value leaves an affected calculation undefined.";
    const accepted = session.write(id, text);
    return accepted.ok
      ? undefined
      : accepted.error || "Could not change this input.";
  };
  const internalInvestigation =
    systemInvestigating &&
    systemResponse === "internal" &&
    hierarchy.scope === systemAnchor;
  useLayoutEffect(() => {
    if (!internalInvestigation) return;
    let cancelled = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled)
          revealCanvasElement(
            canvas.current?.querySelector(".sx-internal-investigation"),
            { block: "nearest", inline: "nearest" },
          );
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [internalInvestigation, hierarchy.scope]);
  const internalRegions = (
    page.models?.find((m) => m.id === hierarchy.scope)?.members || []
  ).flatMap((id) => {
    const region = page.regions.find((r) => r.id === id);
    if (!region) return [];
    const measured = spatial.frames.find((f) => f.id === id);
    return [
      {
        id,
        ...(places[id] || { x: 100, y: 130 }),
        width: Math.max(550, measured?.width || 0),
        height: Math.max(
          100,
          measured?.height || 0,
          p.kinds[id] === "note"
            ? Math.ceil(region.text.length / 48) * 29 + 45
            : 100,
        ),
      },
    ];
  });
  const internalOrigin = internalRegions.find(
    (r) => p.kinds[r.id] === "quantity",
  ) ||
    internalRegions[0] || {
      id: "origin",
      x: 100,
      y: 170,
      width: 550,
      height: 100,
    };
  const internalAt = placeInvestigation(internalOrigin, internalRegions, {
    width: 520,
    height: 520,
  });
  const width =
    Math.max(
      1100,
      ...(page.models || []).map((m) => hierarchy.at(m.id).x + 420),
      ...page.regions.map((r) => places[r.id].x + 550),
      ...page.plots.map((plot) => places[plot.id].x + plot.width + 70),
      ...(page.dataRelations || []).map((r) => places[r.id].x + 650),
      ...artifactFrames.map((a) => a.at.x + a.width + 70),
      ...modelFrames.map((v) => v.x + 560),
      ...drawingFrames.map((v) => v.x + v.width + 70),
      ...spatial.scene.tools.map((t) => t.at.x + t.width + 70),
      ...(attachmentAnchor ? [attachmentAt.x + 650] : []),
      ...(internalInvestigation ? [internalAt.x + 560] : []),
    ) +
    (canvas.current?.clientWidth || 850) / zoom;
  const height =
    Math.max(
      850,
      ...(page.models || []).map((m) => hierarchy.at(m.id).y + 650),
      ...page.regions.map((r) => places[r.id].y + 200),
      ...page.plots.map((plot) => places[plot.id].y + plot.height + 100),
      ...(page.dataRelations || []).map((r) => places[r.id].y + 600),
      ...artifactFrames.map((a) => a.at.y + a.height + 100),
      ...modelFrames.map((v) => v.y + 740),
      ...drawingFrames.map((v) => v.y + v.height + 70),
      ...spatial.scene.tools.map((t) => t.at.y + t.height + 100),
      ...(attachmentAnchor ? [attachmentAt.y + attachmentHeight + 80] : []),
      ...(internalInvestigation ? [internalAt.y + 600] : []),
    ) +
    (canvas.current?.clientHeight || 800) / zoom;
  const original =
    compare && !(artifactMode && artifacts.length)
      ? project(page, "original")
      : undefined;
  const refs = term ? p.sources[term] || [] : [];
  const contexts = page.contexts;
  const switchScenario = (id: string) => {
    if (editing && !commit()) return;
    session.switchContext(id);
    if (id !== "original" && comparison)
      setComparison({ ...comparison, context: id });
    setEditing(undefined);
    revertExploration();
  };
  const createArtifact = (
    request?: string,
    candidate?: string,
    atOverride?: Point,
    inputOverride?: string,
  ) => {
    try {
      if (artifacts.length >= 16)
        throw Error("This experiment supports up to 16 artifacts.");
      const source = candidate || selectedId;
      if (!source) throw Error("Select the equation to compute from first.");
      const response = responseFor(
        page,
        source,
        inputOverride ? accepted.statements.get(inputOverride)?.name : term,
      );
      if (!response)
        throw Error("Select an equation with resolved assigned inputs.");
      const input = accepted.statements.get(response.input)!;
      const output = accepted.statements.get(response.output)!;
      const q = accepted.solved.values.get(input.name)!;
      const value = q.absolute ? q.value - 273.15 : q.value;
      const delta = Math.abs(value) || 1;
      const generatedRequest = `Plot ${output.name} versus ${input.name} from ${value - delta * 0.75} to ${value + delta * 1.5}`;
      const a = makeArtifact(
        page,
        response.output,
        request || generatedRequest,
      );
      const at = positions(page)[response.output];
      const spot =
        atOverride ||
        (viewportWidth < 1100
          ? { x: at.x, y: at.y + 125 + artifacts.length * 480 }
          : { x: at.x + 555, y: at.y + artifacts.length * 480 });
      if (!atOverride)
        for (const frame of readCanvasFrames().filter(
          (f) =>
            !page.regions.some(
              (r) => r.id === f.id && !r.data && !page.layout[r.id],
            ),
        ))
          if (
            frame.id !== response.output &&
            spot.x < frame.x + frame.width &&
            spot.x + 600 > frame.x &&
            spot.y < frame.y + frame.height &&
            spot.y + 460 > frame.y
          )
            if (
              frame.x + frame.width + 655 <
              (canvas.current?.clientWidth || viewportWidth) / zoom +
                viewportScroll(canvas.current).x / zoom
            )
              spot.x = frame.x + frame.width + 55;
            else spot.y = frame.y + frame.height + 45;
      session.atomic((staged) => {
        staged.setArtifacts((items) => [...items, { ...a, at: spot }]);
        staged.addModelMember(hierarchy.scope, a.id);
      });
      setPalette(undefined);
      setTerm(undefined);
      setOverlay("none");
      setArtifactFocus({ id: a.id, target: "point", view: a.id });
      setLinkMenu(undefined);
      return a.id;
    } catch (e) {
      setMessage((e as Error).message);
      setPalette(undefined);
    }
  };
  const exportArtifacts = async (savedWork = false) => {
    try {
      const text = savedWork
        ? await workspace.rescueSaved()
        : await workspace.export(workspaceEdits);
      if (text === undefined) {
        setMessage("Finish or cancel pending edits before continuing.");
        return;
      }
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = savedWork
        ? "manifold-saved-workspace.manifold"
        : documentFilename(session.state.title);
      link.click();
      if (!savedWork) workspace.acknowledgeExport(text);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "Workspace download started. Keep the .manifold file as a backup or to open on another device. Further edits autosave only in this browser, not to that file.",
      );
    } catch (error) {
      setMessage(`Could not save workspace file: ${(error as Error).message}`);
    }
  };
  const mention =
    editing && !mentionDismissed
      ? /@([A-Za-z_0-9 ]*)$/.exec(draft.slice(0, caret))
      : null;
  const mentionCandidates = mention
    ? page.regions
        .filter((r) => {
          const s = accepted.statements.get(r.id);
          if (
            r.data &&
            !/^\s*[A-Za-z_][A-Za-z_0-9]*\s*(?::=|=|<=|>=|<|>|≤|≥)/.test(draft)
          )
            return r.data.name
              .toLowerCase()
              .includes(mention[1].toLowerCase().trim());
          return (
            r.id !== editing &&
            s?.relation === "=" &&
            accepted.sources[s.name]?.length === 1 &&
            !accepted.errors.has(r.id) &&
            accepted.solved.values.has(s.name) &&
            `${s.name} ${quantityDescription(s.name)}`
              .toLowerCase()
              .includes(mention[1].toLowerCase().trim())
          );
        })
        .slice(0, 8)
    : [];
  useEffect(() => setMentionIndex(0), [mention?.[1]]);
  const insertReference = (source: string) => {
    if (!mention) return;
    const evidence = page.regions.find((r) => r.id === source)?.data;
    let name =
      accepted.statements.get(source)?.name ||
      `data_${(evidence?.name || "source").replace(/\.csv$/i, "").replace(/[^A-Za-z_0-9]/g, "_")}`;
    if (evidence) {
      const base = name;
      let n = 2;
      while (draftLinks[name] && draftLinks[name] !== source)
        name = `${base}_${n++}`;
    }
    const start = caret - mention[0].length,
      end = start + name.length;
    setDraft(draft.slice(0, start) + name + draft.slice(caret));
    setDraftLinks((bindings) => ({ ...bindings, [name]: source }));
    setCaret(end);
    setSelectionSpan({ start: end, end });
    setMentionDismissed(false);
  };
  const targetAt = (x: number, y: number): LinkTarget | undefined => {
    const hit = document.elementFromPoint(x, y),
      object = hit?.closest<HTMLElement>(
        "[data-region-id],[data-view-id],[data-plot-id],[data-tool-id]",
      );
    if (!object) return;
    if (object.dataset.toolId)
      return object.dataset.artifactId
        ? {
            artifact: object.dataset.artifactId,
            view: object.dataset.artifactId,
          }
        : object.dataset.modelObject
          ? { region: object.dataset.modelObject }
          : undefined;
    if (object.dataset.viewId)
      return {
        artifact: object.dataset.artifactId!,
        view: object.dataset.viewId,
      };
    if (object.dataset.regionId)
      return {
        region: object.dataset.regionId,
        symbol:
          hit?.closest("[data-symbol]")?.getAttribute("data-symbol") ||
          undefined,
      };
    return {
      unsupported:
        "This plot does not declare this linking interaction. Connect to its equation instead.",
    };
  };
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const dg = dataGesture.current;
      if (dg) {
        if (dg.pointer !== event.pointerId) return;
        if (
          !dg.moved &&
          Math.hypot(event.clientX - dg.client.x, event.clientY - dg.client.y) <
            5
        )
          return;
        event.preventDefault();
        dg.moved = true;
        suppressCanvasClick.current = true;
        setDataDrag({
          start: dg.start,
          end: canvasPoint(event.clientX, event.clientY),
          target: targetAt(event.clientX, event.clientY)?.region,
        });
        return;
      }
      const g = linkGesture.current;
      if (
        !g ||
        g.pointer !== event.pointerId ||
        (!g.moved &&
          Math.hypot(event.clientX - g.client.x, event.clientY - g.client.y) <
            5)
      )
        return;
      event.preventDefault();
      g.moved = true;
      suppressCanvasClick.current = true;
      setCanvasSelection([]);
      setSelected(g.source);
      setTerm(undefined);
      setOverlay("none");
      setLinkDrag({
        source: g.source,
        start: g.start,
        end: canvasPoint(event.clientX, event.clientY),
        target: targetAt(event.clientX, event.clientY),
      });
    };
    const up = (event: globalThis.PointerEvent) => {
      const dg = dataGesture.current;
      if (dg && dg.pointer !== event.pointerId) return;
      dataGesture.current = undefined;
      if (dg?.moved) {
        setDataDrag(undefined);
        suppressCanvasClick.current = true;
        const target = targetAt(event.clientX, event.clientY)?.region;
        if (target && accepted.kinds[target] === "equation")
          openDataReview(
            dg.dataset,
            dg.columns,
            dataSelection?.dataset === dg.dataset ? dataSelection.rows : [],
            target,
          );
        else
          setMessage("Drop selected columns onto a mathematical relationship.");
        return;
      }
      const g = linkGesture.current;
      if (g && g.pointer !== event.pointerId) return;
      linkGesture.current = undefined;
      if (!g?.moved) return;
      suppressCanvasClick.current = true;
      const target = targetAt(event.clientX, event.clientY);
      setLinkDrag(undefined);
      if (target?.region === g.source) return;
      setLinkMenu({
        source: g.source,
        at: canvasPoint(event.clientX, event.clientY),
        mode: target ? "review" : "actions",
        target,
      });
    };
    const cancel = (event: Event) => {
      const gesture = dataGesture.current || linkGesture.current;
      if (
        gesture &&
        "pointerId" in event &&
        event.pointerId !== gesture.pointer
      )
        return;
      dataGesture.current = undefined;
      setDataDrag(undefined);
      linkGesture.current = undefined;
      setLinkDrag(undefined);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  });
  const linkingSource = linkDrag?.source || linkMenu?.source;
  const linkingTarget = linkDrag?.target || linkMenu?.target;
  const linkReview = useMemo(():
    | {
        label: string;
        edit?: ConnectionEdit;
        artifact?: Artifact;
        error?: string;
      }
    | undefined => {
    if (!linkingSource || !linkingTarget) return;
    try {
      if (linkingTarget.unsupported) throw Error(linkingTarget.unsupported);
      if (linkingTarget.region) {
        const edit = planConnection(
          page,
          linkingSource,
          linkingTarget.region,
          linkingTarget.symbol,
        );
        return { label: edit.label, edit };
      }
      const a = artifacts.find((v) => v.id === linkingTarget.artifact),
        s = accepted.statements.get(linkingSource);
      if (!a || !s) throw Error("This object is no longer available.");
      if (s.relation !== "=") {
        const edit = planConnection(page, linkingSource, a.output);
        return {
          label: edit.label,
          edit,
          artifact: { ...a, requirement: linkingSource },
        };
      }
      const input =
        accepted.kinds[linkingSource] === "quantity" ? linkingSource : a.input;
      const output =
        accepted.kinds[linkingSource] === "equation" ? linkingSource : a.output;
      if (!ancestors(accepted, output).includes(input))
        throw Error("Choose a plot whose result depends on this quantity.");
      const x = accepted.statements.get(input)!,
        y = accepted.statements.get(output)!,
        q = accepted.solved.values.get(x.name)!;
      const value = q.absolute ? q.value - 273.15 : q.value,
        delta = Math.abs(value) || 1;
      const changed = makeArtifact(
        page,
        output,
        `Plot ${y.name} versus ${x.name} from ${value - delta * 0.75} to ${value + delta * 1.5}`,
      );
      return {
        label: `Plot ${y.name} against ${x.name}`,
        artifact: {
          ...a,
          input,
          output,
          low: changed.low,
          high: changed.high,
          request: changed.request,
          code: undefined,
          requirement: output === a.output ? a.requirement : undefined,
        },
      };
    } catch (e) {
      return {
        label: "Cannot connect these objects",
        error: (e as Error).message,
      };
    }
  }, [
    page,
    artifacts,
    linkingSource,
    linkingTarget?.region,
    linkingTarget?.artifact,
    linkingTarget?.symbol,
    linkingTarget?.unsupported,
    accepted,
  ]);
  const connectionPreview = useMemo(() => {
    if (!linkReview?.edit) return;
    const draftSession = new RegionSession(
      page,
      () => [],
      session.document,
      artifacts,
      true,
    );
    if (!draftSession.connect(linkReview.edit).ok) return;
    const projection = project(draftSession.state),
      statement = projection.statements.get(linkReview.edit.target);
    return {
      error: projection.errors.get(linkReview.edit.target),
      value: statement && projection.solved.values.get(statement.name),
      kind: projection.kinds[linkReview.edit.target],
    };
  }, [page, linkReview]);
  const acceptConnection = () => {
    if (!linkReview || linkReview.error) return;
    const nextArtifact = linkReview.artifact;
    try {
      session.atomic((staged) => {
        if (linkReview.edit) {
          const result = staged.connect(linkReview.edit);
          if (!result.ok)
            throw Error(result.error || "The connection could not be made.");
        }
        if (nextArtifact)
          staged.setArtifacts((items) =>
            items.map((a) =>
              a.id === nextArtifact.id
                ? { ...nextArtifact, receipt: undefined }
                : a,
            ),
          );
      });
    } catch (error) {
      setMessage((error as Error).message);
      return;
    }
    setLinkMenu(undefined);
    setArtifactFocus(
      nextArtifact
        ? {
            id: nextArtifact.id,
            target: nextArtifact.requirement ? "requirement" : "input",
            view: linkingTarget?.view,
          }
        : undefined,
    );
  };
  const inspectConnections = (source: string, at?: Point) => {
    revealAreaCanvas.current?.();
    setSelected(source);
    setTerm(undefined);
    setArtifactFocus(undefined);
    setOverlay("none");
    setLinkMenu({
      source,
      at: at || {
        x: (places[source]?.x || 110) + 140,
        y: (places[source]?.y || 110) + 80,
      },
      mode: "inspect",
    });
  };
  const navigateLink = (source: string) => {
    revealCanvasElement(
      document.querySelector(`[data-region-id="${source}"]`),
      { block: "nearest", inline: "nearest" },
    );
    inspectConnections(source);
  };
  const connectionNodes =
    linkMenu?.mode === "inspect"
      ? [
          ...Object.values(accepted.bindings[linkMenu.source] || {}).map(
            (id) => ({ id, relation: "Input" }),
          ),
          ...page.regions
            .filter(
              (r) =>
                Object.values(accepted.bindings[r.id] || {}).includes(
                  linkMenu.source,
                ) ||
                (!accepted.statements.has(r.id) &&
                  Object.entries(page.links?.[r.id] || {}).some(
                    ([name, id]) =>
                      id === linkMenu.source &&
                      accepted.texts[r.id].includes(name),
                  )),
            )
            .map((r) => ({
              id: r.id,
              relation:
                accepted.kinds[r.id] === "constraint"
                  ? "Requirement"
                  : "Used by",
            })),
        ].filter((v, i, all) => all.findIndex((w) => w.id === v.id) === i)
      : [];
  const linkFrame =
    linkingTarget &&
    readCanvasFrames().find(
      (f) => f.id === (linkingTarget.region || linkingTarget.view),
    );
  const menuSource = linkMenu && accepted.statements.get(linkMenu.source);
  const menuChoices = linkMenu ? plotChoices(page, linkMenu.source) : [];
  const pickConnection = (source?: string, target?: string) => {
    const id =
      source ||
      canvasSelection.find(
        (id) =>
          accepted.statements.get(id)?.relation === "=" &&
          !accepted.errors.has(id),
      ) ||
      selectedId;
    if (!id) {
      setMessage("Select a quantity to connect.");
      return;
    }
    setPalette(undefined);
    setLinkMenu({
      source: id,
      at: {
        x: (viewportScroll(canvas.current).x + 180) / zoom,
        y: (viewportScroll(canvas.current).y + 120) / zoom,
      },
      mode: "choose",
      target: target ? { region: target } : undefined,
    });
  };
  const connectChoices =
    linkMenu?.mode === "choose"
      ? connectionChoices(page, linkMenu.source, linkMenu.target?.region)
      : [];
  const requestedLink = useMemo(() => {
    const match =
      /^(?:use|connect)\s+([A-Za-z_][A-Za-z_0-9]*)\s+(?:for|to)\s+([A-Za-z_][A-Za-z_0-9]*)(?:\s+(?:in|of)\s+([A-Za-z_][A-Za-z_0-9]*))?\s*$/i.exec(
        query,
      );
    if (!match) return;
    const source =
      accepted.sources[match[1]]?.length === 1
        ? accepted.sources[match[1]][0]
        : undefined;
    if (!source) return;
    const choices = connectionChoices(page, source).filter((c) =>
      match[3]
        ? accepted.statements.get(c.edit.target)?.name === match[3] &&
          c.symbol === match[2]
        : c.symbol === match[2] ||
          accepted.statements.get(c.edit.target)?.name === match[2],
    );
    return choices.length === 1 ? choices[0] : undefined;
  }, [query, page, accepted]);
  const workspaceFile = useRef<HTMLInputElement>(null);
  const openGuard = useRef({ editing, draft });
  const [editBuffers] = useState(createEditBuffers);
  const [drawingToolbar, setDrawingToolbar] = useState<HTMLDivElement | null>(
    null,
  );
  openGuard.current = { editing, draft };
  const workspaceEdits: WorkspaceEdits = editBuffers.compose({
    read: () => openGuard.current,
    finish: () => {
      if (editing && !commit()) return false;
      setEditing(undefined);
      return true;
    },
    settle: () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  });
  const agentCanvas: import("../assistantCanvas").AssistantCanvasPort = {
    inspect: () => ({
      selection: [
        ...new Set(
          (canvasSelection.length
            ? canvasSelection
            : [areaSelection || selected || selectedId]
          ).filter((id): id is string => !!id),
        ),
      ],
      point: assistantPoint,
      scope: hierarchy.scope,
      viewport: {
        scroll: viewportScroll(canvas.current),
        zoom,
        width: canvas.current?.clientWidth,
        height: canvas.current?.clientHeight,
      },
      frames: spatial.frames,
    }),
    capture: async (args) => {
      const root = canvas.current;
      if (!root) throw Error("Canvas is not visible");
      const expected = session.document;
      const image = await captureAssistantCanvas(root, zoom, expected.id, args);
      if (session.document !== expected)
        throw Error("Canvas changed during capture; inspect it again");
      return image;
    },
  };
  const openAssistant = (at: Point) => {
    if (!workspaceEdits.finish() || !setAssistantOpen(true)) return false;
    setAssistantAnchor({ x: at.x, y: at.y });
    setAssistantPoint(canvasPoint(at.x, at.y));
    setAssistantPresentation((value) => ({ ...value, minimized: false }));
    return true;
  };
  const openWorkspace = async (file: File) => {
    try {
      const search = await workspace.open(file, workspaceEdits);
      if (search) window.location.href = search;
      else setMessage("Finish or cancel pending edits before continuing.");
    } catch (error) {
      setMessage(`Could not open workspace: ${(error as Error).message}`);
    }
  };
  const newCanvas = async () => {
    try {
      const search = await workspace.newCanvas(workspaceEdits);
      if (search) window.location.href = search;
      else setMessage("Finish or cancel pending edits before continuing.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const canvasEditors: Omit<EditorProps, "area"> = {
    editBuffers,
    page,
    current: working,
    artifacts,
    selection: areaSelection || selectedId,
    session,
    select: (id) => {
      setAreaSelection(id);
      setSelected(id);
      setTerm(undefined);
      setOverlay("none");
      const a = artifacts.find(
        (a) =>
          a.input === id ||
          a.output === id ||
          ancestors(accepted, a.output).includes(id),
      );
      if (a)
        setArtifactFocus({
          id: a.id,
          target:
            a.input === id ? "input" : id === a.output ? "expression" : "input",
          quantity: id,
        });
    },
    math: (statement, text, choose, edit, highlight) => (
      <MathLine
        statement={statement}
        text={text}
        directEdit
        choose={choose}
        edit={edit}
        highlight={highlight}
      />
    ),
    changeArtifact: (a) =>
      setArtifacts((items) =>
        items.map((item) => (item.id === a.id ? a : item)),
      ),
    createPlot: (output) => createArtifact(undefined, output),
    explore: exploreValue,
    finish: finishValue,
    revert: revertExploration,
  };
  const importCsv = async (file: File, point?: Point) => {
    if (editing && !commit()) return;
    try {
      if (!/\.csv$/i.test(file.name)) throw Error("Choose a CSV file.");
      if (file.size > 1_000_000) throw Error("Use a CSV under 1 MB.");
      const at = point || {
        x: viewportScroll(canvas.current).x / zoom + 110,
        y: viewportScroll(canvas.current).y / zoom + 110,
      };
      for (const f of readCanvasFrames())
        if (
          at.x < f.x + f.width &&
          at.x + 480 > f.x &&
          at.y < f.y + f.height &&
          at.y + 250 > f.y
        )
          at.y = f.y + f.height + 50;
      const id = session.importData(
        file.name,
        await file.text(),
        at,
        hierarchy.scope,
      );
      setEditing(undefined);
      setSelected(id);
      setPalette(undefined);
      requestAnimationFrame(() =>
        revealCanvasElement(
          canvas.current?.querySelector(`[data-region-id="${id}"]`),
          { block: "nearest", inline: "nearest" },
        ),
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const actionTarget = (element: Element) => {
    const hit = element.closest<HTMLElement>(canvasObjectSelector);
    if (!hit) return;
    if (hit.dataset.regionId) return hit.dataset.regionId;
    if (hit.dataset.modelId) return hit.dataset.modelId;
    const plot = page.plots.find((p) => p.id === hit.dataset.plotId);
    const artifact = artifacts.find(
      (a) =>
        a.id === hit.dataset.viewId ||
        a.views?.some((v) => v.id === hit.dataset.viewId),
    );
    return (
      plot?.output ||
      artifact?.output ||
      spatial.scene.tools.find((t) => t.id === hit.dataset.toolId)?.object ||
      page.dataRelations?.find((r) => r.id === hit.dataset.dataRelationId)
        ?.output
    );
  };
  const actionDetail = (
    element: Element,
    owner?: string,
  ): CommandSelection | undefined => {
    if (!owner) return;
    const symbol =
      element.closest<HTMLElement>("[data-symbol]")?.dataset.symbol;
    if (symbol) return { kind: "term", owner, symbol };
    if (element.closest(".er-result")) return { kind: "result", owner };
    const plot = element.closest<HTMLElement>("[data-plot-id]")?.dataset.plotId;
    if (plot) return { kind: "plot", owner, view: plot };
    const view = element.closest<HTMLElement>("[data-view-id]")?.dataset.viewId;
    if (view)
      return {
        kind: "plot",
        owner,
        view: artifacts.find(
          (a) => a.id === view || a.views?.some((v) => v.id === view),
        )?.id,
      };
  };
  const pickOverlap = (id: string | undefined) => {
    if (!id) return;
    const node = overlaps.select(id);
    if (!node) return;
    const owner = actionTarget(node);
    setSelected(node.dataset.plotId || owner);
    setAreaSelection(id);
    setCanvasSelection([id]);
    setSelectionDetail(actionDetail(node, owner));
    setTerm(undefined);
    setOverlay("none");
  };
  const openActionMenu = (
    x: number,
    y: number,
    target?: string,
    mode: "pie" | "context" = "context",
    held = false,
  ) => {
    if (editing) {
      skipBlur.current = true;
      if (!commit()) {
        skipBlur.current = false;
        return;
      }
    }
    overlaps.capture(x, y);
    setChoosingOverlap(false);
    if (
      !(
        canvasSelection.length > 1 &&
        (!target || canvasSelection.includes(target))
      )
    )
      setCanvasSelection([]);
    setSelected(target);
    setAreaSelection(undefined);
    if (dataSelection?.dataset !== target) setDataSelection(undefined);
    setPalette(undefined);
    setLinkMenu(undefined);
    setTerm(undefined);
    setOverlay("none");
    setActionMenu({ x, y, target, held, mode, world: canvasPoint(x, y) });
  };
  const commandContextFor = (
    id?: string,
    detail = selectionDetail,
    ids: string[] = [],
  ): CommandContext => {
    const target = commandTarget(
      accepted,
      id,
      detail,
      ids,
      !!page.regions.find((r) => r.id === id)?.data,
      !!page.models?.some((m) => m.id === id),
    );
    return {
      page,
      projection: accepted,
      target,
      artifacts,
      columns:
        dataSelection && dataSelection.dataset === id
          ? dataSelection.columns
          : [],
      previewActive: !!exploration,
      canVary: !!target.id && !!scrubFor(target.id),
      collapsed: !!id && collapsedData.includes(id),
      canUndo: session.canUndo || !!exploration,
      supportsArtifacts: artifactMode,
    };
  };
  const revealCommandObject = (id: string) => {
    if (!hierarchy.visible(id) && page.regions.some((r) => r.id === id)) {
      hierarchy.reveal(id);
      return;
    }
    revealCanvasElement(
      canvas.current?.querySelector(
        `[data-region-id="${id}"],[data-view-id="${id}"],[data-plot-id="${id}"],[data-data-relation-id="${id}"]`,
      ),
      { block: "nearest", inline: "nearest" },
    );
  };
  const dispatchCommand = (command: CommandRequest) => {
    const { target } = command;
    const id = target.id;
    switch (command.operation) {
      case "selection.copy-png":
      case "selection.save-png":
        if (canvas.current) {
          setMessage("Rendering transparent PNG…");
          void exportSelectionPng(
            canvas.current,
            target,
            zoom,
            command.operation === "selection.copy-png",
          ).then(setMessage, (error: unknown) =>
            setMessage(
              `PNG export failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
        break;
      case "mathematics.enable":
        if (target.id) {
          session.enableScientificMath(target.id);
          setMessage(
            "Scientific math v2 enabled. Undo restores its earlier rules.",
          );
        }
        break;
      case "mathematics.enable-v3":
        if (target.id) {
          session.enableScientificMathV3(target.id);
          setMessage(
            "Scientific math enabled for this equation. Undo restores its earlier rules.",
          );
        }
        break;
      case "definition.edit":
        if (id)
          begin(
            id,
            accepted.kinds[id] === "quantity"
              ? sourceSpans(accepted.texts[id] || "")[0]
              : undefined,
          );
        break;
      case "quantity.vary": {
        if (!id) break;
        setSelected(id);
        setSelectionDetail(undefined);
        revealCommandObject(id);
        startVariation(id);
        const invocationFocus = document.activeElement;
        requestAnimationFrame(() => {
          // Do not steal focus if the engineer has already entered a control.
          if (
            document.activeElement !== invocationFocus &&
            document.activeElement !== document.body
          )
            return;
          canvas.current
            ?.querySelector<HTMLElement>(
              `[data-region-id="${id}"] .er-scrubbable`,
            )
            ?.focus();
        });
        setMessage(
          "Explore without changing the baseline. Accept the value, keep an alternative, or cancel.",
        );
        break;
      }
      case "response.plot": {
        const { output, input, request } = command;
        if (artifactMode) createArtifact(request, output, undefined, input);
        else {
          const plot = session.addPlot(output, input);
          setSelected(plot);
        }
        break;
      }
      case "response.open": {
        const { view } = command;
        spatial.setScene((scene) => ({
          ...scene,
          closed: (scene.closed || []).filter((id) => id !== view),
        }));
        requestAnimationFrame(() => revealCommandObject(view));
        break;
      }
      case "quantity.connect": {
        const { connection, symbol } = command;
        if (connection)
          setLinkMenu({
            source:
              connection.kind === "constrain"
                ? connection.target
                : connection.source,
            mode: "review",
            at: {
              x: (viewportScroll(canvas.current).x + 160) / zoom,
              y: (viewportScroll(canvas.current).y + 120) / zoom,
            },
            target: {
              region:
                connection.kind === "constrain"
                  ? connection.source
                  : connection.target,
              symbol,
            },
          });
        else if (target.kind === "selection")
          pickConnection(
            undefined,
            target.ids?.find(
              (candidate) =>
                candidate !==
                target.ids?.find(
                  (source) =>
                    accepted.statements.get(source)?.relation === "=" &&
                    !accepted.errors.has(source),
                ),
            ),
          );
        else if (id)
          accepted.statements.get(id)?.relation === "="
            ? pickConnection(id)
            : pickConnection(undefined, id);
        break;
      }
      case "quantity.trace":
        if (id) inspectConnections(id, actionMenu?.world);
        break;
      case "context.compare":
        branchFor(id);
        break;
      case "definition.code": {
        const { output, input } = command;
        const existing = artifacts.find(
          (a) => a.output === output && a.input === input,
        );
        const artifact =
          existing?.id || createArtifact(undefined, output, undefined, input);
        if (artifact) spatial.openTool("python", output, artifact);
        break;
      }
      case "dataset.inspect":
        if (id) {
          setCollapsedData((ids) =>
            ids.filter((candidate) => candidate !== id),
          );
          chooseData({ dataset: id, rows: [], columns: [], kind: "series" });
          revealCommandObject(id);
        }
        break;
      case "dataset.connect":
        if (id)
          openDataReview(
            id,
            dataSelection?.columns || [],
            dataSelection?.rows || [],
            undefined,
            actionMenu?.world,
          );
        break;
      case "dataset.visualize": {
        const { view } = command;
        if (id) {
          chooseData({
            dataset: id,
            relation: view,
            view,
            rows: [],
            columns: [],
            kind: "series",
          });
          revealCommandObject(view);
        }
        break;
      }
      case "dataset.collapse":
        if (id)
          setCollapsedData((ids) =>
            ids.includes(id)
              ? ids.filter((candidate) => candidate !== id)
              : [...ids, id],
          );
        break;
      case "model.enter":
        if (id) hierarchy.go(id);
        break;
      case "model.detail":
        if (id) hierarchy.setDetail((d) => ({ ...d, [id]: "detail" }));
        break;
      case "selection.organize":
        organizeSelection();
        break;
      case "selection.group":
        groupSelection();
        break;
      case "selection.model":
        prepareModel(target.ids || []);
        break;
      case "canvas.write":
        fresh(
          actionMenu
            ? {
                x: actionMenu.world.x,
                y: actionMenu.world.y + (actionMenu.target ? 110 : 0),
              }
            : writingPoint(),
        );
        break;
      case "canvas.fit":
        fit();
        break;
      case "canvas.new":
        void newCanvas();
        break;
      case "model.author": {
        if (editing && !commit()) break;
        setEditing(undefined);
        revertExploration();
        const rows = session.state.regions
          .filter(
            (r) => !canvasSelection.length || canvasSelection.includes(r.id),
          )
          .flatMap((r) => {
            try {
              const text = project(session.state).texts[r.id] || r.text;
              const statement = parse(text, undefined, r.mathVersion ?? 1);
              if (
                statement.relation !== "=" ||
                (session.state.links?.[r.id] &&
                  Object.keys(session.state.links[r.id]).length)
              )
                return [];
              return [
                {
                  id: r.id,
                  text,
                  ...(r.mathVersion ? { mathVersion: r.mathVersion } : {}),
                },
              ];
            } catch {
              return [];
            }
          });
        const inputs = rows
          .filter((r) =>
            quantityLiteral(
              parse(r.text, undefined, r.mathVersion ?? 1).expression,
            ),
          )
          .map((r) => r.id);
        setAuthoringModel({
          source: {
            rows: rows.length
              ? rows
              : [
                  {
                    id: "equation-" + crypto.randomUUID(),
                    text: "",
                    mathVersion: 3,
                  },
                ],
            inputs,
            outputs: rows
              .filter((r) => !inputs.includes(r.id))
              .map((r) => r.id),
          },
          at: writingPoint(),
        });
        break;
      }
      case "model.spring":
      case "model.scale": {
        if (editing && !commit()) break;
        setEditing(undefined);
        revertExploration();
        const desired = actionMenu?.world || writingPoint(),
          at = independentViews.some(
            (v) =>
              Math.abs(v.x - desired.x) < 430 &&
              Math.abs(v.y - desired.y) < 500,
          )
            ? {
                x: Math.max(...independentViews.map((v) => v.x)) + 450,
                y: desired.y,
              }
            : desired;
        const instance = insertModel(
          session,
          command.operation === "model.spring" ? "spring" : "scale",
          at,
        );
        requestAnimationFrame(() => revealCommandObject(instance + ":view"));
        break;
      }
      case "data.import":
        csvFile.current?.click();
        break;
      case "reference.add":
        setReferenceEditor("new");
        break;
      case "canvas.undo":
        undo();
        break;
      case "help.shortcuts":
        openShortcuts();
        break;
      case "search.open":
        paletteOpen("search");
        break;
      case "overlay.dependencies":
        setOverlay("dependencies");
        break;
      case "overlay.requirements":
        setOverlay("requirements");
        break;
      case "canvas.stack":
        session.stack();
        break;
      case "canvas.evaluate":
        session.evaluate();
        break;
      case "history.open":
        if (editing && !commit()) break;
        setEditing(undefined);
        setHistory(true);
        break;
      case "workspace.open":
        workspaceFile.current?.click();
        break;
      case "workspace.export":
        void exportArtifacts();
        break;
      case "workspace.cleanup":
        if (editing && !commit()) break;
        setEditing(undefined);
        setCleanupOpen(true);
        break;
      case "system.explore":
        openSystem();
        break;
      case "marking.open": {
        const rect = canvas.current?.getBoundingClientRect();
        if (rect) {
          const at = actionPointer.current || {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          openActionMenu(at.x, at.y, selected, "pie");
        }
        break;
      }
      default: {
        const unsupported: never = command;
        throw Error(
          `This command has no supported operation in the current workspace: ${String(unsupported)}`,
        );
      }
    }
  };
  const executeCommand = (command: CanvasCommand) => {
    if (command.unavailable) {
      setMessage(command.unavailable);
      return;
    }
    setPalette(undefined);
    setActionMenu(undefined);
    try {
      command.run();
      setRecentCommands((recent) =>
        [command.key, ...recent.filter((key) => key !== command.key)].slice(
          0,
          12,
        ),
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const contextCommandsFor = (
    id?: string,
    detail = selectionDetail,
    ids: string[] = [],
  ) => resolveCommands(commandContextFor(id, detail, ids), dispatchCommand);
  const selectedContext = commandContextFor(
    selectedPlot?.output || selected || selectedId,
    selectedPlot
      ? { owner: selectedPlot.output, kind: "plot", view: selectedPlot.id }
      : selectionDetail,
    canvasSelection,
  );
  const selectedCommands = resolveCommands(selectedContext, dispatchCommand);
  const globalCommands = resolveWorkspaceCommands(
    selectedContext,
    dispatchCommand,
  );
  const availableCommands = [
    ...selectedCommands,
    ...globalCommands.filter(
      (global) => !selectedCommands.some((command) => command.id === global.id),
    ),
  ];
  const paletteCommands = searchCommands(
    availableCommands,
    query,
    recentCommands,
  );
  const requestedPlot = requestedPlotCommand(
    selectedContext,
    query,
    dispatchCommand,
  );
  const requestedConnectionBase =
    requestedLink &&
    resolveCommands(
      commandContextFor(
        requestedLink.edit.kind === "constrain"
          ? requestedLink.edit.target
          : requestedLink.edit.source,
        undefined,
      ),
      dispatchCommand,
    ).find((command) => command.id === "quantity.connect");
  const requestedConnection =
    requestedLink && requestedConnectionBase
      ? {
          ...requestedConnectionBase,
          label: "Review connection",
          preview: requestedLink.edit.label,
          key: `${requestedConnectionBase.key}:${requestedLink.edit.key}`,
          parameters: {
            ...requestedConnectionBase.parameters,
            source: requestedLink.edit.source,
            target: requestedLink.edit.target,
            symbol: requestedLink.symbol || requestedLink.edit.alias,
          },
          run: () =>
            dispatchCommand({
              operation: "quantity.connect",
              target: requestedConnectionBase.target,
              connection: requestedLink.edit,
              symbol: requestedLink.symbol || requestedLink.edit.alias,
            }),
        }
      : undefined;
  const menuContext = commandContextFor(
    actionMenu?.target,
    selectionDetail,
    canvasSelection,
  );
  const menuCommands = resolveCommands(menuContext, dispatchCommand);
  const menuSubject = commandSubject(menuContext);
  const overlapActions =
    actionMenu && overlaps.ids.length > 1
      ? [
          {
            id: "overlap.next",
            key: "overlap.next",
            label: "Select underneath",
            icon: <Layers />,
            run: () => pickOverlap(overlaps.underneath()),
          },
          {
            id: "overlap.choose",
            key: "overlap.choose",
            label: "Choose overlapping item…",
            icon: <Layers />,
            run: () => {
              setActionMenu(actionMenu);
              setChoosingOverlap(true);
            },
          },
        ]
      : [];
  const overlapChoices = overlaps.ids.map((id) => ({
    id: `overlap.pick:${id}`,
    key: `overlap.pick:${id}`,
    label: objectLabel(id),
    icon: <Layers />,
    run: () => pickOverlap(id),
  }));
  useEffect(() => {
    if (choosingOverlap && overlaps.ids.length < 2) {
      setActionMenu(undefined);
      setChoosingOverlap(false);
    }
  }, [choosingOverlap, overlaps.ids]);
  const actionMenuItems = [
    ...menuCommands,
    ...globalCommands.filter(
      (command) =>
        ["canvas.fit", "canvas.undo", "search.open", "help.shortcuts"].includes(
          command.id,
        ) && !menuCommands.some((item) => item.id === command.id),
    ),
  ].map((command) => presentCommand(command, executeCommand));
  const primaryMenuItems = markingCommands(menuCommands).map(
    (command, index) =>
      command
        ? presentCommand(
            command,
            executeCommand,
            ["Edit", "Explore", "Connect", "Inspect"][index],
          )
        : {
            id: "unavailable",
            key: `unavailable:${index}`,
            label: ["Edit", "Explore", "Connect", "Inspect"][index],
            icon: <MoreHorizontal />,
            unavailable:
              "This selection has no supported operation in this category.",
            run: () => {},
          },
  );
  return createElement(
    ShortcutBindingsContext.Provider,
    { value: shortcutPreferences.bindings },
    <ArtifactComputationProvider session={session}>
      <main
        className={`er-app ${actionMenu ? "is-command-open" : ""} ${exploration ? "is-exploring" : ""} ${linkDrag ? "is-linking" : ""}`}
        aria-busy={hierarchy.transitioning}
        data-trial={trial || "combined"}
        data-interaction={explicit ? "A" : "B"}
      >
        <CanvasMcp
          statusHost={mcpStatusHost}
          session={session}
          edits={workspaceEdits}
          canvas={agentCanvas}
        />
        {actionMenu && (
          <CanvasActionMenu
            location={actionMenu}
            subject={choosingOverlap ? "Objects at this point" : menuSubject}
            label={choosingOverlap ? "Overlapping objects" : undefined}
            actions={
              choosingOverlap
                ? overlapChoices
                : actionMenu.mode === "pie"
                  ? primaryMenuItems
                  : [
                      ...overlapActions,
                      ...actionMenuItems,
                      {
                        id: "ask-agent",
                        key: "ask-agent",
                        label: "Ask agent",
                        icon: <MessageSquare />,
                        run: () => {
                          openAssistant(actionMenu);
                        },
                      },
                    ]
            }
            close={() => setActionMenu(undefined)}
            search={() => paletteOpen("search")}
          />
        )}
        {authoringModel && (
          <ModelDefinitionEditor
            session={session}
            buffers={editBuffers}
            initial={{
              label: "Engineering model",
              source: authoringModel.source,
            }}
            at={authoringModel.at}
            close={() => setAuthoringModel(undefined)}
            published={(id) => {
              setAuthoringModel(undefined);
              if (id)
                requestAnimationFrame(() => revealCommandObject(id + ":view"));
            }}
          />
        )}
        {referenceEditor && (
          <ExternalReferenceEditor
            key={referenceEditor}
            initial={(() => {
              const region = page.regions.find((r) => r.id === referenceEditor);
              return region?.external
                ? {
                    id: region.id,
                    name: region.label || region.text,
                    reference: region.external,
                  }
                : undefined;
            })()}
            close={() => setReferenceEditor(undefined)}
            save={(name, reference) => {
              const id = session.reference(
                name,
                reference,
                {
                  x: viewportScroll(canvas.current).x / zoom + 120,
                  y: viewportScroll(canvas.current).y / zoom + 100,
                },
                hierarchy.scope,
                referenceEditor === "new" ? undefined : referenceEditor,
              );
              setReferenceEditor(undefined);
              setSelected(id);
            }}
          />
        )}
        <input
          ref={csvFile}
          type="file"
          accept=".csv,text/csv"
          aria-label="Import CSV file"
          style={{ display: "none" }}
          onChange={(e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            // Finish reading the selected CSV before resetting the file input.
            // Reset afterward so choosing the same CSV again still fires change.
            if (file) void importCsv(file).finally(() => (input.value = ""));
          }}
        />
        <header className="er-header" aria-label="Document">
          <a
            href="?think=1&artifacts=1"
            className="er-brand"
            aria-label="Manifold home"
          >
            <img className="manifold-logo" src="/manifold-logo.png" alt="" />
          </a>
          <input
            ref={workspaceFile}
            type="file"
            hidden
            aria-label="Open workspace file"
            accept=".manifold,.json,application/json"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void openWorkspace(file);
            }}
          />
          <CanvasCommandMenu label="File">
            <span className="er-command-heading">Document</span>
            <button
              aria-label="New canvas"
              title="New canvas · keep current work"
              onClick={() => void newCanvas()}
            >
              <FilePlus2 size={16} />
              <span>New document</span>
            </button>
            <button
              aria-label="Open workspace"
              title="Open a .manifold file · Ctrl/Cmd+O · keeps current work in this browser"
              aria-keyshortcuts="Control+O Meta+O"
              onClick={() => workspaceFile.current?.click()}
            >
              <FileInput size={16} />
              <span>Open file…</span>
            </button>
            <span className="er-command-heading">Insert</span>
            <button
              aria-label="Import CSV measurements"
              onClick={() => csvFile.current?.click()}
            >
              <span>Import CSV</span>
              <ArrowUpRight size={15} />
            </button>
          </CanvasCommandMenu>
          <CanvasCommandMenu label="View">
            <WorkspaceControls workspace={chrome} />
            <span className="er-command-heading">Canvas</span>
            {!!page.regions.length && (
              <button
                aria-label="Reveal layer"
                className={overlay !== "none" ? "is-active" : ""}
                onClick={() => {
                  revealAreaCanvas.current?.();
                  setOverlay(
                    overlay === "none"
                      ? "dependencies"
                      : overlay === "dependencies"
                        ? "requirements"
                        : "none",
                  );
                }}
              >
                <Layers size={16} />
                <span>
                  {overlay === "none"
                    ? "Reveal"
                    : overlay === "dependencies"
                      ? "Dependencies"
                      : "Requirements"}
                </span>
              </button>
            )}
            {!!page.regions.length && (
              <button
                aria-label="Canvas viewpoints"
                aria-expanded={spatial.viewMenu}
                onClick={() => spatial.setViewMenu(!spatial.viewMenu)}
              >
                <Bookmark size={15} />
                <span>Views</span>
              </button>
            )}
            {(page.models?.length || 0) > 1 && (
              <button
                aria-label="System overview"
                aria-pressed={systemActive}
                onClick={() => (systemActive ? closeSystem() : openSystem())}
              >
                <Link2 size={15} />
                <span>System</span>
              </button>
            )}
            {!page.regions.length && contexts.length <= 1 && (
              <small>View controls become available as you add content.</small>
            )}
          </CanvasCommandMenu>

          <div className="er-document-identity">
            <CanvasDocumentTitle
              title={title}
              session={session}
              buffers={editBuffers}
            />
            {artifactMode && (
              <span
                className="er-save-status"
                data-saved={session.isSaved && !storageError}
                aria-label="Workspace save status"
                title="Autosaved in this browser on this device only. Use Download for a portable backup; downloaded files are not updated automatically."
              >
                <span>
                  {storageError
                    ? "Local save needs attention"
                    : session.isSaved
                      ? "Saved locally"
                      : "Unsaved changes"}
                </span>
              </span>
            )}
          </div>
          <div
            className="er-document-actions"
            role="group"
            aria-label="Document actions"
          >
            <div className="er-mcp-status-host" ref={setMcpStatusHost} />
            <button
              aria-label="Search objects and commands"
              title="Search objects and commands"
              onClick={() => paletteOpen("search")}
            >
              <Search size={15} />
              <kbd>{shortcutPreferences.bindings["search.open"][0] || "—"}</kbd>
            </button>
            <button
              ref={assistantButton}
              aria-label="Ask agent"
              className="er-agent-button"
              aria-expanded={assistantOpen && !assistantPresentation.minimized}
              onClick={() => {
                if (assistantOpen && !assistantPresentation.minimized) {
                  setAssistantPresentation((value) => ({
                    ...value,
                    minimized: true,
                  }));
                  return;
                }
                const rect = canvas.current?.getBoundingClientRect();
                openAssistant(
                  lastCanvasPress.current?.point ||
                    actionPointer.current || {
                      x: rect
                        ? rect.left + rect.width / 2
                        : window.innerWidth / 2,
                      y: rect
                        ? rect.top + rect.height / 2
                        : window.innerHeight / 2,
                    },
                );
              }}
            >
              <Sparkles size={16} />
              <span>Ask agent</span>
            </button>
            <button
              aria-label="Download file"
              className="er-download-button"
              title="Download a .manifold file · Ctrl/Cmd+S · separate from browser autosave"
              aria-keyshortcuts="Control+S Meta+S"
              onClick={() => void exportArtifacts()}
            >
              <Download size={16} />
              <span>Download</span>
            </button>
          </div>
          {contexts.length > 1 && (
            <div
              className="er-scenario-bar"
              role="group"
              aria-label="Design scenarios"
            >
              <span>Scenario</span>
              {contexts.length > 1 && (
                <div className="er-contexts">
                  {contexts.length > 3 ? (
                    <select
                      aria-label="Design scenario"
                      value={page.active}
                      onChange={(e) => switchScenario(e.target.value)}
                    >
                      {contexts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    contexts.map((c) => (
                      <button
                        key={c.id}
                        aria-pressed={page.active === c.id}
                        className={c.id !== "original" ? "er-alternative" : ""}
                        onClick={() => switchScenario(c.id)}
                      >
                        {c.label}
                      </button>
                    ))
                  )}
                  {(!artifactMode ||
                    !artifacts.length ||
                    page.plots.length > 0) && (
                    <button
                      aria-pressed={compare}
                      onClick={() => {
                        setCompare(!compare);
                        setTerm(undefined);
                        if (!comparison && selectedId && comparisonContext)
                          setComparison({
                            context: comparisonContext,
                            output:
                              responseFor(page, selectedId)?.output ||
                              selectedId,
                          });
                      }}
                    >
                      Compare
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </header>
        {spatial.focus && (
          <button className="cs-focus-return" onClick={spatial.restoreFocus}>
            <ArrowLeft size={14} />
            Return to canvas
          </button>
        )}
        {spatial.viewMenu && (
          <aside className="cs-viewpoints" aria-label="Saved canvas viewpoints">
            <header>
              <b>Canvas views</b>
              <button
                aria-label="Close canvas views"
                onClick={() => spatial.setViewMenu(false)}
              >
                <X size={14} />
              </button>
            </header>
            {spatial.scene.viewpoints.map((v) => (
              <button
                className="cs-viewpoint-row"
                key={v.id}
                onClick={() => spatial.restoreViewpoint(v, hierarchy.viewpoint)}
              >
                {v.name}
              </button>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                spatial.saveViewpoint(viewName, hierarchy.scope);
                setViewName("");
              }}
            >
              <input
                aria-label="Viewpoint name"
                placeholder="Name this view"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
              />
              <button disabled={!viewName.trim()} type="submit">
                Save
              </button>
            </form>
            {spatial.scene.closed?.map((id) => (
              <button
                className="cs-viewpoint-row"
                key={id}
                onClick={() =>
                  spatial.setScene((s) => ({
                    ...s,
                    closed: s.closed?.filter((v) => v !== id),
                  }))
                }
              >
                Reopen {"artifact"}
              </button>
            ))}
          </aside>
        )}

        <WorkspaceDock
          detachedPanels={detachedPanels}
          workspace={chrome}
          toolbar={
            <div
              className="er-authoring-bar"
              role="group"
              aria-label="Canvas tools"
            >
              <div
                className="er-history-tools"
                role="group"
                aria-label="Edit history and actions"
              >
                <button
                  aria-label="Undo"
                  title="Undo"
                  disabled={!session.canUndo && !exploration}
                  onClick={() => undo()}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  aria-label="Redo"
                  title="Redo"
                  disabled={!session.canRedo}
                  onClick={() => session.redo()}
                >
                  <Undo2 size={16} style={{ transform: "scaleX(-1)" }} />
                </button>
                <button
                  aria-label="Open canvas actions"
                  title="Context actions · Right-click or Shift+F10"
                  onClick={(e) => {
                    const rect = canvas.current?.getBoundingClientRect();
                    if (rect) {
                      const id = overlaps.picked || areaSelection || selected;
                      const objectPoint = id && overlaps.keyboardPoint(id);
                      const press = lastCanvasPress.current;
                      const pressedPoint =
                        (press?.id && overlaps.keyboardPoint(press.id)) ||
                        press?.point;
                      const at = (overlaps.picked && objectPoint) ||
                        (e.detail
                          ? pressedPoint || objectPoint
                          : objectPoint || pressedPoint) ||
                        actionPointer.current || {
                          x: rect.left + rect.width / 2,
                          y: rect.top + rect.height / 2,
                        };
                      const hit = document.elementFromPoint(at.x, at.y);
                      openActionMenu(
                        at.x,
                        at.y,
                        (hit && actionTarget(hit)) || selected,
                      );
                    }
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
              <div
                className="drawing-toolbar-host"
                hidden={systemActive}
                ref={setDrawingToolbar}
              />
              <div className="er-view-tools">
                <CanvasNavigationControls
                  shortcuts={openShortcuts}
                  fitShortcut={shortcutLabel(
                    shortcutPreferences.bindings["canvas.fit"],
                  )}
                  visible={!artifactMode || areaCanvasVisible}
                  hand={navigation.hand}
                  setHand={(value) => {
                    if (!value || workspaceEdits.finish())
                      navigation.setHand(value);
                  }}
                  zoom={zoom}
                  zoomBy={navigation.zoomBy}
                  fit={fit}
                />
              </div>
            </div>
          }
          panels={{
            relationships: (
              <AreaEditor
                {...canvasEditors}
                area={{
                  id: "dock-relationships",
                  editor: "dependencies",
                  weight: 1,
                }}
              />
            ),
            response: (
              <AreaEditor
                {...canvasEditors}
                area={{ id: "dock-response", editor: "response", weight: 1 }}
              />
            ),
            table: (
              <AreaEditor
                {...canvasEditors}
                area={{ id: "dock-table", editor: "table", weight: 1 }}
              />
            ),
            assistant: assistantOpen && (
              <CanvasAssistant
                floating={assistantPresentation.floating}
                minimized={assistantPresentation.minimized}
                changePresentation={(value) => {
                  if (
                    !value.floating &&
                    !value.minimized &&
                    !chrome.show("assistant", true)
                  )
                    return;
                  setAssistantPresentation(value);
                }}
                reveal={async (id, input) => {
                  const views = [...session.document.views.entries()]
                    .filter(([, view]) => view.reference.item === id)
                    .map(([viewId]) => viewId);
                  const selectors = [id, ...views]
                    .flatMap((target) =>
                      [
                        "region",
                        "view",
                        "plot",
                        "model",
                        "drawing",
                        "tool",
                        "data-relation",
                      ].map(
                        (kind) => `[data-${kind}-id="${CSS.escape(target)}"]`,
                      ),
                    )
                    .join(",");
                  revealAreaCanvas.current?.();
                  if (relationshipNav.focus) relationshipNav.restore();
                  if (!hierarchy.visible(id)) hierarchy.reveal(id);
                  const group = spatial.scene.groups.find((group) =>
                    group.members.some((member) =>
                      [id, ...views].includes(member),
                    ),
                  );
                  if (group) spatial.focusObject(group.id);
                  // Scope/workspace changes publish before their DOM and camera updates.
                  await new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => resolve()),
                    ),
                  );
                  const element = [
                    ...(canvas.current?.querySelectorAll(selectors) || []),
                  ]
                    .map((node) =>
                      input === undefined
                        ? node
                        : node.getAttribute("data-comparison") === "true"
                          ? null
                          : node.querySelector(
                              `[data-model-input="${CSS.escape(input)}"]`,
                            ),
                    )
                    .find((node) => node && node.getClientRects().length > 0);
                  if (!element) return false;
                  revealCanvasElement(element, {
                    block: "nearest",
                    inline: "nearest",
                  });
                  const color =
                    getComputedStyle(element).getPropertyValue(
                      "--canvas-accent",
                    ) || "#8069bb";
                  const highlight = {
                    outline: `3px solid ${color}`,
                    outlineOffset: "4px",
                  };
                  element.animate(
                    window.matchMedia("(prefers-reduced-motion: reduce)")
                      .matches
                      ? [highlight, highlight]
                      : [
                          highlight,
                          highlight,
                          {
                            outline: "3px solid transparent",
                            outlineOffset: "4px",
                          },
                        ],
                    { duration: 2200 },
                  );
                  return true;
                }}
                session={session}
                anchor={assistantAnchor}
                canvas={agentCanvas}
                edits={workspaceEdits}
                selection={[
                  ...new Set(
                    (canvasSelection.length
                      ? canvasSelection
                      : [areaSelection || selected || selectedId]
                    )
                      .filter((id): id is string => !!id)
                      .map(
                        (id) =>
                          session.document.views.get(id)?.reference.item || id,
                      ),
                  ),
                ]}
                close={() => {
                  if (!setAssistantOpen(false)) return;
                  setAssistantPresentation({
                    floating: false,
                    minimized: false,
                  });
                  assistantButton.current?.focus();
                }}
              />
            ),
          }}
        >
          <WorkspaceAreas
            revealCanvas={revealAreaCanvas}
            enabled={
              artifactMode &&
              new URLSearchParams(location.search).has("editors")
            }
            {...canvasEditors}
            presentationContexts={[
              ...spatial.scene.tools.flatMap((t) =>
                t.context ? [t.context] : [],
              ),
              ...Object.values(spatial.scene.pins || {}),
            ]}
            onCanvasVisible={setAreaCanvasVisible}
          >
            <div
              ref={canvas}
              tabIndex={-1}
              className={`er-canvas ${relationshipNav.focus?.mode === "arrange" ? "is-relationship-focused" : ""} ${marquee ? "is-box-selecting" : ""} ${navigation.className}`}
              aria-label="Empty engineering page"
              onContextMenu={(e) => {
                if (
                  !(e.target as Element).closest(
                    "input,textarea,select,[contenteditable=true]",
                  )
                )
                  e.preventDefault();
              }}
              onScroll={(e) => {
                recenterCanvas(e.currentTarget);
              }}
              onPointerMoveCapture={(e) => {
                actionPointer.current = { x: e.clientX, y: e.clientY };
                if (navigation.move(e)) return;
                spatial.move(e);
                if (
                  spatial.moving() &&
                  directDrag.current === e.pointerId &&
                  !e.currentTarget.hasPointerCapture(e.pointerId)
                )
                  e.currentTarget.setPointerCapture(e.pointerId);
                if (spatial.moving()) suppressCanvasClick.current = true;
                if (spatial.movingSelection()) e.stopPropagation();
              }}
              onPointerUpCapture={(e) => {
                if (directDrag.current === e.pointerId)
                  directDrag.current = undefined;
                if (!navigation.up(e)) spatial.finishPointer(e);
              }}
              onPointerCancelCapture={(e) => {
                if (directDrag.current === e.pointerId)
                  directDrag.current = undefined;
                if (!navigation.up(e)) spatial.cancel(e);
              }}
              onLostPointerCapture={(e) => {
                const gesture = marqueeGesture.current;
                if (gesture?.pointerId === e.pointerId) {
                  marqueeFrame.cancel();
                  marqueeGesture.current = undefined;
                  setCanvasSelection(gesture.previous);
                  setMarquee(false);
                  suppressCanvasClick.current = true;
                }
                navigation.end();
                spatial.lostCapture(e);
              }}
              onAuxClickCapture={navigation.click}
              onPointerDownCapture={(e) => {
                // Portalled toolbars are React descendants, not canvas gestures.
                if (!e.currentTarget.contains(e.target as Node)) return;
                // Connection input is idle or owned by exactly one pointer, across both kinds.
                if (dataGesture.current || linkGesture.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                actionPointer.current = { x: e.clientX, y: e.clientY };
                const object = canvasObjectId(e.target as Element);
                const press = {
                  id: object,
                  point: { x: e.clientX, y: e.clientY },
                };
                if (
                  (e.button === 2 || (e.button === 0 && e.ctrlKey)) &&
                  !(e.target as Element).closest(
                    "input,textarea,select,[contenteditable=true]",
                  )
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  lastCanvasPress.current = press;
                  if (overlaps.picked && object !== overlaps.picked)
                    overlaps.clear();
                  setSelectionDetail(
                    actionDetail(
                      e.target as Element,
                      actionTarget(e.target as Element),
                    ),
                  );
                  openActionMenu(
                    e.clientX,
                    e.clientY,
                    actionTarget(e.target as Element),
                    "context",
                  );
                  return;
                }
                if (
                  e.pointerType === "touch" &&
                  e.currentTarget.querySelector("[data-drawing-active]")
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                if (navigation.down(e)) return;
                lastCanvasPress.current = press;
                if (overlaps.picked && object !== overlaps.picked)
                  overlaps.clear();
                if (
                  (e.target as Element).closest(
                    "[data-drawing-surface],[data-drawing-editor]",
                  )
                )
                  return;
                if (
                  relationshipNav.focus?.mode === "arrange" &&
                  (e.target as Element).closest('button[aria-label^="Move "]')
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                const dataHandle = (e.target as Element).closest<HTMLElement>(
                  "[data-dataset-link]",
                );
                if (dataHandle && e.button === 0) {
                  e.preventDefault();
                  if (editing) {
                    skipBlur.current = true;
                    if (!commit()) return;
                  }
                  dataGesture.current = {
                    pointer: e.pointerId,
                    dataset: dataHandle.dataset.datasetLink!,
                    columns: dataHandle.dataset.columns!.split(",").map(Number),
                    start: canvasPoint(e.clientX, e.clientY),
                    client: { x: e.clientX, y: e.clientY },
                    moved: false,
                  };
                  return;
                }
                const hitRegion = (e.target as Element).closest<HTMLElement>(
                  "[data-region-id]",
                )?.dataset.regionId;
                if (
                  dataSelection &&
                  hitRegion &&
                  !dataRelatedIds.has(hitRegion)
                )
                  setDataSelection(undefined);
                if (spatial.captureStart(e, canvasSelection)) return;
                const directObject = canvasObjectId(e.target as Element);
                if (
                  e.button === 0 &&
                  !e.shiftKey &&
                  directObject &&
                  canvasSelection.includes(directObject) &&
                  !(e.target as Element).closest(
                    "button,a,summary,input,textarea,select,[role=button]:not(.er-note),[role=slider],[contenteditable],[data-link-source],.er-actions,.er-editable-math,.er-term,.er-note-reference,.er-result",
                  )
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  directDrag.current = e.pointerId;
                  spatial.start(directObject, e, false, canvasSelection, true);
                  return;
                }
                if (
                  (e.target as Element).closest('button[aria-label^="Move "]')
                ) {
                  setSelected(undefined);
                  setTerm(undefined);
                  setLinkMenu(undefined);
                }
                if (e.button !== 0) return;
                if (!marqueeGesture.current)
                  suppressCanvasClick.current = false;
                const target = e.target as Element;
                const source = target
                  .closest("[data-link-source]")
                  ?.getAttribute("data-link-source");
                if (
                  source &&
                  !e.shiftKey &&
                  !target.closest(".er-editable-math")
                ) {
                  e.preventDefault();
                  if (editing) {
                    skipBlur.current = true;
                    if (!commit()) return;
                  }
                  linkGesture.current = {
                    pointer: e.pointerId,
                    source,
                    start: canvasPoint(e.clientX, e.clientY),
                    client: { x: e.clientX, y: e.clientY },
                    moved: false,
                  };
                  return;
                }
                if (
                  target.closest(
                    "[data-source-row],[data-measurement-row],[data-calculated-row]",
                  )
                )
                  return;
                if (!target.closest(".er-link-popover")) setLinkMenu(undefined);
                if (target.closest("input,textarea,[contenteditable]")) return;
                if (
                  target.closest(
                    "[data-region-id],[data-plot-id],[data-view-id],[data-tool-id],[data-data-relation-id],[data-model-id]",
                  )
                ) {
                  if (e.shiftKey) {
                    e.preventDefault();
                    if (editing) {
                      skipBlur.current = true;
                      commit();
                    }
                  } else setCanvasSelection([]);
                }
              }}
              onClickCapture={(e) => {
                if (navigation.click(e)) return;
                if (suppressCanvasClick.current) {
                  suppressCanvasClick.current = false;
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                if (
                  !e.shiftKey ||
                  (e.target as Element).closest(
                    "input,textarea,[contenteditable],[data-source-row],[data-measurement-row],[data-calculated-row]",
                  )
                )
                  return;
                const object = (e.target as Element).closest<HTMLElement>(
                  "[data-region-id],[data-plot-id],[data-view-id],[data-tool-id],[data-data-relation-id],[data-model-id]",
                );
                if (!object) return;
                e.preventDefault();
                e.stopPropagation();
                const id =
                  object.dataset.regionId ||
                  object.dataset.viewId ||
                  object.dataset.toolId ||
                  object.dataset.modelId ||
                  object.dataset.dataRelationId ||
                  object.dataset.plotId!;
                setCanvasSelection((current) =>
                  current.includes(id)
                    ? current.filter((item) => item !== id)
                    : [...current, id],
                );
                setSelected(undefined);
                setArtifactFocus(undefined);
                setTerm(undefined);
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                if (e.dataTransfer.files.length !== 1) {
                  setMessage("Drop one workspace or CSV at a time.");
                  return;
                }
                const file = e.dataTransfer.files[0];
                if (/\.(manifold|json)$/i.test(file.name)) {
                  void openWorkspace(file);
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                void importCsv(file, {
                  x:
                    (e.clientX -
                      rect.left +
                      viewportScroll(e.currentTarget).x) /
                    zoom,
                  y:
                    (e.clientY - rect.top + viewportScroll(e.currentTarget).y) /
                    zoom,
                });
              }}
              onPointerDown={(e) => {
                if (
                  e.button !== 0 ||
                  (e.target as Element).closest(
                    "button,input,textarea,.er-region,.er-plot,.er-popover,.er-investigation,.er-expansion-position,.er-spatial-compare,.er-selection-tools,.er-link-popover,.cs-tool,.cs-group,.cs-viewpoints,.er-data-result",
                  )
                )
                  return;
                if (marqueeGesture.current) return;
                const committedEditing = !!editing;
                if (editing) {
                  skipBlur.current = true;
                  if (!commit()) {
                    skipBlur.current = false;
                    return;
                  }
                  setSelected(undefined);
                  setAreaSelection(undefined);
                }
                e.preventDefault();
                e.currentTarget.focus({ preventScroll: true });
                suppressCanvasClick.current = committedEditing;
                marqueeGesture.current = {
                  start: canvasPoint(e.clientX, e.clientY),
                  client: { x: e.clientX, y: e.clientY },
                  pointerId: e.pointerId,
                  moved: false,
                  previous: canvasSelection,
                  additive: e.shiftKey,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (marqueeGesture.current?.pointerId !== e.pointerId) return;
                e.preventDefault();
                marqueeFrame.schedule({
                  clientX: e.clientX,
                  clientY: e.clientY,
                  pointerId: e.pointerId,
                });
              }}
              onPointerUp={(e) => {
                if (marqueeGesture.current?.pointerId !== e.pointerId) return;
                marqueeFrame.cancel();
                updateMarquee(e.clientX, e.clientY, e.pointerId);
                marqueeGesture.current = undefined;
                setMarquee(false);
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={(e) => {
                const gesture = marqueeGesture.current;
                if (gesture?.pointerId !== e.pointerId) return;
                marqueeFrame.cancel();
                setCanvasSelection(gesture.previous);
                marqueeGesture.current = undefined;
                suppressCanvasClick.current = true;
                setMarquee(false);
              }}
              onClick={(e) => {
                if (suppressCanvasClick.current) {
                  suppressCanvasClick.current = false;
                  return;
                }
                if (
                  (e.target as Element).closest(
                    "button,input,textarea,.er-region,.er-plot,.er-popover,.er-investigation,.er-expansion-position,.er-spatial-compare,.er-selection-tools,.er-link-popover,.cs-tool,.cs-group,.cs-viewpoints,.er-data-result",
                  )
                )
                  return;
                if (relationshipNav.focus?.mode === "arrange") {
                  relationshipNav.restore();
                  return;
                }
                if (systemActive) return;
                const rect = e.currentTarget.getBoundingClientRect();
                fresh({
                  x:
                    (e.clientX -
                      rect.left +
                      viewportScroll(e.currentTarget).x) /
                    zoom,
                  y:
                    (e.clientY - rect.top + viewportScroll(e.currentTarget).y) /
                    zoom,
                });
              }}
            >
              {!!page.models?.length && (
                <div
                  style={{
                    position: "absolute",
                    left: canvas.current?.scrollLeft || 0,
                    top: canvas.current?.scrollTop || 0,
                    width: "100%",
                    zIndex: 28,
                  }}
                >
                  <ModelBreadcrumb
                    name="Canvas"
                    path={hierarchy.path}
                    canBack={hierarchy.canBack}
                    back={hierarchy.back}
                    go={hierarchy.go}
                  />
                  {systemOpen && hierarchy.scope && systemInput && (
                    <div className="sx-focus-context">
                      <span>
                        Exploring{" "}
                        {quantityTitle(
                          p.statements.get(systemInput)?.name || systemInput,
                          page,
                        )}
                      </span>
                      <button onClick={openSystem}>Return to system</button>
                    </div>
                  )}
                  {modelTrace && (
                    <ModelTrace
                      page={page}
                      object={modelTrace}
                      follow={hierarchy.reveal}
                      close={() => setModelTrace(undefined)}
                    />
                  )}
                </div>
              )}
              {activeData && activeRelation && (
                <RelationshipTrail
                  page={page}
                  selection={activeData}
                  relation={activeRelation}
                  at={{
                    x: (canvas.current?.scrollLeft || 0) + 20,
                    y:
                      (canvas.current?.scrollTop || 0) +
                      (page.models?.length ? 62 : 14),
                  }}
                  follow={relationshipNav.follow}
                  back={relationshipNav.back}
                  canBack={relationshipNav.canBack}
                  trace={relationshipNav.trace}
                  toggleTrace={() =>
                    relationshipNav.setTrace(!relationshipNav.trace)
                  }
                  focus={() =>
                    relationshipNav.focusRelationship(activeRelation)
                  }
                  arrange={() =>
                    relationshipNav.focusRelationship(activeRelation, "arrange")
                  }
                  mode={relationshipNav.focus?.mode}
                  restore={relationshipNav.restore}
                  keep={relationshipNav.keepArrangement}
                  clear={() => {
                    relationshipNav.restore();
                    setDataSelection(undefined);
                    setAreaSelection(undefined);
                    setSelected(undefined);
                    relationshipNav.setTrace(false);
                  }}
                />
              )}
              <div
                className="er-scroll-surface"
                style={{ width: SCROLL_SURFACE, height: SCROLL_SURFACE }}
              >
                <div className="er-world">
                  <div
                    className={`er-paper ${systemActive ? "is-system-overview" : ""}`}
                    data-canvas-renders={renders.current}
                    style={{ width, height, transform: `scale(${zoom})` }}
                  >
                    <DrawingCanvas
                      session={session}
                      buffers={editBuffers}
                      report={setMessage}
                      toolbar={drawingToolbar}
                      onChooseTool={() => navigation.setHand(false)}
                      onShortcut={performShortcut}
                      hand={navigation.hand}
                      visible={!systemActive}
                      zoom={zoom}
                      point={canvasPoint}
                      activate={() => {
                        if (editing) {
                          skipBlur.current = true;
                          if (!commit()) {
                            skipBlur.current = false;
                            return false;
                          }
                        }
                        setSelected(undefined);
                        setArtifactFocus(undefined);
                        setAreaSelection(undefined);
                        setDataSelection(undefined);
                        setTerm(undefined);
                        setLinkMenu(undefined);
                        return true;
                      }}
                      shared={{
                        ids: canvasSelection,
                        select: setCanvasSelection,
                        move: nudgeSelection,
                        duplicate: duplicateSelected,
                        remove: deleteSelected,
                        startMove: (e, id, ids) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          spatial.start(id, e, false, ids);
                        },
                      }}
                      placements={drawingPlacements}
                      hidden={spatial.hidden}
                    />
                    {!page.regions.length &&
                      !modelFrames.length &&
                      !drawingEntries.length && (
                        <div className="er-empty">
                          <h1>A page to think on.</h1>
                          <p>Start typing, or click anywhere to write.</p>
                          <small>
                            Equations, notes, or a CSV dropped here.
                          </small>
                        </div>
                      )}
                    {systemActive && (
                      <SystemOverview
                        failure={systemFailure}
                        investigate={investigateFailure}
                        preview={working !== page}
                        changeAppearance={(id, patch) =>
                          session.styleModel(id, patch)
                        }
                        page={working}
                        response={systemResponse}
                        setResponse={setSystemResponse}
                        pathFocus={systemPath}
                        selectPath={setSystemPath}
                        toggleCompare={() => setCompare(!compare)}
                        branch={() => {
                          setSystemReference(page.active);
                          try {
                            session.branch();
                            setCompare(true);
                          } catch (error) {
                            setMessage((error as Error).message);
                          }
                        }}
                        write={writeSystemInput}
                        positions={systemPositions}
                        arrange={(
                          next,
                          checkpoint = true,
                          prior = systemPositions,
                        ) => {
                          if (checkpoint)
                            session.arrange({}, true, () =>
                              setSystemPositions(prior),
                            );
                          setSystemPositions(next);
                        }}
                        output={systemOutput}
                        input={
                          systemInput && p.kinds[systemInput] === "quantity"
                            ? systemInput
                            : undefined
                        }
                        selected={selected}
                        anchorModel={systemAnchor}
                        choose={(id, model) => {
                          setSystemFailure(undefined);
                          setSystemInput(id);
                          setSystemPath(undefined);
                          if (systemResponse === "internal")
                            setSystemResponse("contextual");
                          setSystemAnchor(model || hierarchy.owner(id));
                          setSelected(model || hierarchy.owner(id) || id);
                          setSystemInvestigating(true);
                        }}
                        investigating={systemInvestigating}
                        dismissInvestigation={() => {
                          setSystemInvestigating(false);
                          setSystemFailure(undefined);
                        }}
                        selectModel={(id) => setSelected(id)}
                        connect={(source, target) => {
                          setModelConnectionTarget(target);
                          setModelConnection(source);
                        }}
                        zoom={zoom}
                        compare={compare}
                        comparisonContext={
                          systemReference && systemReference !== page.active
                            ? systemReference
                            : page.active === "original"
                              ? comparisonContext
                              : "original"
                        }
                        tracePaths={overlay === "dependencies"}
                        toggleTrace={() =>
                          setOverlay(
                            overlay === "dependencies"
                              ? "none"
                              : "dependencies",
                          )
                        }
                        requirements={overlay === "requirements"}
                        enter={enterSystemModel}
                        follow={followSystemQuantity}
                        close={closeSystem}
                        canvas={closeSystem}
                        scrub={scrubFor}
                      />
                    )}
                    {internalInvestigation && (
                      <div
                        className="sx-internal-investigation"
                        style={{
                          position: "absolute",
                          left: internalAt.x,
                          top: internalAt.y,
                          width: 520,
                        }}
                      >
                        <SystemInvestigation
                          failure={systemFailure}
                          preview={working !== page}
                          page={working}
                          response="internal"
                          setResponse={(mode) => {
                            setSystemResponse(mode);
                            if (mode !== "internal") openSystem();
                          }}
                          input={systemInput}
                          output={systemOutput}
                          sourceOwner={systemAnchor}
                          pathFocus={systemPath}
                          selectPath={setSystemPath}
                          choose={setSystemInput}
                          follow={followSystemQuantity}
                          write={writeSystemInput}
                          branch={() => {
                            setSystemReference(page.active);
                            try {
                              session.branch();
                              setCompare(true);
                            } catch (error) {
                              setMessage((error as Error).message);
                            }
                          }}
                          compare={compare}
                          toggleCompare={() => setCompare(!compare)}
                          comparisonContext={
                            systemReference && systemReference !== page.active
                              ? systemReference
                              : page.active !== "original"
                                ? "original"
                                : comparisonContext
                          }
                          enterSource={() => {
                            if (systemAnchor) enterSystemModel(systemAnchor);
                          }}
                          scrub={scrubFor}
                          tracePaths={overlay === "dependencies"}
                          toggleTrace={() =>
                            setOverlay(
                              overlay === "dependencies"
                                ? "none"
                                : "dependencies",
                            )
                          }
                          dismissInvestigation={() =>
                            setSystemInvestigating(false)
                          }
                        />
                      </div>
                    )}
                    {(page.models || [])
                      .filter(
                        (m) =>
                          !systemActive &&
                          hierarchy.visible(m.id) &&
                          !spatial.hidden.has(m.id),
                      )
                      .map((model) => (
                        <ModelObject
                          changeAppearance={(id, patch) =>
                            session.styleModel(id, patch)
                          }
                          key={model.id}
                          page={page}
                          model={model}
                          at={places[model.id] || hierarchy.at(model.id)}
                          level={hierarchy.level(model.id) || "interface"}
                          override={hierarchy.detail[model.id] || "auto"}
                          selected={selected === model.id}
                          highlight={modelTrace}
                          select={() => setSelected(model.id)}
                          enter={() => hierarchy.go(model.id)}
                          inspect={setModelTrace}
                          openSource={hierarchy.reveal}
                          connect={setModelConnection}
                          followModel={hierarchy.go}
                          review={() =>
                            setModelReview({
                              members: model.members,
                              existing: model,
                            })
                          }
                          setLevel={(level) =>
                            hierarchy.chooseDetail(model.id, level)
                          }
                          move={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            spatial.start(model.id, e, true);
                          }}
                          math={(id) => {
                            const st = p.statements.get(id);
                            return st ? (
                              <MathLine
                                statement={st}
                                text={p.texts[id]}
                                choose={() => {}}
                                edit={() => {}}
                              />
                            ) : null;
                          }}
                        />
                      ))}
                    {spatial.scene.groups.map((g) => {
                      if (!g.members.every(hierarchy.visible)) return null;
                      const bounds = frameBounds(
                        spatial.frames.filter((f) => g.members.includes(f.id)),
                      );
                      return (
                        bounds && (
                          <CanvasGroupView
                            key={g.id}
                            group={g}
                            bounds={bounds}
                            compact={spatial.compact(g)}
                            zoom={zoom}
                            focus={() => spatial.focusObject(g.id)}
                            collapse={() => {
                              if (zoom < 0.65 && spatial.compact(g)) {
                                spatial.focusObject(g.id);
                                return;
                              }
                              spatial.setScene((s) => ({
                                ...s,
                                groups: s.groups.map((v) =>
                                  v.id === g.id
                                    ? { ...v, collapsed: !spatial.compact(g) }
                                    : v,
                                ),
                              }));
                            }}
                            promote={() => prepareModel([...g.members])}
                            ungroup={() =>
                              spatial.setScene((s) => ({
                                ...s,
                                groups: s.groups.filter((v) => v.id !== g.id),
                              }))
                            }
                            arrange={(layout) =>
                              spatial.arrangeGroup(g.id, layout)
                            }
                            start={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              spatial.start(g.id, e, true);
                            }}
                            move={() => {}}
                            end={() => {}}
                          />
                        )
                      );
                    })}
                    {spatial.dock &&
                      (() => {
                        const target = spatial.frames.find(
                          (f) => f.id === spatial.dock!.id,
                        );
                        if (!target) return null;
                        const stack = spatial.dock.layout === "stack";
                        return (
                          <div
                            className={`cs-dock-preview ${spatial.dock.plan ? "is-ready" : "is-pending"}`}
                            role="status"
                            style={{
                              left: target.x + (stack ? 0 : target.width + 12),
                              top: target.y + (stack ? target.height + 12 : 0),
                            }}
                          >
                            {spatial.dock.plan ? "Release to" : "Hold to"}{" "}
                            {stack ? "stack below" : "place beside"}
                            {spatial.dock.plan &&
                              ` · ${spatial.dock.plan.destinations.length} items`}
                          </div>
                        );
                      })()}
                    {spatial.dock?.plan?.destinations.map((frame) => (
                      <div
                        key={frame.id}
                        className="cs-dock-object"
                        data-dock-object={frame.id}
                        aria-hidden="true"
                        style={{
                          left: frame.x,
                          top: frame.y,
                          width: frame.width,
                          height: frame.height,
                        }}
                      >
                        <span>{objectLabel(frame.id)}</span>
                      </div>
                    ))}
                    {linkDrag && (
                      <svg
                        className="er-link-drag"
                        width={width}
                        height={height}
                        aria-hidden="true"
                      >
                        <path
                          d={`M ${linkDrag.start.x} ${linkDrag.start.y} C ${linkDrag.start.x + 70} ${linkDrag.start.y}, ${linkDrag.end.x - 70} ${linkDrag.end.y}, ${linkDrag.end.x} ${linkDrag.end.y}`}
                        />
                        <circle
                          cx={linkDrag.start.x}
                          cy={linkDrag.start.y}
                          r={4 / zoom}
                        />
                        <circle
                          cx={linkDrag.end.x}
                          cy={linkDrag.end.y}
                          r={4 / zoom}
                        />
                      </svg>
                    )}
                    {linkDrag && linkFrame && (
                      <div
                        className={`er-link-target ${linkReview?.error ? "is-invalid" : ""}`}
                        style={{
                          left: linkFrame.x - 5,
                          top: linkFrame.y - 5,
                          width: linkFrame.width + 10,
                          height: linkFrame.height + 10,
                        }}
                      />
                    )}
                    {linkDrag && (
                      <div
                        className="er-link-hint"
                        style={{
                          left: linkDrag.end.x + 16 / zoom,
                          top: linkDrag.end.y + 18 / zoom,
                          transform: `scale(${1 / zoom})`,
                        }}
                      >
                        {linkReview?.error ||
                          linkReview?.label ||
                          "Release for actions"}
                      </div>
                    )}
                    {linkMenu && (
                      <CanvasConnectionPopover
                        at={linkMenu.at}
                        zoom={zoom}
                        label={
                          linkMenu.mode === "review"
                            ? "Review connection"
                            : linkMenu.mode === "inspect"
                              ? "Connections"
                              : "Link actions"
                        }
                      >
                        <header>
                          <Link2 size={16} />
                          <strong>
                            {linkMenu.mode === "review"
                              ? "Connect"
                              : menuSource?.name || "Connections"}
                          </strong>
                          <button
                            aria-label="Close connections"
                            onClick={() => setLinkMenu(undefined)}
                          >
                            <X size={15} />
                          </button>
                        </header>
                        {linkMenu.mode === "choose" ? (
                          <div className="er-connect-pick">
                            <p>Use {menuSource?.name}…</p>
                            {connectChoices.map(({ edit, symbol }) => (
                              <button
                                className="er-link-row"
                                key={`${edit.target}-${symbol || "binding"}`}
                                onClick={() =>
                                  setLinkMenu({
                                    ...linkMenu,
                                    source:
                                      edit.kind === "constrain"
                                        ? edit.target
                                        : edit.source,
                                    mode: "review",
                                    target: {
                                      region:
                                        edit.kind === "constrain"
                                          ? edit.source
                                          : edit.target,
                                      symbol,
                                    },
                                  })
                                }
                              >
                                <span>{edit.label}</span>
                                <ArrowUpRight size={13} />
                              </button>
                            ))}
                            {!connectChoices.length && (
                              <small>
                                No compatible destinations on this page. Add an
                                equation with a missing input, or select another
                                source.
                              </small>
                            )}
                          </div>
                        ) : linkMenu.mode === "review" ? (
                          <>
                            <p>{linkReview?.label}</p>
                            <span className="er-link-kind">
                              {linkReview?.edit?.kind === "reference"
                                ? "Reference · definition identity"
                                : linkReview?.edit?.kind === "compute"
                                  ? "Binding · replace an assumption"
                                  : linkReview?.edit?.kind === "constrain"
                                    ? "Requirement binding"
                                    : "Visualization binding"}
                            </span>
                            {linkReview?.error ? (
                              <p className="er-link-error" role="status">
                                {linkReview.error}
                              </p>
                            ) : (
                              <>
                                {linkReview?.edit && (
                                  <div className="er-link-change">
                                    <s>
                                      {accepted.texts[linkReview.edit.target]}
                                    </s>
                                    <code>{linkReview.edit.text}</code>
                                  </div>
                                )}
                                {connectionPreview?.error && (
                                  <small className="er-link-unresolved">
                                    {connectionPreview.error} Units will be
                                    checked when the remaining inputs are
                                    defined.
                                  </small>
                                )}
                                {connectionPreview?.value && (
                                  <p className="er-link-value">
                                    Result · {display(connectionPreview.value)}
                                  </p>
                                )}
                                <small>
                                  {
                                    contexts.find((c) => c.id === page.active)
                                      ?.label
                                  }
                                  {linkReview?.artifact && !linkReview.edit
                                    ? " · Plot binding"
                                    : " · Calculation change"}
                                </small>
                                <footer>
                                  <button
                                    onClick={() => setLinkMenu(undefined)}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="er-link-apply"
                                    onClick={acceptConnection}
                                  >
                                    Apply connection
                                  </button>
                                </footer>
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            {linkMenu.mode === "inspect" && (
                              <>
                                <p className="er-link-definition">
                                  {accepted.texts[linkMenu.source]}
                                </p>
                                {connectionNodes.map((node) => (
                                  <button
                                    className="er-link-row"
                                    key={node.id}
                                    onClick={() => navigateLink(node.id)}
                                  >
                                    <small>{node.relation}</small>
                                    <span>{accepted.texts[node.id]}</span>
                                    <ArrowUpRight size={14} />
                                  </button>
                                ))}
                                {artifacts
                                  .filter(
                                    (a) =>
                                      a.input === linkMenu.source ||
                                      a.output === linkMenu.source ||
                                      a.requirement === linkMenu.source,
                                  )
                                  .map((a) => (
                                    <button
                                      className="er-link-row"
                                      key={a.id}
                                      onClick={() => {
                                        revealCanvasElement(
                                          document.querySelector(
                                            `[data-view-id="${a.id}"]`,
                                          ),
                                          {
                                            block: "nearest",
                                            inline: "nearest",
                                          },
                                        );
                                        setArtifactFocus({
                                          id: a.id,
                                          view: a.id,
                                          target:
                                            a.requirement === linkMenu.source
                                              ? "requirement"
                                              : a.input === linkMenu.source
                                                ? "input"
                                                : "expression",
                                        });
                                        setLinkMenu(undefined);
                                      }}
                                    >
                                      <small>Visualized by</small>
                                      <span>
                                        {
                                          accepted.statements.get(a.output)
                                            ?.name
                                        }{" "}
                                        vs{" "}
                                        {accepted.statements.get(a.input)?.name}
                                      </span>
                                      <ArrowUpRight size={14} />
                                    </button>
                                  ))}
                                {!connectionNodes.length &&
                                  !artifacts.some(
                                    (a) =>
                                      a.input === linkMenu.source ||
                                      a.output === linkMenu.source ||
                                      a.requirement === linkMenu.source,
                                  ) && <small>No connected objects yet.</small>}
                              </>
                            )}
                            {linkMenu.mode === "actions" &&
                              menuChoices.map((choice) => (
                                <button
                                  className="er-link-row"
                                  key={`${choice.output}-${choice.input}`}
                                  onClick={() => {
                                    if (artifactMode)
                                      createArtifact(
                                        undefined,
                                        choice.output,
                                        linkMenu.at,
                                        choice.input,
                                      );
                                    else {
                                      const plot = session.addPlot(
                                        choice.output,
                                        choice.input,
                                      );
                                      if (plot) session.move(plot, linkMenu.at);
                                      setLinkMenu(undefined);
                                    }
                                  }}
                                >
                                  <span>
                                    Plot{" "}
                                    {
                                      accepted.statements.get(choice.output)
                                        ?.name
                                    }{" "}
                                    vs{" "}
                                    {
                                      accepted.statements.get(choice.input)
                                        ?.name
                                    }
                                  </span>
                                  <ArrowUpRight size={14} />
                                </button>
                              ))}
                            {linkMenu.mode === "actions" &&
                              menuSource?.relation === "=" && (
                                <button
                                  className="er-link-row"
                                  onClick={() => {
                                    const source = linkMenu.source,
                                      name = menuSource.name;
                                    let result = `R_${name}`,
                                      serial = 2;
                                    while (accepted.sources[result])
                                      result = `R_${name}_${serial++}`;
                                    const at = linkMenu.at;
                                    fresh(at);
                                    setDraft(`${result} = ${name}`);
                                    setDraftLinks({ [name]: source });
                                    setCaret(result.length);
                                    setSelectionSpan({
                                      start: 0,
                                      end: result.length,
                                    });
                                  }}
                                >
                                  <span>Use in an equation</span>
                                  <ArrowUpRight size={14} />
                                </button>
                              )}
                            {linkMenu.mode === "actions" && (
                              <button
                                className="er-link-row"
                                onClick={() =>
                                  inspectConnections(
                                    linkMenu.source,
                                    linkMenu.at,
                                  )
                                }
                              >
                                <span>Inspect connections</span>
                                <ArrowUpRight size={14} />
                              </button>
                            )}
                          </>
                        )}
                      </CanvasConnectionPopover>
                    )}
                    {spatial.guides.map((guide) => (
                      <div
                        key={guide.axis}
                        className="er-alignment-guide"
                        data-alignment-axis={guide.axis}
                        aria-hidden="true"
                        style={
                          guide.axis === "x"
                            ? {
                                left: guide.at,
                                top: guide.from,
                                height: guide.to - guide.from,
                                borderLeftWidth: 1 / zoom,
                              }
                            : {
                                top: guide.at,
                                left: guide.from,
                                width: guide.to - guide.from,
                                borderTopWidth: 1 / zoom,
                              }
                        }
                      />
                    ))}
                    {selectedFrames
                      .filter((frame) => frame.kind !== "drawing")
                      .map((frame) => (
                        <div
                          key={frame.id}
                          data-selection-object={frame.id}
                          className="er-selection-outline"
                          aria-hidden="true"
                          style={{
                            left: frame.x - 6 / zoom,
                            top: frame.y - 6 / zoom,
                            width: frame.width + 12 / zoom,
                            height: frame.height + 12 / zoom,
                            borderWidth: 1.5 / zoom,
                          }}
                        />
                      ))}
                    {marquee && (
                      <div
                        ref={marqueeElement}
                        className="er-selection-marquee"
                        aria-hidden="true"
                        style={{ left: 0, top: 0, borderWidth: 1 / zoom }}
                      />
                    )}
                    {selectionBounds &&
                      !editing &&
                      !marquee &&
                      !spatial.moving() && (
                        <CanvasSelectionToolbar
                          bounds={selectionBounds}
                          zoom={zoom}
                          onEscape={() => {
                            setCanvasSelection([]);
                            setSelected(undefined);
                          }}
                        >
                          {canvasSelection.length > 1 && (
                            <button
                              aria-label="Move selected objects"
                              title="Drag selection · Alt bypasses alignment"
                              onPointerDown={(e) => {
                                if (e.button !== 0 || !canvasSelection.length)
                                  return;
                                e.preventDefault();
                                e.stopPropagation();
                                e.currentTarget.setPointerCapture(e.pointerId);
                                spatial.start(
                                  canvasSelection[0],
                                  e,
                                  false,
                                  canvasSelection,
                                );
                              }}
                            >
                              <GripVertical size={15} />
                            </button>
                          )}
                          <span aria-live="polite">
                            {selectedFrames.length} selected
                          </span>
                          <button
                            title={
                              selectionReason ||
                              "Duplicate selected objects · Ctrl/Cmd+D"
                            }
                            disabled={!!selectionReason}
                            onClick={duplicateSelected}
                          >
                            Duplicate
                          </button>
                          <button
                            title={
                              selectionReason ||
                              "Delete selected objects · Undo restores them"
                            }
                            disabled={!!selectionReason}
                            onClick={deleteSelected}
                          >
                            Delete
                          </button>
                          <button
                            disabled={selectedFrames.length < 2}
                            onClick={groupSelection}
                          >
                            Group
                          </button>
                          <details className="er-selection-more">
                            <summary>More</summary>
                            <div className="er-selection-more-actions">
                              <button
                                disabled={selectedFrames.length < 2}
                                onClick={organizeSelection}
                              >
                                <LayoutGrid size={14} /> Organize
                              </button>
                              <button
                                disabled={
                                  !canvasSelection.some((id) =>
                                    accepted.statements.has(id),
                                  )
                                }
                                onClick={() =>
                                  pickConnection(
                                    undefined,
                                    canvasSelection.length === 2
                                      ? canvasSelection.find(
                                          (id) =>
                                            id !==
                                            canvasSelection.find(
                                              (id) =>
                                                accepted.statements.get(id)
                                                  ?.relation === "=" &&
                                                !accepted.errors.has(id),
                                            ),
                                        )
                                      : undefined,
                                  )
                                }
                              >
                                <Link2 size={13} />
                                Connect
                              </button>
                              <button
                                disabled={selectedFrames.some(
                                  (f) => f.kind === "drawing",
                                )}
                                title={
                                  selectedFrames.some(
                                    (f) => f.kind === "drawing",
                                  )
                                    ? "Engineering models use worksheet objects, not decorative drawings."
                                    : undefined
                                }
                                onClick={() =>
                                  prepareModel(selectedFrames.map((f) => f.id))
                                }
                              >
                                Make model
                              </button>
                            </div>
                          </details>
                          <button
                            aria-label="Clear canvas selection"
                            onClick={() => setCanvasSelection([])}
                          >
                            <X size={14} />
                          </button>
                        </CanvasSelectionToolbar>
                      )}
                    {overlay === "dependencies" && !trials.expand && (
                      <svg
                        className="er-dependencies"
                        width={width}
                        height={height}
                        aria-label="Dependency overlay"
                      >
                        <defs>
                          <marker
                            id="er-arrow"
                            markerWidth="5"
                            markerHeight="5"
                            refX="4"
                            refY="2.5"
                            orient="auto"
                          >
                            <path d="M0,0 L5,2.5 L0,5" />
                          </marker>
                        </defs>
                        {dependencyEdges
                          .filter(
                            (edge) =>
                              !selectedId ||
                              (related.has(edge.from) && related.has(edge.to)),
                          )
                          .map((edge) => {
                            const a = places[edge.from],
                              b = places[edge.to],
                              x = Math.min(a.x, b.x) - 28;
                            return (
                              <g
                                key={`${edge.from}-${edge.to}`}
                                onClick={() => {
                                  setSelected(edge.to);
                                  setTerm(edge.name);
                                }}
                              >
                                <path
                                  d={`M${a.x - 8},${a.y + 20} C${x - 45},${a.y + 20} ${x - 45},${b.y + 20} ${b.x - 8},${b.y + 20}`}
                                  markerEnd="url(#er-arrow)"
                                />
                                <title>
                                  {edge.name} supplies{" "}
                                  {p.kinds[edge.to] === "constraint"
                                    ? "requirement on "
                                    : ""}
                                  {p.statements.get(edge.to)?.name}
                                </title>
                              </g>
                            );
                          })}
                      </svg>
                    )}
                    {dataDrag && (
                      <svg
                        className="er-data-drag"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          pointerEvents: "none",
                          zIndex: 35,
                        }}
                      >
                        <path
                          d={`M${dataDrag.start.x},${dataDrag.start.y} L${dataDrag.end.x},${dataDrag.end.y}`}
                          stroke="#7b62a3"
                          strokeWidth="2"
                          strokeDasharray="5 4"
                        />
                        <text x={dataDrag.end.x + 12} y={dataDrag.end.y - 12}>
                          Connect paired columns
                        </text>
                      </svg>
                    )}
                    {dataReview && (
                      <DatasetReview
                        key={`${dataReview.dataset}-${dataReview.output || "pick"}`}
                        page={page}
                        {...dataReview}
                        close={() => setDataReview(undefined)}
                        accept={(relation, placement) => {
                          try {
                            const frames = readCanvasFrames(),
                              anchor = frames.find(
                                (f) =>
                                  f.id ===
                                  (placement === "source"
                                    ? relation.dataset
                                    : relation.output),
                              )!;
                            const spot = placeDataResult(
                              placement === "model"
                                ? {
                                    ...anchor,
                                    height: Math.max(anchor.height, 280),
                                  }
                                : anchor,
                              frames,
                              (viewportScroll(canvas.current).x +
                                (canvas.current?.clientWidth || 1200)) /
                                zoom,
                            );
                            const id = session.bindDataset(relation, spot);
                            // The review may scroll while focusing its controls. Bring
                            // the new view back into the same visible working context.
                            requestAnimationFrame(() => {
                              const node = canvas.current;
                              const result = node?.querySelector<HTMLElement>(
                                `[data-data-relation-id="${id}"]`,
                              );
                              revealCanvasElement(result, {
                                block: "nearest",
                                inline: "nearest",
                              });
                              if (!node || !result) return;
                              // Leave space for the contextual relationship trail so
                              // the equation beside this plot remains readable too.
                              const rect = result.getBoundingClientRect();
                              const margin = Math.min(
                                100,
                                Math.max(
                                  0,
                                  node.clientHeight - rect.height - 20,
                                ),
                              );
                              const top =
                                rect.top - node.getBoundingClientRect().top;
                              if (top < margin)
                                scrollCanvasTo(node, {
                                  top: viewportScroll(node).y - (margin - top),
                                });
                            });
                            setDataReview(undefined);
                            setSelected(id);
                            setDataSelection({
                              dataset: relation.dataset,
                              rows:
                                relation.scope.kind === "records"
                                  ? relation.scope.rows
                                  : [],
                              columns: relation.bindings.map((b) => b.column),
                              kind:
                                relation.scope.kind === "records"
                                  ? "record"
                                  : "series",
                            });
                          } catch (e) {
                            setMessage((e as Error).message);
                          }
                        }}
                      />
                    )}
                    <DataRelationshipOverlay
                      page={page}
                      selection={activeData}
                      canvas={canvas}
                      zoom={zoom}
                      trace={relationshipNav.trace}
                      preferred={
                        activeData?.detail === "requirement"
                          ? "requirement"
                          : activeData?.kind === "series" ||
                              activeData?.view === activeData?.dataset
                            ? "evidence"
                            : "calculation"
                      }
                    />
                    {(page.dataRelations || []).map((relation) => (
                      <DatasetResult
                        key={relation.id}
                        relation={relation}
                        hidden={
                          spatial.hidden.has(relation.id) ||
                          !!(
                            relationshipNav.focus?.mode === "arrange" &&
                            !relationshipNav.focus.ids.includes(relation.id)
                          )
                        }
                        page={page}
                        at={places[relation.id]}
                        selected={
                          selected === relation.id ||
                          relatedData.includes(relation)
                        }
                        selection={activeData}
                        focus={() => spatial.focusObject(relation.id)}
                        showSource={(row) =>
                          relationshipNav.follow(relation, {
                            kind: "source",
                            row,
                          })
                        }
                        inspect={(row, column, additive) =>
                          chooseData({
                            dataset: relation.dataset,
                            rows:
                              additive &&
                              activeData?.dataset === relation.dataset
                                ? [...new Set([...activeData.rows, row])]
                                : [row],
                            columns: column === undefined ? [] : [column],
                            kind: column === undefined ? "record" : "cell",
                            relation: relation.id,
                            view: relation.id,
                          })
                        }
                        move={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          drag.current = {
                            id: relation.id,
                            x: e.clientX,
                            y: e.clientY,
                            start: places[relation.id],
                          };
                          const node = e.currentTarget as HTMLElement;
                          const move = (event: globalThis.PointerEvent) => {
                            if (drag.current?.id === relation.id)
                              dragFrame.schedule({
                                [relation.id]: {
                                  x:
                                    drag.current.start.x +
                                    (event.clientX - drag.current.x) / zoom,
                                  y:
                                    drag.current.start.y +
                                    (event.clientY - drag.current.y) / zoom,
                                },
                              });
                          };
                          const end = (event: globalThis.PointerEvent) => {
                            node.removeEventListener("pointermove", move);
                            node.removeEventListener("pointerup", end);
                            node.removeEventListener("pointercancel", cancel);
                            if (drag.current?.id === relation.id) {
                              dragFrame.cancel();
                              spatial.finishPositions({
                                [relation.id]: {
                                  x:
                                    drag.current.start.x +
                                    (event.clientX - drag.current.x) / zoom,
                                  y:
                                    drag.current.start.y +
                                    (event.clientY - drag.current.y) / zoom,
                                },
                              });
                              drag.current = undefined;
                              setDragPreview({});
                            }
                          };
                          const cancel = () => {
                            dragFrame.cancel();
                            node.removeEventListener("pointermove", move);
                            node.removeEventListener("pointerup", end);
                            node.removeEventListener("pointercancel", cancel);
                            drag.current = undefined;
                            setDragPreview({});
                          };
                          node.addEventListener("pointermove", move);
                          node.addEventListener("pointerup", end);
                          node.addEventListener("pointercancel", cancel);
                        }}
                        remove={() =>
                          session.removeDatasetRelation(relation.id)
                        }
                      />
                    ))}
                    {page.regions.map((region) => {
                      const id = region.id,
                        at = places[id],
                        s = p.statements.get(id),
                        dataRelation = (page.dataRelations || []).find(
                          (r) =>
                            r.output === id ||
                            (s?.relation !== "=" &&
                              p.statements.get(r.output)?.name === s?.name),
                        ),
                        dataState = dataRelation
                          ? datasetStates[dataRelation.id]
                          : undefined,
                        error =
                          dataState?.result &&
                          p.errors.get(id)?.startsWith("Define ")
                            ? undefined
                            : p.errors.get(id),
                        q = s && p.solved.values.get(s.name),
                        condition = p.solved.constraints.get(id),
                        other = s && original?.solved.values.get(s.name),
                        kind = p.kinds[id],
                        effectiveText = p.texts[id];
                      return (
                        <section
                          key={id}
                          data-region-id={id}
                          data-kind={kind}
                          data-interaction={
                            editing === id
                              ? "editing"
                              : selected === id
                                ? "selected"
                                : "idle"
                          }
                          className={`er-region ${editing === id ? "is-editing" : ""} ${activeData?.view === id ? "is-navigation-target" : ""} ${dataRelatedIds.has(id) || dataDrag?.target === id ? "is-data-connected" : ""} ${linkMenu?.mode === "inspect" && (linkMenu.source === id || connectionNodes.some((node) => node.id === id)) ? "is-connected" : ""} ${expansionId === id ? "is-investigating" : ""} ${exploration && (id === exploration.input || ancestors(p, id).includes(exploration.input)) ? "er-preview-region" : ""} ${selected === id ? "is-selected" : ""} ${overlay === "dependencies" && selectedId && !related.has(id) ? "is-dimmed" : ""} ${overlay === "requirements" && kind === "constraint" ? "er-condition-focus" : ""} ${page.active !== "original" && contexts.find((c) => c.id === page.active)?.overrides[id] ? "er-overridden" : ""}`}
                          style={{
                            left: at.x,
                            top: at.y,
                            display:
                              spatial.hidden.has(id) ||
                              (relationshipNav.focus?.mode === "arrange" &&
                                !relationshipNav.focus.ids.includes(id))
                                ? "none"
                                : undefined,
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            if (!e.shiftKey) setCanvasSelection([id]);
                            setSelected(id);
                            setAreaSelection(id);
                            if (
                              !(e.target as Element).closest(
                                "button,[role=button],math",
                              )
                            ) {
                              setTerm(undefined);
                              setSelectionDetail(undefined);
                            }
                          }}
                        >
                          <button
                            className="er-grip"
                            aria-label={`Move ${s?.name || "region"}`}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              drag.current = {
                                id,
                                x: e.clientX,
                                y: e.clientY,
                                start: at,
                              };
                            }}
                            onPointerMove={(e) => {
                              if (drag.current?.id === id)
                                dragFrame.schedule({
                                  [id]: {
                                    x:
                                      drag.current.start.x +
                                      (e.clientX - drag.current.x) / zoom,
                                    y:
                                      drag.current.start.y +
                                      (e.clientY - drag.current.y) / zoom,
                                  },
                                });
                            }}
                            onPointerUp={(e) => {
                              if (drag.current) {
                                dragFrame.cancel();
                                spatial.finishPositions({
                                  [id]: {
                                    x:
                                      drag.current.start.x +
                                      (e.clientX - drag.current.x) / zoom,
                                    y:
                                      drag.current.start.y +
                                      (e.clientY - drag.current.y) / zoom,
                                  },
                                });
                                drag.current = undefined;
                                setDragPreview({});
                                e.currentTarget.releasePointerCapture(
                                  e.pointerId,
                                );
                              }
                            }}
                            onPointerCancel={() => {
                              dragFrame.cancel();
                              drag.current = undefined;
                              setDragPreview({});
                            }}
                          >
                            <GripVertical size={16} />
                          </button>
                          {s && editing !== id && (
                            <button
                              className="er-link-handle"
                              data-link-source={id}
                              aria-label={`Link ${s.relation === "=" ? s.name : `requirement ${s.name}`}`}
                              title="Drag to connect · click for connections"
                              onClick={(e) => {
                                e.stopPropagation();
                                inspectConnections(id);
                              }}
                            >
                              <Link2 size={15} />
                            </button>
                          )}
                          {selected === id &&
                            editing !== id &&
                            effectiveText &&
                            !variation &&
                            !palette && (
                              <details
                                key={JSON.stringify(
                                  commandContextFor(id).target,
                                )}
                                className="er-actions"
                                onClick={(e) => e.stopPropagation()}
                                onToggle={(e) => {
                                  if (
                                    e.currentTarget.open &&
                                    e.currentTarget.isConnected
                                  )
                                    revealCanvasElement(
                                      e.currentTarget.querySelector(
                                        '[role="toolbar"]',
                                      ),
                                      { block: "nearest", inline: "nearest" },
                                    );
                                }}
                                onBlur={(e) => {
                                  if (
                                    !e.currentTarget.contains(e.relatedTarget)
                                  )
                                    e.currentTarget.open = false;
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.open = false;
                                    e.currentTarget
                                      .querySelector("summary")
                                      ?.focus();
                                  }
                                }}
                              >
                                <summary
                                  aria-label="Region commands"
                                  title="Region actions"
                                >
                                  <MoreHorizontal size={17} />
                                </summary>
                                <div
                                  className={
                                    quiet
                                      ? "er-object-actions"
                                      : "er-region-actions"
                                  }
                                  style={{
                                    maxWidth: (viewportWidth - 24) / zoom,
                                  }}
                                  role="toolbar"
                                  aria-label={`${commandSubject(commandContextFor(id))} actions`}
                                  data-selection-kind={
                                    commandContextFor(id).target.kind
                                  }
                                >
                                  <span className="er-command-selection">
                                    {commandSubject(commandContextFor(id))}
                                  </span>
                                  {toolbarCommands(
                                    contextCommandsFor(id),
                                    commandContextFor(id).target.kind,
                                  ).map((command) => (
                                    <button
                                      key={command.key}
                                      data-command-id={command.id}
                                      data-command-key={command.key}
                                      disabled={!!command.unavailable}
                                      title={
                                        command.unavailable || command.preview
                                      }
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        executeCommand(command);
                                      }}
                                    >
                                      {command.toolbarLabel}
                                    </button>
                                  ))}
                                  <button
                                    aria-label="More region actions"
                                    title="All actions"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      const rect =
                                        event.currentTarget.getBoundingClientRect();
                                      openActionMenu(
                                        rect.left,
                                        rect.bottom,
                                        id,
                                      );
                                    }}
                                  >
                                    <MoreHorizontal size={17} />
                                  </button>
                                </div>
                              </details>
                            )}
                          {expansionId === id && !focusedInput && (
                            <button
                              className="er-investigation-close"
                              aria-label="Close relationship"
                              onClick={() => {
                                setTerm(undefined);
                                setOverlay("none");
                              }}
                            >
                              <X size={14} />
                            </button>
                          )}
                          {editing === id ? (
                            <>
                              <textarea
                                ref={editor}
                                aria-label="Write an engineering region"
                                value={draft}
                                spellCheck={false}
                                rows={Math.max(1, draft.split("\n").length)}
                                onChange={(e) => {
                                  setDraft(e.target.value);
                                  setCaret(e.target.selectionStart);
                                  setMentionDismissed(false);
                                }}
                                onSelect={(e) =>
                                  setCaret(e.currentTarget.selectionStart)
                                }
                                aria-autocomplete="list"
                                aria-describedby="er-writing-help"
                                aria-controls={
                                  mention ? "er-reference-options" : undefined
                                }
                                aria-activedescendant={
                                  mentionCandidates[mentionIndex]
                                    ? `er-reference-${mentionCandidates[mentionIndex].id}`
                                    : undefined
                                }
                                onBlur={() => {
                                  if (skipBlur.current) {
                                    skipBlur.current = false;
                                    return;
                                  }
                                  commit();
                                }}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  // Let the input method finish its text before treating
                                  // Enter, Escape or arrows as canvas commands.
                                  if (
                                    e.nativeEvent.isComposing ||
                                    e.keyCode === 229
                                  )
                                    return;
                                  if (
                                    mention &&
                                    (e.key === "Escape" ||
                                      (mentionCandidates.length > 0 &&
                                        !e.shiftKey &&
                                        [
                                          "ArrowDown",
                                          "ArrowUp",
                                          "Enter",
                                          "Tab",
                                        ].includes(e.key)))
                                  ) {
                                    e.preventDefault();
                                    if (e.key === "Escape")
                                      setMentionDismissed(true);
                                    else if (
                                      e.key === "ArrowDown" ||
                                      e.key === "ArrowUp"
                                    )
                                      setMentionIndex(
                                        (i) =>
                                          (i +
                                            (e.key === "ArrowDown" ? 1 : -1) +
                                            Math.max(
                                              1,
                                              mentionCandidates.length,
                                            )) %
                                          Math.max(1, mentionCandidates.length),
                                      );
                                    else if (mentionCandidates[mentionIndex])
                                      insertReference(
                                        mentionCandidates[mentionIndex].id,
                                      );
                                    return;
                                  }
                                  if (
                                    (e.metaKey || e.ctrlKey) &&
                                    e.key.toLowerCase() === "k"
                                  ) {
                                    e.preventDefault();
                                    paletteOpen("search");
                                    return;
                                  }
                                  if (e.key === "/" && !draft.trim()) {
                                    e.preventDefault();
                                    paletteOpen("slash");
                                    return;
                                  }
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    skipBlur.current = true;
                                    commit(true);
                                    return;
                                  }
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    skipBlur.current = true;
                                    commit();
                                    return;
                                  }
                                  if (e.key === "Tab") {
                                    const spans = sourceSpans(draft),
                                      cursor = e.currentTarget.selectionEnd;
                                    const next = e.shiftKey
                                      ? [...spans]
                                          .reverse()
                                          .find(
                                            (span) =>
                                              span.end <
                                              e.currentTarget.selectionStart,
                                          )
                                      : spans.find(
                                          (span) =>
                                            span.start >= cursor &&
                                            span.end !== cursor,
                                        );
                                    if (next) {
                                      e.preventDefault();
                                      e.currentTarget.setSelectionRange(
                                        next.start,
                                        next.end,
                                      );
                                    } else if (!e.shiftKey) {
                                      e.preventDefault();
                                      skipBlur.current = true;
                                      commit(true);
                                    }
                                  }
                                }}
                              />
                              <small
                                id="er-writing-help"
                                className="er-writing-help"
                              >
                                {mention && mentionCandidates.length
                                  ? "↑↓ Choose · Enter Insert reference · Esc Dismiss · Shift+Enter New line"
                                  : "Enter Continue below · Esc Finish · Shift+Enter New line · @ Reference"}
                              </small>
                              {mention && (
                                <div
                                  id="er-reference-options"
                                  className="er-reference-menu"
                                  role="listbox"
                                  aria-label="Reference an object"
                                  onPointerDown={(e) => e.preventDefault()}
                                >
                                  {mentionCandidates.map((candidate, index) => {
                                    const definition = accepted.statements.get(
                                        candidate.id,
                                      ),
                                      value =
                                        definition &&
                                        accepted.solved.values.get(
                                          definition.name,
                                        );
                                    return (
                                      <button
                                        id={`er-reference-${candidate.id}`}
                                        key={candidate.id}
                                        role="option"
                                        aria-selected={index === mentionIndex}
                                        onClick={() =>
                                          insertReference(candidate.id)
                                        }
                                      >
                                        <strong>
                                          {definition?.name ||
                                            candidate.data?.name}
                                        </strong>
                                        <span>
                                          {definition
                                            ? quantityDescription(
                                                definition.name,
                                              )
                                            : "Evidence reference"}
                                        </span>
                                        <small>
                                          {value
                                            ? display(value)
                                            : candidate.data
                                              ? "Not a calculation input"
                                              : ""}
                                        </small>
                                      </button>
                                    );
                                  })}
                                  {!mentionCandidates.length && (
                                    <small role="status">
                                      No matching resolved quantities. Keep
                                      writing or press Esc to dismiss.
                                    </small>
                                  )}
                                </div>
                              )}
                            </>
                          ) : region.data ? (
                            <DataRegion
                              data={region.data}
                              navigating={!!activeData?.relation}
                              dataset={region.id}
                              trace={
                                (page.dataRelations || []).some(
                                  (r) => r.dataset === region.id,
                                )
                                  ? () => {
                                      const relation = page.dataRelations!.find(
                                        (r) => r.dataset === region.id,
                                      )!;
                                      setSelected(relation.output);
                                      revealCanvasElement(
                                        canvas.current?.querySelector(
                                          `[data-region-id="${relation.output}"]`,
                                        ),
                                        {
                                          block: "nearest",
                                          inline: "nearest",
                                        },
                                      );
                                    }
                                  : undefined
                              }
                              collapsed={collapsedData.includes(region.id)}
                              toggleCollapsed={() =>
                                setCollapsedData((ids) =>
                                  ids.includes(region.id)
                                    ? ids.filter((id) => id !== region.id)
                                    : [...ids, region.id],
                                )
                              }
                              selection={activeData}
                              choose={(rows, columns, kind) =>
                                chooseData({
                                  dataset: region.id,
                                  rows,
                                  columns,
                                  kind,
                                })
                              }
                              connect={(columns, rows) =>
                                openDataReview(region.id, columns, rows)
                              }
                              selected={areaSelection || selectedId}
                              bound={page.regions
                                .filter((r) => r.source?.dataset === id)
                                .map((r) => ({
                                  row: r.source!.row,
                                  column: r.source!.column,
                                  id: r.id,
                                  name: p.statements.get(r.id)?.name || r.id,
                                }))}
                              select={(id) => {
                                setDataSelection(undefined);
                                setSelected(id);
                                setAreaSelection(id);
                                revealCanvasElement(
                                  canvas.current?.querySelector(
                                    `[data-region-id="${id}"]`,
                                  ),
                                  {
                                    block: "nearest",
                                    inline: "nearest",
                                  },
                                );
                              }}
                              define={(row, column, name, unit) => {
                                const spot = {
                                  x: at.x,
                                  y:
                                    (readCanvasFrames().find(
                                      (f) => f.id === region.id,
                                    )?.height || 250) +
                                    at.y +
                                    45,
                                };
                                for (const f of readCanvasFrames())
                                  if (
                                    f.id !== region.id &&
                                    spot.x < f.x + f.width &&
                                    spot.x + 500 > f.x &&
                                    spot.y < f.y + f.height &&
                                    spot.y + 80 > f.y
                                  )
                                    spot.y = f.y + f.height + 25;
                                const id = session.quantityFromCell(
                                  region.id,
                                  row,
                                  column,
                                  name,
                                  unit,
                                  spot,
                                );
                                setSelected(id);
                                setAreaSelection(id);
                              }}
                            />
                          ) : region.external ? (
                            <ExternalReferenceView
                              name={region.label || effectiveText}
                              reference={region.external}
                              edit={() => setReferenceEditor(id)}
                            />
                          ) : s ? (
                            <div
                              className="er-math-line"
                              onDoubleClick={() => begin(id)}
                            >
                              <MathLine
                                statement={s}
                                text={effectiveText}
                                inputVersion={session.document}
                                directEdit={quiet && !variation}
                                selectOnClick
                                inspectSymbols={(page.dataRelations || []).some(
                                  (r) => r.output === id,
                                )}
                                linkSources={accepted.sources}
                                onSymbol={(name) => {
                                  const r = (page.dataRelations || []).find(
                                    (r) => r.output === id,
                                  );
                                  if (r) {
                                    const binding = r.bindings.find(
                                      (b) =>
                                        (b.quantity
                                          ? p.statements.get(b.quantity)?.name
                                          : b.symbol) === name,
                                    );
                                    if (binding) {
                                      chooseData({
                                        dataset: r.dataset,
                                        view: id,
                                        rows: [],
                                        columns: [binding.column],
                                        kind: "series",
                                      });
                                      return true;
                                    }
                                    if (name === s.name) {
                                      chooseData({
                                        dataset: r.dataset,
                                        view: id,
                                        rows: activeData?.rows || [],
                                        columns: [],
                                        kind: activeData?.rows.length
                                          ? "record"
                                          : "series",
                                      });
                                      return true;
                                    }
                                  }
                                  const source = accepted.sources[name]?.[0];
                                  if (source) {
                                    if (!hierarchy.visible(source)) {
                                      setModelTrace(source);
                                      return true;
                                    }
                                    setDataSelection(undefined);
                                    setAreaSelection(source);
                                  }
                                }}
                                choose={(name) => chooseTerm(id, name)}
                                scrub={scrubFor(id)}
                                resolved={
                                  expansionId === id && kind === "equation"
                                    ? p
                                    : undefined
                                }
                                scrubSource={scrubFor}
                                edit={(span) => begin(id, span)}
                                highlight={
                                  linkedName ||
                                  (systemOpen && systemInput
                                    ? p.statements.get(systemInput)?.name
                                    : undefined)
                                }
                                highlights={dataSymbols}
                                highlightExpression={
                                  artifactFocus?.target === "expression" &&
                                  linkedArtifact?.output === id
                                }
                              />
                              {dataState && kind === "equation" && (
                                <button
                                  className="er-data-model-result"
                                  onClick={() => {
                                    setSelected(dataRelation!.id);
                                    revealCanvasElement(
                                      canvas.current?.querySelector(
                                        `[data-data-relation-id="${dataRelation!.id}"]`,
                                      ),
                                      {
                                        block: "nearest",
                                        inline: "nearest",
                                      },
                                    );
                                  }}
                                >
                                  {dataState.error
                                    ? `Dataset blocked · ${dataState.error}`
                                    : `${dataState.result!.records.length} records · calculated`}
                                </button>
                              )}
                              {(kind === "equation" ||
                                (kind === "quantity" &&
                                  s &&
                                  !quantityLiteral(s.expression))) &&
                                q &&
                                !error && (
                                  <button
                                    className={`er-result ${artifactFocus?.target === "context" && linkedArtifact?.output === id ? "is-linked" : ""}`}
                                    data-result-for={s.name}
                                    aria-label={`Inspect result ${s.anonymous ? "expression" : s.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectionDetail({
                                        owner: id,
                                        kind: "result",
                                      });
                                      const a = artifacts.find(
                                        (a) => a.output === id,
                                      );
                                      if (a) {
                                        setArtifactFocus({
                                          id: a.id,
                                          target: "context",
                                        });
                                        setSelected(id);
                                        setTerm(undefined);
                                      } else chooseTerm(id, s.name);
                                    }}
                                  >
                                    {exploration &&
                                      ancestors(p, id).includes(
                                        exploration.input,
                                      ) && (
                                        <small className="er-result-preview">
                                          Preview
                                        </small>
                                      )}
                                    = {display(q)}
                                  </button>
                                )}
                              {kind === "constraint" &&
                                dataState?.result &&
                                !condition && (
                                  <span className="er-data-requirement-status">
                                    {
                                      dataState.result.records.filter(
                                        (r) => r.conditions[id],
                                      ).length
                                    }
                                    /{dataState.result.records.length} records
                                    within limit
                                  </span>
                                )}
                              {condition && !error && (
                                <span
                                  className={`er-condition ${condition.pass ? "is-pass" : "is-fail"} ${artifactFocus?.target === "requirement" && linkedRequirement === id ? "is-linked" : ""}`}
                                  role="status"
                                  title="This authored mathematical condition only; not physical validation"
                                >
                                  {condition.pass ? (
                                    <Check size={14} />
                                  ) : (
                                    <X size={14} />
                                  )}{" "}
                                  {exploration &&
                                  ancestors(p, id).includes(exploration.input)
                                    ? "Preview · "
                                    : ""}
                                  {condition.pass
                                    ? "Satisfied"
                                    : "Not satisfied"}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div
                              className={`er-note ${kind === "draft" ? "er-draft" : ""}`}
                              role="button"
                              tabIndex={0}
                              aria-label={
                                effectiveText
                                  ? `Edit thought: ${effectiveText}`
                                  : "Write here"
                              }
                              onDoubleClick={() => begin(id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  begin(id);
                                }
                              }}
                            >
                              {effectiveText ? (
                                <ReferencedNote
                                  text={effectiveText}
                                  links={page.links?.[id] || {}}
                                  labels={Object.fromEntries(
                                    page.regions.map((r) => [
                                      r.id,
                                      r.data?.name ||
                                        p.statements.get(r.id)?.name ||
                                        "Unavailable reference",
                                    ]),
                                  )}
                                  open={navigateLink}
                                />
                              ) : (
                                <span>Continue writing…</span>
                              )}
                            </div>
                          )}
                          {trials.scrub &&
                            kind === "quantity" &&
                            !editing &&
                            !quiet && (
                              <small className="er-value-hint">
                                ↔ Drag value to explore · click to type
                              </small>
                            )}
                          {kind === "equation" &&
                            dataRelation &&
                            dataState?.result &&
                            activeData?.dataset === dataRelation.dataset &&
                            activeData.detail === "calculation" &&
                            activeData.view === id &&
                            editing !== id && (
                              <RecordFeedback
                                page={page}
                                relation={dataRelation}
                                records={dataState.result.records}
                                selection={activeData}
                                clear={() => {
                                  setDataSelection(undefined);
                                  setAreaSelection(undefined);
                                  setSelected(undefined);
                                }}
                                follow={(row) => {
                                  relationshipNav.follow(dataRelation, {
                                    kind: "source",
                                    row,
                                  });
                                }}
                              />
                            )}
                          {kind === "constraint" &&
                            dataRelation &&
                            dataState?.result &&
                            activeData?.detail === "requirement" &&
                            activeData.view === id && (
                              <RecordFeedback
                                page={page}
                                relation={dataRelation}
                                records={dataState.result.records}
                                selection={activeData}
                                requirement={id}
                                clear={() => {
                                  setDataSelection(undefined);
                                  setAreaSelection(undefined);
                                  setSelected(undefined);
                                }}
                                follow={(row) =>
                                  relationshipNav.follow(dataRelation, {
                                    kind: "source",
                                    row,
                                  })
                                }
                              />
                            )}
                          {error && editing !== id && (
                            <details
                              className="er-region-error"
                              key={error}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={(e) => {
                                if (!e.currentTarget.contains(e.relatedTarget))
                                  e.currentTarget.open = false;
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.currentTarget.open = false;
                                  e.currentTarget
                                    .querySelector("summary")
                                    ?.focus();
                                }
                              }}
                              onToggle={(e) => {
                                if (e.currentTarget.open)
                                  revealCanvasElement(
                                    e.currentTarget.querySelector(
                                      ".er-region-error-details",
                                    ),
                                    { block: "nearest", inline: "nearest" },
                                  );
                              }}
                            >
                              <summary aria-label={error} title={error}>
                                !
                              </summary>
                              <div
                                className="er-region-error-details"
                                role="status"
                                style={{
                                  maxWidth: (viewportWidth - 24) / zoom,
                                }}
                              >
                                {error}
                                {s &&
                                  references(s.expression)
                                    .filter((name) => !p.sources[name])
                                    .slice(0, 1)
                                    .map((name) => (
                                      <button
                                        key={name}
                                        onClick={() => {
                                          const next = session.create(
                                            undefined,
                                            hierarchy.scope,
                                          );
                                          session.write(next, `${name} := `);
                                          begin(next);
                                        }}
                                      >
                                        Define {name} here <Plus size={11} />
                                      </button>
                                    ))}
                              </div>
                            </details>
                          )}
                          {kind === "note" &&
                            !region.data &&
                            effectiveText &&
                            editing !== id &&
                            selected === id && (
                              <small className="er-informal">
                                Informal thought · not executable
                              </small>
                            )}
                          {!quiet &&
                            compare &&
                            page.active !== "original" &&
                            other &&
                            s &&
                            kind === "equation" &&
                            !error && (
                              <small className="er-comparison">
                                Original {display(other)}{" "}
                                <span>
                                  →{" "}
                                  {
                                    contexts.find((c) => c.id === page.active)
                                      ?.label
                                  }{" "}
                                  {display(q)}
                                </span>
                              </small>
                            )}
                          {!quiet &&
                            compare &&
                            page.active !== "original" &&
                            condition && (
                              <small className="er-comparison">
                                Original{" "}
                                {original?.solved.constraints.get(id)?.pass
                                  ? "satisfied"
                                  : "not satisfied"}{" "}
                                <span>
                                  ·{" "}
                                  {
                                    contexts.find((c) => c.id === page.active)
                                      ?.label
                                  }{" "}
                                  {condition.pass
                                    ? "satisfied"
                                    : "not satisfied"}
                                </span>
                              </small>
                            )}
                          {region.source && selected === id && (
                            <button
                              className="er-source-caption"
                              onClick={(e) => {
                                e.stopPropagation();
                                revealCanvasElement(
                                  canvas.current?.querySelector(
                                    `[data-region-id="${region.source!.dataset}"]`,
                                  ),
                                  {
                                    block: "nearest",
                                    inline: "nearest",
                                  },
                                );
                              }}
                            >
                              {page.regions.find(
                                (r) => r.id === region.source!.dataset,
                              )?.data?.name || "Source unavailable"}{" "}
                              · row {region.source.row + 1} ·{" "}
                              {measurementCaption(
                                effectiveText,
                                s?.name || "q",
                                region.source,
                              )}
                            </button>
                          )}
                        </section>
                      );
                    })}
                    {page.plots
                      .filter((plot) => hierarchy.visible(plot.id))
                      .map((plot) => (
                        <CurveRegion
                          key={plot.id}
                          session={session}
                          workingPage={working}
                          zoom={zoom}
                          layoutCancelVersion={spatial.cancelVersion}
                          cancelLayout={spatial.cancel}
                          comparisonContext={comparisonContext}
                          previewOnMove={trials.scrub}
                          finishInput={finishValue}
                          commands={() => paletteOpen("search")}
                          quiet={quiet}
                          revert={revertExploration}
                          plot={{ ...plot, at: places[plot.id] }}
                          compare={compare}
                          selected={selected === plot.id}
                          select={() => {
                            setSelected(plot.id);
                            setTerm(undefined);
                          }}
                          move={(at) =>
                            spatial.finishPositions(
                              { [plot.id]: at },
                              undefined,
                              acceptedDocument,
                            )
                          }
                          resize={(w, h) =>
                            spatial.finishPositions(
                              {},
                              (staged) => staged.resize(plot.id, w, h),
                              acceptedDocument,
                            )
                          }
                          inspect={() => begin(plot.output)}
                          branch={branch}
                          reveal={() => {
                            setSelected(plot.id);
                            setOverlay("dependencies");
                          }}
                          setInput={setInput}
                        />
                      ))}
                    <ModelOptimizations
                      session={session}
                      buffers={editBuffers}
                      positions={spatial.preview}
                      move={(id, event) => spatial.start(id, event, true)}
                      beforeAction={() => {
                        if (editing && !commit()) return false;
                        setEditing(undefined);
                        revertExploration();
                        return true;
                      }}
                    />
                    <ModelAnalyses
                      session={session}
                      buffers={editBuffers}
                      positions={spatial.preview}
                      move={(id, event) => spatial.start(id, event, true)}
                      beforeAction={() => {
                        if (editing && !commit()) return false;
                        setEditing(undefined);
                        revertExploration();
                        return true;
                      }}
                    />
                    <IndependentModels
                      session={session}
                      editBuffers={editBuffers}
                      askAgent={(id, at) => {
                        if (!openAssistant(at)) return;
                        setCanvasSelection([]);
                        setAreaSelection(undefined);
                        setSelected(id);
                      }}
                      positions={spatial.preview}
                      move={(id, event) => spatial.start(id, event, true)}
                      beforeAction={() => {
                        if (editing && !commit()) return false;
                        setEditing(undefined);
                        revertExploration();
                        return true;
                      }}
                    />
                    {artifactMode &&
                      artifacts.map((a) => (
                        <ArtifactView
                          editBuffers={editBuffers}
                          dataSelection={activeData}
                          inspectMeasurement={(dataset, row, column) =>
                            chooseData({
                              dataset,
                              rows: [row],
                              columns: [column],
                            })
                          }
                          key={a.id}
                          artifact={{
                            ...a,
                            at: spatial.preview[a.id] || a.at,
                            views: a.views?.map((v) => ({
                              ...v,
                              at: spatial.preview[v.id] || v.at,
                            })),
                          }}
                          layoutCancelVersion={spatial.cancelVersion}
                          cancelLayout={spatial.cancel}
                          completeLayout={(view, geometry, expected, resize) =>
                            spatial.finishPositions(
                              resize ? {} : { [view]: geometry.at },
                              (staged) => {
                                if (
                                  !staged.artifacts
                                    .flatMap((item) => [
                                      item,
                                      ...(item.views || []),
                                    ])
                                    .some((item) => item.id === view)
                                )
                                  throw Error(
                                    "This artifact representation is unavailable.",
                                  );
                                if (resize)
                                  staged.setArtifacts((items) =>
                                    items.map((item) =>
                                      item.id === view
                                        ? {
                                            ...item,
                                            width: geometry.width,
                                            height: geometry.height,
                                          }
                                        : {
                                            ...item,
                                            ...(item.views
                                              ? {
                                                  views: item.views.map(
                                                    (part) =>
                                                      part.id === view
                                                        ? {
                                                            ...part,
                                                            width:
                                                              geometry.width,
                                                            height:
                                                              geometry.height,
                                                          }
                                                        : part,
                                                  ),
                                                }
                                              : {}),
                                          },
                                    ),
                                  );
                              },
                              expected,
                            )
                          }
                          closedViews={spatial.closed}
                          hiddenViews={spatial.hidden}
                          groupedViews={
                            new Set(
                              spatial.scene.groups.flatMap((g) => g.members),
                            )
                          }
                          viewContexts={spatial.scene.pins}
                          pinView={spatial.pin}
                          focusCanvas={spatial.focusObject}
                          detach={spatial.detach}
                          openTool={(editor, view, context) => {
                            const frame = spatial.frames.find(
                              (f) => f.id === view,
                            );
                            spatial.openTool(
                              editor,
                              a.output,
                              a.id,
                              context,
                              frame
                                ? { x: frame.x, y: frame.y + frame.height + 36 }
                                : undefined,
                            );
                          }}
                          trace={() =>
                            inspectConnections(a.output, {
                              x: a.at.x + 24,
                              y: a.at.y + 55,
                            })
                          }
                          page={page}
                          current={working}
                          zoom={zoom}
                          change={(next) =>
                            setArtifacts((items) =>
                              items.map((item) =>
                                item.id === next.id ? next : item,
                              ),
                            )
                          }
                          remove={() => spatial.closeView(a.id)}
                          explore={exploreValue}
                          vary={startVariation}
                          exploring={!!variation}
                          finish={finishValue}
                          revert={revertExploration}
                          accept={acceptExploration}
                          undo={() => undo("artifact")}
                          focus={artifactFocus}
                          select={(target, range, quantity, view) => {
                            setSelectionDetail({
                              kind: "plot",
                              definition: a.output,
                              owner:
                                target === "input" || target === "point"
                                  ? quantity || a.input
                                  : a.output,
                              view: a.id,
                            });
                            setAreaSelection(
                              target === "input" || target === "point"
                                ? quantity || a.input
                                : a.output,
                            );
                            setArtifactFocus({
                              id: a.id,
                              target,
                              range,
                              quantity,
                              view,
                            });
                            setSelected(
                              target === "input" || target === "point"
                                ? quantity || a.input
                                : a.output,
                            );
                            setTerm(undefined);
                            setOverlay("none");
                          }}
                          pending={
                            !!exploration &&
                            exploration.input === a.input &&
                            !gestureActive
                          }
                          canKeep={
                            lastEdit?.page === page &&
                            lastEdit.input === a.input
                          }
                          branch={(keep) => {
                            if (exploration) {
                              setMessage("Accept or revert the value first.");
                              return;
                            }
                            try {
                              const context =
                                keep && lastEdit
                                  ? lastEdit.before.active
                                  : page.active;
                              session.atomic((staged) => {
                                if (
                                  keep &&
                                  lastEdit?.page === page &&
                                  lastEdit.input === a.input
                                )
                                  staged.branchEdit(a.input, lastEdit.before);
                                else staged.branch();
                                staged.setArtifacts((items) =>
                                  items.map((item) =>
                                    item.id === a.id
                                      ? {
                                          ...item,
                                          compareContext: context,
                                          comparing: keep,
                                        }
                                      : item,
                                  ),
                                );
                              });
                              clearRecovery();
                              setArtifactFocus((focus) => ({
                                id: a.id,
                                target: "point",
                                view: focus?.view,
                              }));
                              setTerm(undefined);
                            } catch (e) {
                              setMessage((e as Error).message);
                            }
                          }}
                          measure={(id, height) =>
                            setArtifactHeights((previous) =>
                              Math.abs((previous[id] || 0) - height) < 1
                                ? previous
                                : { ...previous, [id]: height },
                            )
                          }
                        />
                      ))}
                    {spatial.scene.tools.map((t) => (
                      <CanvasToolView
                        key={t.id}
                        cancelVersion={spatial.cancelVersion}
                        accepted={t}
                        complete={spatial.finishTool}
                        cancel={spatial.cancel}
                        tool={{ ...t, at: spatial.preview[t.id] || t.at }}
                        zoom={zoom}
                        hidden={spatial.hidden.has(t.id)}
                        editorProps={canvasEditors}
                        change={(next) =>
                          spatial.setScene((s) => ({
                            ...s,
                            tools: s.tools.map((t) =>
                              t.id === next.id ? next : t,
                            ),
                          }))
                        }
                        close={() => spatial.closeTool(t.id)}
                        focus={() => spatial.focusObject(t.id)}
                        detach={() => spatial.detach(t.id)}
                        grouped={spatial.scene.groups.some((g) =>
                          g.members.includes(t.id),
                        )}
                      />
                    ))}
                    {expansionId && focusedInput && (
                      <div
                        className="er-expansion-position"
                        aria-label={
                          overlay === "dependencies"
                            ? "Dependency overlay"
                            : undefined
                        }
                        style={{ left: attachmentAt.x, top: attachmentAt.y }}
                      >
                        <RelationshipExpansion
                          accepted={page}
                          current={working}
                          p={p}
                          focus={expansionId}
                          symbol={term}
                          edit={(id) =>
                            begin(id, sourceSpans(accepted.texts[id] || "")[0])
                          }
                          close={() => {
                            setTerm(undefined);
                            setOverlay("none");
                          }}
                        />
                      </div>
                    )}
                    {showComparison && (
                      <SpatialComparison
                        page={page}
                        current={working}
                        context={comparisonContext!}
                        output={comparison!.output}
                        input={comparison!.input}
                        at={attachmentAt}
                        move={(at) => session.move(attachmentId, at)}
                        scrub={scrubFor}
                        edit={(id) =>
                          begin(id, sourceSpans(accepted.texts[id] || "")[0])
                        }
                        switchContext={(id) => {
                          revertExploration();
                          session.switchContext(id);
                        }}
                        close={() => setCompare(false)}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </WorkspaceAreas>
        </WorkspaceDock>
        {spatial.error && (
          <div role="status" className="er-message">
            {spatial.error}
          </div>
        )}
        {variation && exploration && working !== page && (
          <ExplorationControls
            key={`${exploration.context}:${variation.input}`}
            proposal={exploration}
            accepted={accepted}
            current={p}
            range={variation.range}
            anchor={explorationAnchor}
            change={(value) => exploreValue(variation.input, value)}
            changeRange={changeRange}
            accept={acceptExploration}
            keep={keepExploration}
            cancel={revertExploration}
          />
        )}
        {!variation &&
          explicit &&
          exploration &&
          working !== page &&
          !(pointControls && pointControls.input === exploration.input) && (
            <InlineExploration
              proposal={exploration}
              accepted={accepted}
              current={p}
              anchor={explorationAnchor}
              busy={gestureActive}
              accept={acceptExploration}
              revert={revertExploration}
            />
          )}
        {!exploration &&
          lastEdit?.page === page &&
          !(pointControls && pointControls.input === lastEdit.input) && (
            <InlineRecovery
              anchor={lastEdit.anchor}
              input={lastEdit.input}
              previous={lastEdit.previous}
              undo={() => undo("recovery")}
            />
          )}
        {term && selectedId && !trials.expand && (
          <aside
            className="er-popover er-term-popover"
            aria-label="Quantity actions"
          >
            <header>
              <b>{label(term)}</b>
              <button
                aria-label="Close quantity actions"
                onClick={() => setTerm(undefined)}
              >
                <X size={14} />
              </button>
            </header>
            {refs.length === 1 ? (
              <>
                <p>
                  {p.kinds[refs[0]] === "quantity"
                    ? "Assigned quantity"
                    : "Computed quantity"}{" "}
                  · this page
                  <br />
                  {display(p.solved.values.get(term))}
                </p>
                <button onClick={() => begin(refs[0])}>
                  Edit definition <ArrowUpRight size={13} />
                </button>
                <button onClick={() => plotSelection(refs[0])}>
                  Plot response
                </button>
                <button onClick={branch}>Try another assumption</button>
                <button onClick={() => setOverlay("dependencies")}>
                  Reveal dependencies
                </button>
              </>
            ) : (
              <p>
                {refs.length > 1
                  ? "This name is ambiguous: more than one definition uses it."
                  : "Unresolved on this page. Define it without leaving your calculation."}
              </p>
            )}
            <small>
              Selection, definition, and calculation remain the same object.
            </small>
          </aside>
        )}
        {palette && (
          <CommandPalette
            palette={palette}
            query={query}
            setQuery={setQuery}
            setPalette={setPalette}
            addConcept={(name) => {
              if (name === "Data") {
                const command = globalCommands.find(
                  (item) => item.id === "data.import",
                );
                if (command) executeCommand(command);
                return;
              }
              if (name === "Plot") {
                const command = selectedCommands.find(
                  (item) => item.id === "response.plot",
                );
                if (command) executeCommand(command);
                else
                  setMessage("Select a resolved equation to plot a response.");
                return;
              }
              if (
                ["Equation", "Quantity", "Constraint", "Note"].includes(name)
              ) {
                if (editing)
                  requestAnimationFrame(() => editor.current?.focus());
                else fresh();
                return;
              }
              setConcept(name);
            }}
            requestedConnection={requestedConnection}
            requestedPlot={requestedPlot}
            selectedContext={selectedContext}
            scopeLabel={
              hierarchy.path.map((model) => model.name).join(" / ") || "Canvas"
            }
            page={page}
            p={p}
            paletteCommands={paletteCommands}
            recentCommands={recentCommands}
            executeCommand={executeCommand}
            enterModel={hierarchy.go}
            revealRegion={hierarchy.reveal}
            regionOwner={hierarchy.owner}
          />
        )}
        {modelReview && (
          <ModelReview
            key={modelReview.existing?.id || "new-model"}
            page={page}
            members={modelReview.members}
            existing={modelReview.existing}
            representations={hierarchyRepresentations}
            close={() => setModelReview(undefined)}
            save={(model) => {
              if (modelReview.existing)
                session.exposeModel(
                  model.id,
                  model.inputs,
                  model.outputs,
                  model.name,
                );
              else {
                const bounds = frameBounds(
                  readCanvasFrames().filter((f) =>
                    modelReview.members.includes(hierarchy.canonical(f.id)),
                  ),
                );
                const anchor = { x: bounds?.x || 120, y: bounds?.y || 140 },
                  obstacles = readCanvasFrames().filter(
                    (f) => !model.members.includes(hierarchy.canonical(f.id)),
                  );
                const candidates = Array.from({ length: 24 }, (_, i) => ({
                  x: anchor.x + (i % 4) * 430,
                  y: anchor.y + Math.floor(i / 4) * 520,
                }));
                const at =
                  candidates.find(
                    (at) =>
                      !obstacles.some(
                        (f) =>
                          at.x < f.x + f.width + 24 &&
                          at.x + 390 > f.x &&
                          at.y < f.y + f.height + 24 &&
                          at.y + 480 > f.y,
                      ),
                  ) || candidates.at(-1)!;
                session.makeModel(
                  model,
                  at,
                  artifacts.flatMap((a) => [
                    a.id,
                    ...(a.views || []).map((v) => v.id),
                  ]),
                );
              }
              setModelReview(undefined);
              setCanvasSelection([]);
              setSelected(model.id);
            }}
          />
        )}
        {modelConnection && (
          <ModelConnection
            page={page}
            source={modelConnection}
            initialTarget={modelConnectionTarget}
            close={() => {
              setModelConnection(undefined);
              setModelConnectionTarget(undefined);
            }}
            accept={(edit) => session.connect(edit)}
          />
        )}
        {concept && (
          <aside
            className="er-popover er-concept"
            aria-label="Region design discussion"
          >
            <header>
              <span>Interaction design · {concept}</span>
              <button
                aria-label="Close concept"
                onClick={() => setConcept(undefined)}
              >
                <X size={14} />
              </button>
            </header>
            <p>{concepts.find(([name]) => name === concept)?.[2]}</p>
            <small>
              What must remain consistent when this object appears as notation,
              a curve, or a physical representation?
            </small>
            <button
              onClick={() => {
                setConcept(undefined);
                if (editing) editor.current?.focus();
                else if (selectedId) begin(selectedId);
                else fresh();
              }}
            >
              Continue writing
            </button>
          </aside>
        )}
        {message && (
          <div
            className="er-message"
            role="status"
            style={
              feedback.at
                ? {
                    left: `clamp(12px, ${feedback.at.x}px, calc(100vw - 352px))`,
                    top: `clamp(12px, ${feedback.at.y + 8}px, calc(100vh - 132px))`,
                    right: "auto",
                    bottom: "auto",
                    maxHeight: `calc(100vh - clamp(12px, ${feedback.at.y + 8}px, calc(100vh - 132px)) - 12px)`,
                  }
                : undefined
            }
          >
            {message}
            <button aria-label="Dismiss message" onClick={() => setMessage("")}>
              <X size={13} />
            </button>
          </div>
        )}
        {storageError && (
          <aside className="er-storage-error" role="status">
            {storageError}
            {saved?.blocked && (workspace.store() || saved.legacyRescue) && (
              <button onClick={() => void exportArtifacts(true)}>
                Save recovered file
              </button>
            )}
            {!saved?.blocked && (
              <>
                <button onClick={() => void saveLocal()}>
                  Retry local save
                </button>
                <button onClick={() => void exportArtifacts()}>
                  Save current work to file
                </button>
              </>
            )}
          </aside>
        )}
        {cleanupOpen && (
          <CanvasCleanupDialog
            session={session}
            store={workspace.store}
            save={saveLocal}
            close={() => setCleanupOpen(false)}
          />
        )}
        {history && (
          <CalculationHistory
            session={session}
            close={() => setHistory(false)}
          />
        )}
        {shortcutsOpen && (
          <KeyboardShortcuts
            preferences={shortcutPreferences}
            close={() => setShortcutsOpen(false)}
          />
        )}
      </main>
    </ArtifactComputationProvider>,
  );
}
