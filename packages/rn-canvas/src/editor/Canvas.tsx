import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoardGroup, BoardNote, BoardPage, SnapshotInfo, StoryEntry } from '../shared/protocol.ts';
import { type FlowData, FlowLayer, FlowLegend, type FlowMode, layoutFlows, viewFlows } from './Flows.tsx';
import { storyUrl } from '../shared/urls.ts';
import { api } from './api.ts';
import { seconds } from './HistoryDialog.tsx';
import { PALETTE_GAP, PALETTE_WIDTH, paletteSide } from './palette.ts';

/** `shown` : l'écran a affiché quelque chose ; `empty` : prêt mais toujours vide après un long délai. */
export type LoadState = 'shown' | 'empty';

export interface Device {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Famille, pour ranger le menu des appareils. */
  group: 'iPhone' | 'Android' | 'Pliables' | 'Tablettes';
}

/**
 * Tailles d'écran en points (ce que voit la mise en page), en portrait. « ≈ » : taille approchée,
 * calculée depuis la définition et la densité de l'écran, faute de valeur publiée par le fabricant.
 */
export const DEVICES: Device[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, group: 'iPhone' },
  { id: 'iphone-13-mini', label: 'iPhone 13 mini', width: 375, height: 812, group: 'iPhone' },
  { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852, group: 'iPhone' },
  { id: 'iphone-16-pro', label: 'iPhone 16 Pro', width: 402, height: 874, group: 'iPhone' },
  { id: 'iphone-15-plus', label: 'iPhone 15 Plus', width: 430, height: 932, group: 'iPhone' },
  { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', width: 440, height: 956, group: 'iPhone' },
  { id: 'galaxy-s24', label: 'Galaxy S24', width: 360, height: 780, group: 'Android' },
  { id: 'galaxy-s24-ultra', label: 'Galaxy S24 Ultra', width: 384, height: 824, group: 'Android' },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915, group: 'Android' },
  { id: 'galaxy-z-flip-5', label: 'Galaxy Z Flip 5 ≈', width: 412, height: 1006, group: 'Pliables' },
  { id: 'galaxy-z-fold-5', label: 'Galaxy Z Fold 5 (plié)', width: 344, height: 882, group: 'Pliables' },
  { id: 'galaxy-z-fold-5-open', label: 'Galaxy Z Fold 5 (déplié) ≈', width: 690, height: 829, group: 'Pliables' },
  { id: 'ipad-mini', label: 'iPad mini', width: 744, height: 1133, group: 'Tablettes' },
  { id: 'ipad', label: 'iPad / iPad Air 11"', width: 820, height: 1180, group: 'Tablettes' },
  { id: 'ipad-pro-11', label: 'iPad Pro 11"', width: 834, height: 1194, group: 'Tablettes' },
  { id: 'ipad-pro-13', label: 'iPad Pro 12,9"', width: 1024, height: 1366, group: 'Tablettes' },
  { id: 'galaxy-tab-s9', label: 'Galaxy Tab S9 ≈', width: 800, height: 1280, group: 'Tablettes' },
  { id: 'pixel-tablet', label: 'Pixel Tablet', width: 800, height: 1280, group: 'Tablettes' },
];

const GAP = 80;
const PADDING = 60;
const LABEL = 28;
/**
 * Les écrans sont rangés en grille plutôt qu'en une seule ligne interminable : assez de colonnes pour
 * que la grille reste à peu près carrée (89 écrans sur 4 colonnes donnaient une bande de 23 rangées).
 */
const MIN_COLUMNS = 4;
const MAX_COLUMNS = 8;
const VIEW_KEY = 'rn-canvas:view';
const VIEWS_KEY = 'rn-canvas:views';
const POSITIONS_KEY = 'rn-canvas:positions';
export const GROUP_COLORS = ['violet', 'blue', 'green', 'yellow', 'pink', 'grey'];
export const NOTE_COLORS = ['yellow', 'blue', 'green', 'pink'];
const newId = () => Math.random().toString(36).slice(2, 10);
/** Pas de la grille de points du fond : un écran déplacé s'y aligne. */
const SNAP = 20;

type View = { x: number; y: number; zoom: number };
export type Tool = 'select' | 'hand';
export const TOOL_KEY = 'rn-canvas:tool';
/** Emplacement, dans la barre du haut de l'éditeur, des outils Créer, Groupe, Note. */
export const TOPBAR_BOARD_SLOT = 'rnc-topbar-board';
const MINIMAP_KEY = 'rn-canvas:minimap';
export function readTool(): Tool {
  try {
    return localStorage.getItem(TOOL_KEY) === 'hand' ? 'hand' : 'select';
  } catch {
    return 'select';
  }
}
type Point = { x: number; y: number };

/** Positions mémorisées dans le navigateur par les versions précédentes (reprises dans la vue d'ensemble). */
export function legacyPositions(appUrl: string): Record<string, Point> {
  try {
    const all = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}');
    return all?.[appUrl] ?? {};
  } catch {
    return {};
  }
}

const validView = (view: View | null | undefined): View | null => (view && [view.x, view.y, view.zoom].every(Number.isFinite) ? view : null);

/** Vue (déplacement, zoom) de chaque page, mémorisée dans le navigateur. */
function readView(page: string): View | null {
  try {
    const views = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '{}') ?? {};
    if (views[page]) return validView(views[page]);
    // Ancienne vue unique : celle de la vue d'ensemble.
    return page === 'overview' ? validView(JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null')) : null;
  } catch {
    return null;
  }
}

function writeView(page: string, view: View) {
  try {
    const views = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '{}') ?? {};
    views[page] = view;
    localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Stockage indisponible : la vue n'est simplement pas mémorisée.
  }
}

const inside = (point: Point, box: { x: number; y: number; width: number; height: number }) =>
  point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

/** Glisser en cours : un écran, un groupe (avec son contenu), le coin d'un groupe ou une note. */
type Drag =
  | { kind: 'story'; id: string; startX: number; startY: number; from: Point; moved: boolean; others: [string, Point][] }
  | { kind: 'group'; id: string; startX: number; startY: number; from: Point; moved: boolean; stories: [string, Point][]; notes: [string, Point][]; groups: [string, Point][] }
  | { kind: 'resize'; id: string; startX: number; startY: number; from: Point; moved: boolean; note: boolean }
  | { kind: 'note'; id: string; startX: number; startY: number; from: Point; moved: boolean };

interface Props {
  appUrl: string;
  isolateStories: boolean;
  /** Écrans affichés (cochés), dans l'ordre de la grille. */
  stories: StoryEntry[];
  /** Tous les écrans. Un écran décoché n'est pas chargé ; un écran loin de la vue est déchargé (voir `live`). */
  allStories: StoryEntry[];
  /** Écran déchargé (sorti de la vue) : son état de chargement repart de zéro. */
  onUnload?: (id: string) => void;
  device: Device;
  activeStory: string | null;
  errors: Record<string, string>;
  /** Appels réseau coupés par écran (voir `network` dans rn-canvas.config.tsx). */
  blocked?: Record<string, { count: number; hosts: string[] }>;
  /** Écrans affichés (premier rendu reçu) ; les autres montrent un indicateur de chargement. */
  loaded: Record<string, LoadState>;
  /** Stockage de rechange par écran (voir `storyUrl`). */
  generations: Record<string, number>;
  /** Mode Flux : liens de navigation à dessiner ; null quand il est désactivé. */
  flows: FlowData | null;
  frames: Map<string, HTMLIFrameElement>;
  onActivate: (id: string) => void;
  empty: boolean;
  /** Écrans gardés chargés hors de la vue, au plus (0 : tous). Voir le menu Affichage. */
  keepLoaded?: number;
  /** Charger tous les écrans cochés, pas seulement ceux autour de la vue. */
  loadAll?: boolean;
  /** Clic dans le vide du canevas (sans glisser). */
  onBackgroundClick?: () => void;
  /** Outils Groupe / Note et zoom (menu Affichage). */
  showBoardTools?: boolean;
  /** Noms au-dessus des écrans (menu Affichage). */
  showLabels?: boolean;
  /** Minicarte en bas à droite (menu Affichage). */
  showMinimap?: boolean;
  /** Retire ces écrans de la page (décochés dans la vue d'ensemble, sortis du parcours). */
  onHideStories?: (ids: string[]) => void;
  /** Ouvre la fenêtre « Créer » (composant ou écran). */
  onCreate?: () => void;
  /**
   * Écran qui vient d'être créé : posé au centre de la vue ou à côté de `anchor`, ajouté au parcours
   * affiché, puis cadré et sélectionné. `seq` change à chaque demande.
   */
  place?: { id: string; mode: 'center' | 'beside'; anchor: string | null; seq: number } | null;
  /** Écran à amener au centre de la vue (nouvel écran de composant) ; `seq` change à chaque demande. */
  reveal?: { id: string; seq: number } | null;
  /** Page affichée : disposition, groupes et notes. */
  page: BoardPage;
  onChangePage: (update: (page: BoardPage) => BoardPage) => void;
  /** Nouveau parcours avec ces écrans (bouton d'un groupe). */
  onCreateParcours: (name: string, stories: string[]) => void;
  flowMode: FlowMode;
  onFlowMode: (mode: FlowMode) => void;
  /** Écran dont la palette contextuelle est ouverte : ses voisins s'écartent pour lui faire place. */
  isolate?: string | null;
  /** Barres flottantes (bibliothèque) posées sur le canevas. */
  children?: React.ReactNode;
  /** Début de la barre du haut (onglets de pages). */
  top?: React.ReactNode;
  /** Outil piloté par la barre de l'éditeur (Sélection, Main) ; sinon l'outil est gardé ici. */
  tool?: Tool;
  onToolChange?: (tool: Tool) => void;
  /**
   * Écrans en images (moteur de captures du serveur) : chaque écran montre sa capture, seuls les
   * derniers écrans sélectionnés tournent en direct. null : chaque écran est une app chargée.
   */
  snapshots?: SnapshotView | null;
  /** Écrans visibles (du plus proche au plus loin du centre) : capturés en premier. */
  onVisible?: (ids: string[]) => void;
  /** Écrans en boucle de rendu : démontés (leur image reste), jusqu'à une nouvelle sélection. */
  looping?: Set<string>;
}

export interface SnapshotView {
  items: Record<string, SnapshotInfo>;
  url: (id: string, version: string) => string;
  queued: number;
  running: string[];
}

/**
 * Canevas infini : déplacement (glisser le fond, molette), zoom (Ctrl/⌘ + molette, boutons).
 * Un écran se déplace en glissant son nom ; sa position est mémorisée (bouton ⊞ : grille d'origine).
 */
/** Écrans chargés en parallèle : chacun charge l'app entière dans son iframe. */
const MAX_PARALLEL_LOADS = 4;
const LOAD_TIMEOUT = 30_000;
/** Écrans montés au plus (chacun garde une copie de l'app en mémoire). */
const MAX_LIVE = 12;
/** Marges autour de la vue, en fraction de sa taille : pour monter un écran, et pour le garder monté. */
const ENTER_MARGIN = 0.25;
const STAY_MARGIN = 1;
/** Délai sans mouvement de la vue avant de charger les écrans qui y sont entrés. */
const SETTLE_DELAY = 300;
/** Écrans en images : écrans en direct au plus (le sélectionné et le précédent, pour passer de l'un à l'autre). */
const LIVE_WITH_SNAPSHOTS = 2;

/** Grille de référence des positions enregistrées : l'iPhone 15 (appareil par défaut), comme jusqu'ici. */
const REFERENCE_CELL = { width: 393 + GAP, height: 852 + LABEL + GAP };

/** Positions, groupes et notes d'une page mis à une autre échelle (identique si l'échelle vaut 1). */
function scaleBoardPage(page: BoardPage, kx: number, ky: number): BoardPage {
  if (kx === 1 && ky === 1) return page;
  // Arrondi au dixième : aller-retour sans dérive à force de changer d'appareil.
  const x = (v: number) => Math.round(v * kx * 10) / 10;
  const y = (v: number) => Math.round(v * ky * 10) / 10;
  return {
    ...page,
    positions: Object.fromEntries(Object.entries(page.positions).map(([id, p]) => [id, { x: x(p.x), y: y(p.y) }])),
    groups: page.groups.map((g) => ({ ...g, x: x(g.x), y: y(g.y), width: x(g.width), height: y(g.height) })),
    notes: page.notes.map((n) => ({ ...n, x: x(n.x), y: y(n.y) })),
  };
}

/**
 * Retour à l'échelle de référence après une modification : seuls les éléments changés sont
 * reconvertis, les autres gardent exactement leur valeur enregistrée (pas de dérive d'arrondi).
 */
function unscaleChanges(stored: BoardPage, shown: BoardPage, next: BoardPage, kx: number, ky: number): BoardPage {
  if (shown === stored) return next;
  const back = scaleBoardPage(next, kx, ky);
  const keep = <T extends { id: string }>(items: T[], shownItems: T[], storedItems: T[], backItems: T[]) =>
    items.map((item, i) => {
      const at = shownItems.indexOf(item);
      return at >= 0 ? storedItems[at] : backItems[i];
    });
  return {
    ...back,
    positions: Object.fromEntries(Object.entries(next.positions).map(([id, p]) => [id, shown.positions[id] === p ? stored.positions[id] : back.positions[id]])),
    groups: keep(next.groups, shown.groups, stored.groups, back.groups),
    notes: keep(next.notes, shown.notes, stored.notes, back.notes),
  };
}

export function Canvas(props: Props) {
  const { appUrl, isolateStories, stories, allStories, device, activeStory, errors, loaded, generations, flows, frames, onActivate, onUnload, empty, reveal, children, top } = props;
  const { blocked = {}, snapshots = null, onVisible, looping } = props;
  const { page: storedPage, onChangePage: changeStoredPage, onCreateParcours, flowMode, onFlowMode, isolate, onBackgroundClick, keepLoaded = 24, loadAll = false, showBoardTools = true, showLabels = true, showMinimap = true, onHideStories, onCreate, place } = props;
  const cellWidth = device.width + GAP;
  const cellHeight = device.height + LABEL + GAP;
  // Positions, groupes et notes sont enregistrés pour la grille de l'appareil de référence ; chaque
  // appareil les étire selon la sienne : un écran plus large écarte d'autant ses voisins.
  const kx = cellWidth / REFERENCE_CELL.width;
  const ky = cellHeight / REFERENCE_CELL.height;
  const page = useMemo(() => scaleBoardPage(storedPage, kx, ky), [storedPage, kx, ky]);
  const onChangePage = useCallback(
    (update: (page: BoardPage) => BoardPage) =>
      changeStoredPage((stored) => {
        const shown = scaleBoardPage(stored, kx, ky);
        return unscaleChanges(stored, shown, update(shown), 1 / kx, 1 / ky);
      }),
    [changeStoredPage, kx, ky],
  );
  const viewport = useRef<HTMLDivElement>(null);
  // Vue mémorisée par page : ni un rechargement ni l'ajout / le masquage d'un écran ne la réinitialisent.
  const [view, setView] = useState<View>(() => readView(page.id) ?? { x: PADDING, y: PADDING, zoom: 0.75 });
  const autoFitted = useRef(readView(page.id) !== null);
  const viewPage = useRef(page.id);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const columns = Math.max(1, Math.min(stories.length, MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.ceil(Math.sqrt((stories.length * cellHeight) / cellWidth)))));
  const visible = useMemo(() => new Set(stories.map((s) => s.id)), [stories]);

  // Positions choisies à la main (coin haut gauche, nom compris) ; les autres écrans restent en grille.
  const positions = page.positions;
  const setPositions = useCallback(
    (update: (p: Record<string, Point>) => Record<string, Point>) => onChangePage((pg) => ({ ...pg, positions: update(pg.positions) })),
    [onChangePage],
  );
  const setGroups = useCallback((update: (g: BoardGroup[]) => BoardGroup[]) => onChangePage((pg) => ({ ...pg, groups: update(pg.groups) })), [onChangePage]);
  const setNotes = useCallback((update: (n: BoardNote[]) => BoardNote[]) => onChangePage((pg) => ({ ...pg, notes: update(pg.notes) })), [onChangePage]);
  const [editing, setEditing] = useState<string | null>(null);
  // Sélection multiple (Maj+clic sur un écran, Maj+glisser dans le vide) : déplacée d'un bloc, groupée,
  // mise en parcours ou masquée depuis sa barre d'actions.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelected = useCallback(
    (id: string) =>
      setSelected((sel) => {
        const next = new Set(sel);
        // Le premier Maj+clic emporte l'écran déjà sélectionné : on part de lui.
        if (next.size === 0 && activeStory && activeStory !== id && visible.has(activeStory)) next.add(activeStory);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [activeStory, visible],
  );
  // Écrans retirés de la page : retirés de la sélection.
  useEffect(() => {
    setSelected((sel) => ([...sel].every((id) => visible.has(id)) ? sel : new Set([...sel].filter((id) => visible.has(id)))));
  }, [visible]);
  // Lasso (Maj+glisser dans le vide), en coordonnées du canevas affiché.
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number; base: Set<string> } | null>(null);
  // Outils, comme dans Figma : Sélection (glisser dans le vide sélectionne, glisser un écran le déplace)
  // et Main (glisser déplace la vue, partout). Espace maintenu : la Main le temps de l'appui.
  const [toolState, setToolState] = useState<Tool>(readTool);
  const tool = props.tool ?? toolState;
  const onToolChange = useRef(props.onToolChange);
  onToolChange.current = props.onToolChange;
  // Minicarte fermée par défaut : elle prend de la place sur le canevas.
  const [minimapOpen, setMinimapState] = useState(() => {
    try {
      return localStorage.getItem(MINIMAP_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setMinimapOpen = (open: boolean) => {
    setMinimapState(open);
    try {
      localStorage.setItem(MINIMAP_KEY, open ? '1' : '0');
    } catch {
      // Stockage indisponible : le choix vaut pour la session.
    }
  };
  const setTool = useCallback((next: Tool) => {
    if (onToolChange.current) return onToolChange.current(next);
    setToolState(next);
    try {
      localStorage.setItem(TOOL_KEY, next);
    } catch {
      // Stockage indisponible : l'outil vaut pour la session.
    }
  }, []);
  const [spaceHand, setSpaceHand] = useState(false);
  const hand = spaceHand || tool === 'hand';
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) setSpaceHand(true);
      } else if (e.key === 'h' || e.key === 'H') setTool('hand');
      else if (e.key === 'v' || e.key === 'V') setTool('select');
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHand(false);
    };
    const reset = () => setSpaceHand(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, [setTool]);
  // Glissement de la Main sur un écran : le clic qui suit ne doit pas le sélectionner.
  const swallowClick = useRef(false);
  // Les écrans non placés à la main se rangent en grille, dans les premières cases libres : un nouvel
  // écran (fichier canvas ajouté, `rn-canvas screens`) ne tombe ni sur un écran placé, ni dans un groupe
  // ou une note, et ne repousse rien. (Ranger la grille sous tout ce qui est placé la faisait sauter
  // plus bas à chaque écran déplacé.)
  const gridPositions = useMemo(() => {
    const taken = [
      ...stories.filter((s) => positions[s.id]).map((s) => ({ ...positions[s.id], width: device.width, height: device.height + LABEL })),
      ...page.groups,
      ...page.notes.map((n) => ({ ...n, height: 120 })),
    ];
    const free = (x: number, y: number) =>
      !taken.some((b) => x < b.x + b.width + GAP / 2 && x + device.width + GAP / 2 > b.x && y < b.y + b.height + GAP / 2 && y + device.height + LABEL + GAP / 2 > b.y);
    const out = new Map<string, Point>();
    let cell = 0;
    for (const story of stories) {
      if (positions[story.id]) continue;
      for (; ; cell++) {
        const x = (cell % columns) * cellWidth;
        const y = Math.floor(cell / columns) * cellHeight;
        if (free(x, y)) {
          out.set(story.id, { x, y });
          cell++;
          break;
        }
      }
    }
    return out;
  }, [stories, positions, page.groups, page.notes, device, columns, cellWidth, cellHeight]);
  const positionOf = useCallback(
    (id: string): Point | null => {
      if (!visible.has(id)) return null;
      return positions[id] ?? gridPositions.get(id) ?? null;
    },
    [visible, positions, gridPositions],
  );
  // Avant un déplacement, les écrans encore en grille gardent leur place actuelle : sinon, l'écran
  // tiré sortant de la grille, ceux d'après s'y décaleraient.
  const pinGrid = useCallback(() => {
    if (gridPositions.size === 0) return;
    setPositions((p) => ({ ...Object.fromEntries(gridPositions), ...p }));
  }, [gridPositions, setPositions]);

  // Chargement à la demande : chaque écran est une iframe qui exécute toute l'app. Un écran se charge
  // quand il entre dans la vue (ou juste autour), au plus MAX_LIVE à la fois, les plus proches du centre
  // d'abord ; l'écran actif est toujours chargé. Une fois chargé, il reste monté hors de la vue (y
  // revenir est instantané), dans la limite de `keepLoaded` écrans : au-delà, les moins récemment vus
  // sont libérés. Les écrans décochés ne sont jamais chargés.
  const liveRef = useRef<Set<string>>(new Set());
  const lastSeen = useRef(new Map<string, number>());
  // Taille du canevas : inconnue au premier rendu (avant le montage), puis suivie (fenêtre, panneaux).
  // Sans elle, une vue mémorisée qui ne bouge pas ne monterait jamais aucun écran.
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setViewportSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Vue arrêtée depuis un instant : traverser une zone en glissant ne charge pas les écrans survolés.
  const [settled, setSettled] = useState(view);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(view), SETTLE_DELAY);
    return () => window.clearTimeout(timer);
  }, [view]);
  const snapshotMode = snapshots !== null;
  // Écrans en images : seuls les derniers écrans sélectionnés tournent en direct.
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (activeStory) setRecent((r) => [activeStory, ...r.filter((id) => id !== activeStory)].slice(0, LIVE_WITH_SNAPSHOTS));
  }, [activeStory]);
  const live = useMemo(() => {
    if (snapshots) {
      const next = new Set(recent.filter((id) => visible.has(id) && !looping?.has(id)));
      liveRef.current = next;
      return next;
    }
    const view = settled;
    const { width, height } = viewportSize;
    const cx = (width / 2 - view.x) / view.zoom;
    const cy = (height / 2 - view.y) / view.zoom;
    const area = (margin: number) => ({
      left: (-view.x - width * margin) / view.zoom,
      top: (-view.y - height * margin) / view.zoom,
      right: (width * (1 + margin) - view.x) / view.zoom,
      bottom: (height * (1 + margin) - view.y) / view.zoom,
    });
    const enter = area(ENTER_MARGIN);
    const stay = area(STAY_MARGIN);
    const overlaps = (p: Point, a: ReturnType<typeof area>) => p.x < a.right && p.x + device.width > a.left && p.y < a.bottom && p.y + device.height + LABEL > a.top;
    const candidates: { id: string; distance: number }[] = [];
    for (const s of stories) {
      const p = positionOf(s.id);
      if (!p) continue;
      if (loadAll || s.id === activeStory || overlaps(p, enter) || (liveRef.current.has(s.id) && overlaps(p, stay))) {
        candidates.push({ id: s.id, distance: s.id === activeStory ? -1 : Math.hypot(p.x + device.width / 2 - cx, p.y + device.height / 2 - cy) });
      }
    }
    const near = candidates.sort((a, b) => a.distance - b.distance).slice(0, loadAll ? undefined : MAX_LIVE).map((c) => c.id);
    const now = Date.now();
    for (const id of near) lastSeen.current.set(id, now);
    // Un écran déjà chargé reste monté hors de la vue : y revenir ne le recharge pas. Au-delà de
    // `keepLoaded` écrans montés, les moins récemment vus sont libérés (0 : aucune limite).
    const nearSet = new Set(near);
    const kept = [...liveRef.current]
      .filter((id) => !nearSet.has(id) && visible.has(id) && loaded[id])
      .sort((a, b) => (lastSeen.current.get(b) ?? 0) - (lastSeen.current.get(a) ?? 0));
    const room = keepLoaded > 0 ? Math.max(0, keepLoaded - near.length) : kept.length;
    const next = new Set([...near, ...kept.slice(0, room)]);
    liveRef.current = next;
    return next;
  }, [stories, positionOf, settled, viewportSize, device, activeStory, loaded, visible, keepLoaded, loadAll, snapshots, recent, looping]);

  // Écrans en images : ceux de la vue (du plus proche au plus loin du centre) sont capturés en premier.
  const inView = useMemo(() => {
    if (!snapshotMode) return '';
    const { width, height } = viewportSize;
    const view = settled;
    const cx = (width / 2 - view.x) / view.zoom;
    const cy = (height / 2 - view.y) / view.zoom;
    const left = (-view.x - width * ENTER_MARGIN) / view.zoom;
    const top = (-view.y - height * ENTER_MARGIN) / view.zoom;
    const right = (width * (1 + ENTER_MARGIN) - view.x) / view.zoom;
    const bottom = (height * (1 + ENTER_MARGIN) - view.y) / view.zoom;
    return stories
      .map((s) => ({ id: s.id, p: positionOf(s.id) }))
      .filter((s): s is { id: string; p: Point } => s.p !== null && s.p.x < right && s.p.x + device.width > left && s.p.y < bottom && s.p.y + device.height + LABEL > top)
      .sort((a, b) => Math.hypot(a.p.x - cx, a.p.y - cy) - Math.hypot(b.p.x - cx, b.p.y - cy))
      .map((s) => s.id)
      .join('\n');
  }, [snapshotMode, stories, positionOf, settled, viewportSize, device]);
  useEffect(() => {
    if (inView) onVisible?.(inView.split('\n'));
  }, [inView, onVisible]);

  // Compteur : écrans montés pas encore affichés.
  const pending = [...live].filter((id) => !loaded[id]).length;

  // Parmi les écrans montés, au plus MAX_PARALLEL_LOADS en cours de chargement à la fois. Un écran qui ne
  // répond pas libère sa place au bout de LOAD_TIMEOUT.
  const [admitted, setAdmitted] = useState<Record<string, number>>({});
  useEffect(() => {
    // Sortis de la vue : démontés, et leur état de chargement repart de zéro.
    const gone = Object.keys(admitted).filter((id) => !live.has(id));
    if (gone.length) {
      setAdmitted((a) => Object.fromEntries(Object.entries(a).filter(([id]) => live.has(id))));
      for (const id of gone) onUnload?.(id);
      return;
    }
    const now = Date.now();
    const inFlight = Object.entries(admitted).filter(([id, at]) => !loaded[id] && !errors[id] && now - at < LOAD_TIMEOUT).length;
    const free = MAX_PARALLEL_LOADS - inFlight;
    // `live` est déjà trié du plus proche au plus loin du centre.
    const waiting = [...live].filter((id) => !(id in admitted));
    if (free > 0 && waiting.length) {
      setAdmitted((a) => ({ ...a, ...Object.fromEntries(waiting.slice(0, free).map((id) => [id, now])) }));
      return;
    }
    if (inFlight === 0 || waiting.length === 0) return;
    // File pleine : réexaminer quand un délai de garde expire.
    const timer = window.setTimeout(() => setAdmitted((a) => ({ ...a })), 5000);
    return () => window.clearTimeout(timer);
  }, [admitted, live, loaded, errors, onUnload]);

  // Temps de chargement en direct de chaque écran (de son montage à son affichage), affiché à côté de
  // son nom et enregistré dans l'historique des chargements.
  const [liveTimes, setLiveTimes] = useState<Record<string, number>>({});
  const reported = useRef(new Set<string>());
  useEffect(() => {
    const now = Date.now();
    for (const id of reported.current) if (!(id in admitted)) reported.current.delete(id);
    const done = Object.keys(loaded).filter((id) => id in admitted && !reported.current.has(id));
    if (!done.length) return;
    const times: Record<string, number> = {};
    for (const id of done) {
      reported.current.add(id);
      times[id] = now - admitted[id];
      api.liveLoad(id, times[id], !errors[id]).catch(() => {});
    }
    setLiveTimes((t) => ({ ...t, ...times }));
  }, [loaded, admitted, errors]);

  // Emprise des écrans affichés, pour « tout afficher » et le calque des flèches.
  const bounds = useMemo(() => {
    const boxes = [
      ...stories.map((s) => positionOf(s.id)).filter((p): p is Point => p !== null).map((p) => ({ ...p, width: device.width, height: device.height + LABEL })),
      ...page.groups,
      ...page.notes.map((n) => ({ ...n, height: 120 })),
    ];
    if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
  }, [stories, positionOf, device, page.groups, page.notes]);

  // Palette ouverte à côté d'un écran : ce qui est dans sa rangée, du côté de la palette (écrans,
  // notes, groupes), glisse juste assez pour la laisser à découvert ; le groupe de l'écran
  // s'élargit d'autant. Décalage visuel seulement : la disposition enregistrée ne change pas.
  const shifts = useMemo(() => {
    const none = { stories: {} as Record<string, number>, notes: {} as Record<string, number>, groups: {} as Record<string, { dx: number; dw: number }> };
    const el = viewport.current;
    const p = isolate ? positionOf(isolate) : null;
    if (!el || !p) return none;
    const side = paletteSide(p.x * view.zoom + view.x, (p.x + device.width) * view.zoom + view.x, 0, el.clientWidth);
    const room = (PALETTE_GAP * 2 + PALETTE_WIDTH) / view.zoom;
    const top = p.y;
    const bottom = p.y + device.height + LABEL;
    const pivot = p.x + device.width / 2;
    const inRow = (y: number, height: number) => y < bottom && y + height > top;
    // Côté de la palette : à droite, ce qui commence après le milieu de l'écran ; à gauche, ce qui finit avant.
    const beyond = (x: number, width: number) => (side === 'right' ? x >= pivot : x + width <= pivot);
    const distance = (x: number, width: number) => (side === 'right' ? x - (p.x + device.width) : p.x - (x + width));

    const screens = stories
      .filter((st) => st.id !== isolate)
      .map((st) => ({ id: st.id, q: positionOf(st.id) }))
      .filter((st): st is { id: string; q: Point } => st.q !== null && inRow(st.q.y, device.height + LABEL) && beyond(st.q.x, device.width));
    const notes = page.notes.filter((n) => inRow(n.y, 120) && beyond(n.x, n.width));
    const groups = page.groups.filter((g) => inRow(g.y, g.height));
    const moved = groups.filter((g) => beyond(g.x, g.width));
    // Groupe qui contient l'écran (il s'étend des deux côtés du milieu) : il s'élargit.
    const around = groups.filter((g) => !beyond(g.x, g.width) && g.x < pivot && g.x + g.width > pivot);

    const gap = Math.min(...screens.map((st) => distance(st.q.x, device.width)), ...notes.map((n) => distance(n.x, n.width)), ...moved.map((g) => distance(g.x, g.width)));
    const shift = room - gap;
    const out = none;
    const signed = side === 'right' ? shift : -shift;
    if (shift > 0) {
      for (const st of screens) out.stories[st.id] = signed;
      for (const n of notes) out.notes[n.id] = signed;
      for (const g of moved) out.groups[g.id] = { dx: signed, dw: 0 };
    }
    for (const g of around) {
      // Assez large pour garder la palette dedans, et suivre ce qui a glissé.
      const margin = side === 'right' ? g.x + g.width - (p.x + device.width) : p.x - g.x;
      const grow = Math.max(shift > 0 ? shift : 0, room - margin, 0);
      if (grow > 0) out.groups[g.id] = { dx: side === 'right' ? 0 : -grow, dw: grow };
    }
    return out;
  }, [isolate, positionOf, stories, view, device, page.notes, page.groups]);

  // Groupe d'un écran : le plus petit cadre qui contient son centre.
  const groupOfPoint = useCallback(
    (point: Point) => page.groups.filter((g) => inside(point, g)).sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null,
    [page.groups],
  );
  const groupOf = useCallback(
    (id: string) => {
      const p = positionOf(id);
      return p ? (groupOfPoint({ x: p.x + device.width / 2, y: p.y + (device.height + LABEL) / 2 })?.id ?? null) : null;
    },
    [positionOf, groupOfPoint, device],
  );

  // Élément en cours de déplacement (écran par son nom, groupe par son titre, note).
  const moving = useRef<Drag | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const justMoved = useRef(false);

  const [hovered, setHovered] = useState<string | null>(null);
  const flowLayout = useMemo(() => {
    if (!flows) return null;
    return layoutFlows(flows, (id) => {
      const p = positionOf(id);
      return p ? { x: p.x, y: p.y + LABEL, width: device.width, height: device.height } : null;
    });
  }, [flows, positionOf, device]);
  const flowView = useMemo(
    () => flowLayout && viewFlows(flowLayout, page.groups.length ? flowMode : 'all', groupOf, (id) => page.groups.find((g) => g.id === id) ?? null),
    [flowLayout, flowMode, groupOf, page.groups],
  );

  // Vue sans aucun écran (vue mémorisée ailleurs, écrans déplacés loin) : on le dit, avec de quoi revenir.
  const emptyView = useMemo(() => {
    const { width, height } = viewportSize;
    if (!width || stories.length === 0) return false;
    const left = -view.x / view.zoom;
    const top = -view.y / view.zoom;
    const right = (width - view.x) / view.zoom;
    const bottom = (height - view.y) / view.zoom;
    return !stories.some((s) => {
      const p = positionOf(s.id);
      return p && p.x < right && p.x + device.width > left && p.y < bottom && p.y + device.height + LABEL > top;
    });
  }, [stories, positionOf, view, viewportSize, device]);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el || bounds.width === 0) return;
    const { width, height } = el.getBoundingClientRect();
    const zoom = Math.min(1, (width - PADDING * 2) / bounds.width, (height - PADDING * 2) / bounds.height);
    setView({ zoom, x: (width - bounds.width * zoom) / 2 - bounds.x * zoom, y: Math.max(PADDING / 2, (height - bounds.height * zoom) / 2) - bounds.y * zoom });
  }, [bounds]);

  // Retour à la grille d'origine, puis cadrage sur l'ensemble.
  const [regridded, setRegridded] = useState(0);
  const resetPositions = () => {
    setPositions(() => ({}));
    setRegridded((n) => n + 1);
  };
  useEffect(() => {
    if (regridded) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regridded]);

  const capture = (e: React.PointerEvent, drag: Drag) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    moving.current = drag;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const startMove = (e: React.PointerEvent, id: string) => {
    const from = positionOf(id);
    // Écran de la sélection : toute la sélection suit.
    const others = selected.has(id) ? [...selected].filter((o) => o !== id).map((o) => [o, positionOf(o)] as [string, Point | null]).filter((o): o is [string, Point] => o[1] !== null) : [];
    if (from) capture(e, { kind: 'story', id, startX: e.clientX, startY: e.clientY, from, moved: false, others });
  };
  // Un groupe emporte les écrans, notes et groupes dont le centre est dedans.
  const startGroupMove = (e: React.PointerEvent, group: BoardGroup) => {
    if ((e.target as HTMLElement).closest('input, button')) return;
    const center = (p: Point, w: number, h: number) => ({ x: p.x + w / 2, y: p.y + h / 2 });
    const storiesIn = stories
      .map((s) => [s.id, positionOf(s.id)] as const)
      .filter((entry): entry is readonly [string, Point] => entry[1] !== null && inside(center(entry[1], device.width, device.height + LABEL), group))
      .map(([id, p]) => [id, p] as [string, Point]);
    const notesIn = page.notes.filter((n) => inside(center(n, n.width, 60), group)).map((n) => [n.id, { x: n.x, y: n.y }] as [string, Point]);
    const groupsIn = page.groups
      .filter((g) => g.id !== group.id && g.width * g.height < group.width * group.height && inside(center(g, g.width, g.height), group))
      .map((g) => [g.id, { x: g.x, y: g.y }] as [string, Point]);
    capture(e, { kind: 'group', id: group.id, startX: e.clientX, startY: e.clientY, from: { x: group.x, y: group.y }, moved: false, stories: storiesIn, notes: notesIn, groups: groupsIn });
  };
  const continueMove = (e: React.PointerEvent) => {
    const m = moving.current;
    if (!m) return;
    const dx = (e.clientX - m.startX) / view.zoom;
    const dy = (e.clientY - m.startY) / view.zoom;
    if (!m.moved && Math.hypot(dx, dy) * view.zoom < 4) return;
    if (!m.moved) {
      m.moved = true;
      setMovingId(m.id);
      if (m.kind === 'story' || m.kind === 'group') pinGrid();
    }
    const snap = (v: number) => (e.altKey ? v : Math.round(v / SNAP) * SNAP);
    // Le déplacement aimanté de l'élément tiré s'applique tel quel à son contenu.
    const ox = snap(m.from.x + dx) - m.from.x;
    const oy = snap(m.from.y + dy) - m.from.y;
    if (m.kind === 'story') setPositions((p) => ({ ...p, [m.id]: { x: m.from.x + ox, y: m.from.y + oy }, ...Object.fromEntries(m.others.map(([id, q]) => [id, { x: q.x + ox, y: q.y + oy }])) }));
    else if (m.kind === 'note') setNotes((ns) => ns.map((n) => (n.id === m.id ? { ...n, x: m.from.x + ox, y: m.from.y + oy } : n)));
    else if (m.kind === 'resize') {
      if (m.note) setNotes((ns) => ns.map((n) => (n.id === m.id ? { ...n, width: Math.max(120, m.from.x + ox) } : n)));
      else setGroups((gs) => gs.map((g) => (g.id === m.id ? { ...g, width: Math.max(200, m.from.x + ox), height: Math.max(120, m.from.y + oy) } : g)));
    } else {
      const moved = new Map([[m.id, m.from], ...m.groups]);
      onChangePage((pg) => ({
        ...pg,
        positions: { ...pg.positions, ...Object.fromEntries(m.stories.map(([id, p]) => [id, { x: p.x + ox, y: p.y + oy }])) },
        notes: pg.notes.map((n) => {
          const from = m.notes.find(([id]) => id === n.id)?.[1];
          return from ? { ...n, x: from.x + ox, y: from.y + oy } : n;
        }),
        groups: pg.groups.map((g) => {
          const from = moved.get(g.id);
          return from ? { ...g, x: from.x + ox, y: from.y + oy } : g;
        }),
      }));
    }
  };
  const endMove = () => {
    justMoved.current = Boolean(moving.current?.moved);
    moving.current = null;
    setMovingId(null);
  };

  // Première ouverture : cadrage sur la première rangée d'écrans (lisible) ; ensuite, la vue mémorisée.
  const fitFirstRow = useCallback(() => {
    const el = viewport.current;
    if (!el || stories.length === 0) return;
    // Parcours : on cadre l'ensemble (il est rarement plus large qu'une rangée).
    if (page.stories !== null) return fit();
    const { width, height } = el.getBoundingClientRect();
    const rowWidth = columns * cellWidth - GAP;
    const zoom = Math.min(1, (width - PADDING * 2) / rowWidth, (height - PADDING * 2) / (device.height + LABEL));
    setView({ zoom, x: (width - rowWidth * zoom) / 2, y: PADDING / 2 });
  }, [stories.length, columns, cellWidth, device.height, page.stories, fit]);

  // Changement de page : on retrouve sa vue, ou on la cadre à sa première ouverture.
  useLayoutEffect(() => {
    if (viewPage.current === page.id) return;
    writeView(viewPage.current, view);
    viewPage.current = page.id;
    const saved = readView(page.id);
    autoFitted.current = saved !== null;
    if (saved) setView(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  useLayoutEffect(() => {
    if (autoFitted.current || stories.length === 0) return;
    autoFitted.current = true;
    fitFirstRow();
  }, [fitFirstRow, stories.length, page.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => writeView(viewPage.current, view), 300);
    return () => window.clearTimeout(timer);
  }, [view]);

  // Nouveau groupe autour de l'écran actif (s'il est sur la page), sinon au centre de la vue.
  const viewCenter = () => {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: (rect.width / 2 - view.x) / view.zoom, y: (rect.height / 2 - view.y) / view.zoom };
  };
  const addGroup = () => {
    const active = activeStory ? positionOf(activeStory) : null;
    const c = viewCenter();
    const box = active
      ? { x: active.x - 60, y: active.y - 100, width: device.width + 120, height: device.height + LABEL + 160 }
      : { x: Math.round(c.x - cellWidth), y: Math.round(c.y - cellHeight / 2), width: cellWidth * 2, height: cellHeight + 60 };
    const group: BoardGroup = { id: newId(), name: 'Nouveau groupe', color: GROUP_COLORS[page.groups.length % GROUP_COLORS.length], ...box };
    setGroups((gs) => [...gs, group]);
    setEditing(group.id);
  };
  const addNote = () => {
    const c = viewCenter();
    const note: BoardNote = { id: newId(), text: '', x: Math.round(c.x - 140), y: Math.round(c.y - 40), width: 280, color: 'yellow' };
    setNotes((ns) => [...ns, note]);
    setEditing(note.id);
  };
  const membersOf = (group: BoardGroup) =>
    stories.filter((s) => {
      const p = positionOf(s.id);
      return p && groupOfPoint({ x: p.x + device.width / 2, y: p.y + (device.height + LABEL) / 2 })?.id === group.id;
    });

  // Cadre un écran : centré, à une taille où il est lisible en entier.
  const frameStory = useCallback(
    (id: string): boolean => {
      const el = viewport.current;
      const p = positionOf(id);
      if (!el || !p) return false;
      const { width, height } = el.getBoundingClientRect();
      const zoom = Math.min(1, (height - PADDING) / (device.height + LABEL));
      setView({ zoom, x: width / 2 - (p.x + device.width / 2) * zoom, y: PADDING / 2 - p.y * zoom });
      return true;
    },
    [positionOf, device],
  );

  // Écran créé : posé à l'emplacement choisi dès qu'il est dans la page, puis cadré.
  const placed = useRef(0);
  useEffect(() => {
    const el = viewport.current;
    if (!place || place.seq === placed.current || !el) return;
    if (page.stories && !page.stories.includes(place.id)) {
      onChangePage((pg) => (pg.stories && !pg.stories.includes(place.id) ? { ...pg, stories: [...pg.stories, place.id] } : pg));
      return;
    }
    if (!visible.has(place.id)) return;
    placed.current = place.seq;
    const { width, height } = el.getBoundingClientRect();
    const snap = (v: number) => Math.round(v / SNAP) * SNAP;
    const anchor = place.mode === 'beside' && place.anchor ? positionOf(place.anchor) : null;
    const taken = stories.filter((s) => s.id !== place.id).map((s) => positionOf(s.id)).filter((q): q is Point => q !== null);
    const free = (q: Point) => !taken.some((t) => Math.abs(t.x - q.x) < device.width + GAP / 2 && Math.abs(t.y - q.y) < device.height + LABEL);
    let p: Point = anchor ? { x: anchor.x + cellWidth, y: anchor.y } : { x: snap((width / 2 - view.x) / view.zoom - device.width / 2), y: snap((height / 2 - view.y) / view.zoom - (device.height + LABEL) / 2) };
    for (let i = 0; i < 40 && !free(p); i++) p = { x: p.x + cellWidth, y: p.y };
    pinGrid();
    setPositions((ps) => ({ ...ps, [place.id]: p }));
    const zoom = Math.min(1, (height - PADDING) / (device.height + LABEL));
    setView({ zoom, x: width / 2 - (p.x + device.width / 2) * zoom, y: PADDING / 2 - p.y * zoom });
    onActivate(place.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, visible, page.stories]);

  // Dès que l'écran demandé est dans la grille (manifeste rechargé), la vue le cadre.
  const revealed = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.seq === revealed.current) return;
    if (frameStory(reveal.id)) revealed.current = reveal.seq;
  }, [reveal, frameStory]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const zoom = Math.min(3, Math.max(0.1, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Un cran de molette (≈ 100) ne doit pas tripler le zoom : pas limité à ±25 %.
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-Math.max(-25, Math.min(25, e.deltaY)) * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Raccourcis : ⌘/Ctrl + / - pour zoomer, ⌘/Ctrl 0 ou Maj 1 pour tout afficher, Maj 0 pour 100 %.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const el = viewport.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      const combo = e.metaKey || e.ctrlKey;
      if (combo && (e.key === '=' || e.key === '+')) zoomAt(1.2, width / 2, height / 2);
      else if (combo && e.key === '-') zoomAt(1 / 1.2, width / 2, height / 2);
      else if ((combo && e.key === '0') || (e.shiftKey && !combo && (e.key === '!' || e.code === 'Digit1'))) fit();
      else if (e.shiftKey && !combo && e.code === 'Digit0') zoomAt(1 / view.zoom, width / 2, height / 2);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomAt, fit, view.zoom]);

  // Main : glisser n'importe où sur le canevas (écrans compris) déplace la vue ; les barres posées
  // dessus (pages, zoom, minicarte…) restent cliquables.
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (!hand || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && !target.closest('.world')) return;
    e.stopPropagation();
    e.preventDefault();
    swallowClick.current = false;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (e.target !== e.currentTarget && !target.classList.contains('world') && !target.classList.contains('board-group')) return;
    if (editing && !target.closest('.note, .board-group-head')) setEditing(null);
    if (!hand) {
      const rect = viewport.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Maj : ajoute à la sélection en cours ; sinon, elle repart de zéro.
      setLasso({ x0: x, y0: y, x1: x, y1: y, base: e.shiftKey ? selected : new Set() });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (lasso) {
      const rect = viewport.current!.getBoundingClientRect();
      const x1 = e.clientX - rect.left;
      const y1 = e.clientY - rect.top;
      // Écrans touchés par le rectangle, ajoutés à la sélection de départ.
      const left = (Math.min(lasso.x0, x1) - view.x) / view.zoom;
      const right = (Math.max(lasso.x0, x1) - view.x) / view.zoom;
      const top = (Math.min(lasso.y0, y1) - view.y) / view.zoom;
      const bottom = (Math.max(lasso.y0, y1) - view.y) / view.zoom;
      const hit = stories.filter((s) => {
        const p = positionOf(s.id);
        return p && p.x < right && p.x + device.width > left && p.y < bottom && p.y + device.height + LABEL > top;
      });
      setLasso({ ...lasso, x1, y1 });
      setSelected(new Set([...lasso.base, ...hit.map((s) => s.id)]));
      return;
    }
    const d = drag.current;
    if (d) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) swallowClick.current = true;
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (lasso) {
      setLasso(null);
      // Un clic (pas un rectangle) dans le vide : désélection.
      if (Math.hypot(lasso.x1 - lasso.x0, lasso.y1 - lasso.y0) < 4) {
        if (!e.shiftKey) setSelected(new Set());
        onBackgroundClick?.();
      }
      return;
    }
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    // Un clic (sans déplacement) dans le vide, pas un glissement du canevas : désélection.
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) {
      setSelected(new Set());
      onBackgroundClick?.();
    }
  };

  // Échap : la sélection multiple d'abord.
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      e.stopPropagation();
      setSelected(new Set());
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected.size]);

  // Actions de la sélection.
  const selectedStories = stories.filter((s) => selected.has(s.id));
  const groupSelection = () => {
    const boxes = selectedStories.map((s) => positionOf(s.id)).filter((p): p is Point => p !== null);
    if (!boxes.length) return;
    const x = Math.min(...boxes.map((b) => b.x)) - 60;
    const y = Math.min(...boxes.map((b) => b.y)) - 100;
    const group: BoardGroup = {
      id: newId(),
      name: 'Nouveau groupe',
      color: GROUP_COLORS[page.groups.length % GROUP_COLORS.length],
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x)) + device.width + 60 - x,
      height: Math.max(...boxes.map((b) => b.y)) + device.height + LABEL + 60 - y,
    };
    pinGrid();
    setGroups((gs) => [...gs, group]);
    setEditing(group.id);
    setSelected(new Set());
  };

  const center = () => {
    const rect = viewport.current!.getBoundingClientRect();
    return [rect.width / 2, rect.height / 2] as const;
  };

  // Créer, Groupe, Note : dans la barre du haut de l'éditeur (portail), sinon sur le canevas.
  const [boardSlot, setBoardSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setBoardSlot(document.getElementById(TOPBAR_BOARD_SLOT)), []);
  const boardTools = (
    <div className="board-tools" hidden={!showBoardTools} onPointerDown={(e) => e.stopPropagation()}>
      {onCreate && (
        <button className="create" onClick={onCreate} title="Créer un composant ou un écran (les vrais fichiers, aux conventions du projet)">
          ＋ Créer
        </button>
      )}
      <button onClick={addGroup} title="Groupe : cadre de couleur pour ranger des écrans (autour de l'écran actif s'il y en a un)" aria-label="Groupe">
        ▢
      </button>
      <button onClick={addNote} title="Note : bloc de texte libre" aria-label="Note">
        ✎
      </button>
    </div>
  );

  return (
    <main
      className={`canvas ${hand ? 'tool-hand' : 'tool-select'} ${panning || movingId ? 'panning' : ''}`}
      ref={viewport}
      onPointerDownCapture={onPointerDownCapture}
      onClickCapture={(e) => {
        // Main : un clic sur un écran ne le sélectionne pas ; un glissement non plus.
        if (hand && (e.target as HTMLElement).closest('.world')) e.stopPropagation();
        swallowClick.current = false;
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // Le canevas ne défile jamais (la vue se déplace par transform) : un focus ou un scrollIntoView
      // le décalerait, barres flottantes comprises.
      onScroll={(e) => {
        e.currentTarget.scrollLeft = 0;
        e.currentTarget.scrollTop = 0;
      }}
    >
      {!empty && page.stories !== null && stories.length === 0 && (
        <div className="canvas-hint">Parcours vide : cochez des écrans dans la liste de gauche pour les y ajouter.</div>
      )}
      {empty && (
        <div className="canvas-empty">
          <h2>Aucun écran pour l'instant</h2>
          <p>
            Créez un fichier <code>MonEcran.canvas.tsx</code> à côté d'un écran :
          </p>
          <pre>{`export default { title: 'Mon écran', component: MonEcran };
export const Default = { props: {} };`}</pre>
        </div>
      )}
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {page.groups.map((group) => (
          <GroupFrame
            key={group.id}
            group={group}
            shift={shifts.groups[group.id]}
            zoom={view.zoom}
            editing={editing === group.id}
            leaving={flowView?.leaving.get(group.id) ?? []}
            nameOf={(id) => page.groups.find((g) => g.id === id)?.name ?? 'hors groupe'}
            onEdit={(on) => setEditing(on ? group.id : null)}
            onChange={(patch) => setGroups((gs) => gs.map((g) => (g.id === group.id ? { ...g, ...patch } : g)))}
            onRemove={() => setGroups((gs) => gs.filter((g) => g.id !== group.id))}
            onParcours={() => onCreateParcours(group.name, membersOf(group).map((s) => s.id))}
            members={membersOf(group).length}
            onPointerDown={(e) => startGroupMove(e, group)}
            onResizeDown={(e) => capture(e, { kind: 'resize', id: group.id, startX: e.clientX, startY: e.clientY, from: { x: group.width, y: group.height }, moved: false, note: false })}
            onPointerMove={continueMove}
            onPointerUp={endMove}
          />
        ))}
        {allStories.map((story) => {
          const p = positionOf(story.id);
          return (
            <section
              key={story.id}
              className={`artboard ${activeStory === story.id ? 'active' : ''} ${selected.has(story.id) ? 'selected' : ''} ${movingId === story.id || (movingId !== null && selected.has(movingId) && selected.has(story.id)) ? 'moving' : ''}`}
              style={p === null ? { display: 'none', width: device.width } : { left: p.x, top: p.y, width: device.width, transform: shifts.stories[story.id] ? `translateX(${shifts.stories[story.id]}px)` : undefined }}
              onMouseEnter={() => setHovered(story.id)}
              onMouseLeave={() => setHovered((h) => (h === story.id ? null : h))}
            >
              <button
                className={`artboard-label ${showLabels ? '' : 'hidden-label'}`}
                onPointerDown={(e) => startMove(e, story.id)}
                onPointerMove={continueMove}
                onPointerUp={endMove}
                onPointerCancel={endMove}
                onClick={(e) => {
                  if (justMoved.current) justMoved.current = false;
                  else if (e.shiftKey) toggleSelected(story.id);
                  else {
                    if (!selected.has(story.id)) setSelected(new Set());
                    onActivate(story.id);
                  }
                }}
                title={`${story.id}\nGlisser pour déplacer l'écran (Alt : sans aimantation) · Maj+clic : sélection multiple`}
              >
                {story.file.split('/').pop()!.replace(/\.canvas\.\w+$/, '')} · {story.title}
                <LoadTime live={liveTimes[story.id]} capture={snapshots?.items[story.id]?.ms} />
              </button>
              <div className="frame" style={{ width: device.width, height: device.height }}>
                {snapshots && <SnapshotFrame story={story} info={snapshots.items[story.id]} url={snapshots.url} running={snapshots.running.includes(story.id)} live={live.has(story.id)} shown={Boolean(loaded[story.id])} liveError={Boolean(errors[story.id])}
                    onActivate={(e) => {
                      if (justMoved.current) justMoved.current = false;
                      else if (e.shiftKey) toggleSelected(story.id);
                      else {
                        if (!selected.has(story.id)) setSelected(new Set());
                        onActivate(story.id);
                      }
                    }}
                    drag={{ onPointerDown: (e) => startMove(e, story.id), onPointerMove: continueMove, onPointerUp: endMove, onPointerCancel: endMove }}
                  />}
                {story.id in admitted && (
                  <iframe
                    title={story.id}
                    className={snapshots && !loaded[story.id] ? 'frame-live-pending' : undefined}
                    src={storyUrl(appUrl, story, isolateStories, generations[story.id])}
                    width={device.width}
                    height={device.height}
                    ref={(el) => {
                      if (el) frames.set(story.id, el);
                      else frames.delete(story.id);
                    }}
                  />
                )}
                {snapshots ? null : !live.has(story.id) ? (
                  <div className="frame-loading frame-asleep">Hors de la vue · chargé en s'en approchant</div>
                ) : (
                  !loaded[story.id] && (
                    <div className="frame-loading" role="status">
                      <span className="spinner" />
                      {story.id in admitted ? "Chargement de l'écran…" : 'En attente…'}
                    </div>
                  )
                )}
                {loaded[story.id] === 'empty' && !errors[story.id] && (
                  <div className="frame-empty">Rien d'affiché : données vides ou redirection ? Ouvrez-le en mode Interaction.</div>
                )}
                {errors[story.id] && <div className="frame-error">{errors[story.id]}</div>}
                {blocked[story.id] && (
                  <span
                    className="frame-network"
                    title={`Réseau coupé dans le canevas : ${blocked[story.id].hosts.join(', ')}.\nPour l'autoriser : network: 'allow' dans rn-canvas.config.tsx.`}
                  >
                    ⦸ {blocked[story.id].count} appel{blocked[story.id].count > 1 ? 's' : ''} bloqué{blocked[story.id].count > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </section>
          );
        })}
        {page.notes.map((note) => (
          <Note
            key={note.id}
            note={note}
            shift={shifts.notes[note.id] ?? 0}
            editing={editing === note.id}
            moving={movingId === note.id}
            onEdit={(on) => setEditing(on ? note.id : null)}
            onChange={(patch) => setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, ...patch } : n)))}
            onRemove={() => setNotes((ns) => ns.filter((n) => n.id !== note.id))}
            onPointerDown={(e) => !(e.target as HTMLElement).closest('textarea, button') && capture(e, { kind: 'note', id: note.id, startX: e.clientX, startY: e.clientY, from: { x: note.x, y: note.y }, moved: false })}
            onResizeDown={(e) => capture(e, { kind: 'resize', id: note.id, startX: e.clientX, startY: e.clientY, from: { x: note.width, y: 0 }, moved: false, note: true })}
            onPointerMove={continueMove}
            onPointerUp={endMove}
          />
        ))}
        {flowView && <FlowLayer layout={flowView} groupFlows={flowView.groupFlows} width={bounds.x + bounds.width} height={bounds.y + bounds.height} zoom={view.zoom} focus={hovered} />}
      </div>
      {snapshots && snapshots.queued > 0 && (
        <div className="canvas-progress" role="status">
          <span className="spinner" />
          Captures des écrans · {stories.filter((s) => snapshots.items[s.id]?.version && snapshots.items[s.id].state !== 'stale').length}/{stories.length}
          {snapshots.running.length > 0 && <span className="muted"> · en cours : {snapshots.running.map((id) => id.split('/').pop()!.replace(/\.canvas\.\w+#.*$/, '')).join(', ')}</span>}
        </div>
      )}
      {!snapshots && pending > 0 && (
        <div className="canvas-progress" role="status">
          <span className="spinner" />
          Chargement des écrans{loadAll ? '' : ' de la vue'} · {live.size - pending}/{live.size}
        </div>
      )}
      {flowLayout && flowView && <FlowLegend layout={flowLayout} view={flowView} mode={page.groups.length ? flowMode : 'all'} onMode={onFlowMode} hasGroups={page.groups.length > 0} parcours={page.stories !== null} />}
      {children}
      {boardSlot && createPortal(boardTools, boardSlot)}
      {lasso && (
        <div
          className="canvas-lasso"
          style={{ left: Math.min(lasso.x0, lasso.x1), top: Math.min(lasso.y0, lasso.y1), width: Math.abs(lasso.x1 - lasso.x0), height: Math.abs(lasso.y1 - lasso.y0) }}
        />
      )}
      {selected.size > 0 && !lasso && (
        <div className="selection-bar" onPointerDown={(e) => e.stopPropagation()}>
          <span>
            {selected.size} écran{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <button onClick={groupSelection} title="Cadre de couleur autour de ces écrans">
            ▢ Grouper
          </button>
          <button
            onClick={() => {
              const name = window.prompt('Nom du parcours', 'Nouveau parcours')?.trim();
              if (!name) return;
              onCreateParcours(name, selectedStories.map((s) => s.id));
              setSelected(new Set());
            }}
            title="Nouvelle page avec ces écrans"
          >
            ⇢ Parcours
          </button>
          {onHideStories && (
            <button
              onClick={() => {
                onHideStories([...selected]);
                setSelected(new Set());
              }}
              title={page.stories ? 'Retirer ces écrans du parcours' : 'Décocher ces écrans (ils restent dans la liste de gauche)'}
            >
              {page.stories ? '− Retirer du parcours' : '◌ Masquer'}
            </button>
          )}
          <button className="selection-clear" onClick={() => setSelected(new Set())} title="Désélectionner (Échap)" aria-label="Désélectionner">
            ×
          </button>
        </div>
      )}
      {emptyView && (
        <button className="canvas-empty-view" onClick={fit} onPointerDown={(e) => e.stopPropagation()}>
          Aucun écran dans la vue · <strong>Tout afficher</strong>
        </button>
      )}
      {showMinimap && minimapOpen && stories.length > 0 && viewportSize.width > 0 && (
        <Minimap
          boxes={stories.map((s) => ({ id: s.id, p: positionOf(s.id) })).filter((b): b is { id: string; p: Point } => b.p !== null)}
          groups={page.groups}
          bounds={bounds}
          device={device}
          view={view}
          viewportSize={viewportSize}
          activeStory={activeStory}
          live={live}
          selected={selected}
          onCenter={(x, y) => setView((v) => ({ ...v, x: viewportSize.width / 2 - x * v.zoom, y: viewportSize.height / 2 - y * v.zoom }))}
        />
      )}
      {/* Une seule barre en haut : rien ne se chevauche, même avec les deux panneaux ouverts. */}
      <div className="canvas-top">
        {top}
        <span className="canvas-top-spacer" />
        {!boardSlot && boardTools}
        <div className="zoom-controls">
          <button className={minimapOpen ? 'on' : ''} onClick={() => setMinimapOpen(!minimapOpen)} disabled={!showMinimap} title="Minicarte" aria-label="Afficher la minicarte" aria-pressed={minimapOpen}>
            ▣
          </button>
          <button onClick={() => zoomAt(1 / 1.2, ...center())} aria-label="Dézoomer">−</button>
          <button onClick={fit} title="Tout afficher">{Math.round(view.zoom * 100)} %</button>
          <button onClick={() => zoomAt(1.2, ...center())} aria-label="Zoomer">+</button>
          <button onClick={resetPositions} disabled={Object.keys(positions).length === 0} title="Remettre les écrans dans la grille d'origine" aria-label="Repositionner les écrans">
            ⊞
          </button>
        </div>
      </div>
    </main>
  );
}

/** Comme autoFocus, sans faire défiler le canevas jusqu'au champ (un groupe ou une note hors de la vue). */
const focusWithoutScroll = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
  el?.focus({ preventScroll: true });
};

const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 140;

/**
 * Minicarte : tous les écrans (et groupes) de la page, et le cadre de la vue. Cliquer ou glisser
 * dedans déplace la vue à cet endroit, au même zoom.
 */
function Minimap({ boxes, groups, bounds, device, view, viewportSize, activeStory, live, selected, onCenter }: {
  boxes: { id: string; p: Point }[];
  groups: BoardGroup[];
  bounds: { x: number; y: number; width: number; height: number };
  device: Device;
  view: View;
  viewportSize: { width: number; height: number };
  activeStory: string | null;
  live: Set<string>;
  selected: Set<string>;
  onCenter: (x: number, y: number) => void;
}) {
  // Partie visible du canevas, en coordonnées du monde ; la carte englobe le contenu et la vue.
  const seen = { x: -view.x / view.zoom, y: -view.y / view.zoom, width: viewportSize.width / view.zoom, height: viewportSize.height / view.zoom };
  const left = Math.min(bounds.x, seen.x);
  const top = Math.min(bounds.y, seen.y);
  const width = Math.max(bounds.x + bounds.width, seen.x + seen.width) - left;
  const height = Math.max(bounds.y + bounds.height, seen.y + seen.height) - top;
  const scale = Math.min(MINIMAP_WIDTH / width, MINIMAP_HEIGHT / height);
  const ox = (MINIMAP_WIDTH - width * scale) / 2;
  const oy = (MINIMAP_HEIGHT - height * scale) / 2;
  const at = (x: number, y: number) => ({ x: ox + (x - left) * scale, y: oy + (y - top) * scale });
  const dragging = useRef(false);
  const toWorld = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onCenter((e.clientX - rect.left - ox) / scale + left, (e.clientY - rect.top - oy) / scale + top);
  };
  const v = at(seen.x, seen.y);
  return (
    <div className="minimap" onPointerDown={(e) => e.stopPropagation()} title="Cliquer ou glisser pour se déplacer">
      <svg
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          toWorld(e);
        }}
        onPointerMove={(e) => dragging.current && toWorld(e)}
        onPointerUp={() => {
          dragging.current = false;
        }}
      >
        {groups.map((g) => {
          const a = at(g.x, g.y);
          return <rect key={g.id} className="minimap-group" data-color={g.color} x={a.x} y={a.y} width={g.width * scale} height={g.height * scale} rx={2} />;
        })}
        {boxes.map(({ id, p }) => {
          const a = at(p.x, p.y + LABEL);
          return (
            <rect
              key={id}
              className={`minimap-story ${id === activeStory || selected.has(id) ? 'active' : live.has(id) ? 'live' : ''}`}
              x={a.x}
              y={a.y}
              width={Math.max(1.5, device.width * scale)}
              height={Math.max(2, device.height * scale)}
              rx={1}
            />
          );
        })}
        <rect className="minimap-view" x={v.x} y={v.y} width={seen.width * scale} height={seen.height * scale} rx={2} />
      </svg>
    </div>
  );
}

/**
 * Image d'un écran (moteur de captures). Un clic le sélectionne : il passe en direct, son image reste
 * dessous jusqu'à ce que l'app y ait affiché quelque chose.
 */
function SnapshotFrame({ story, info, url, running, live, shown, liveError, onActivate, drag }: { story: StoryEntry; info: SnapshotInfo | undefined; url: SnapshotView['url']; running: boolean; live: boolean; shown: boolean; liveError: boolean; onActivate: (e: React.MouseEvent) => void; drag: Pick<React.HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'> }) {
  const status = live ? (shown ? 'En direct' : 'Démarrage…') : running ? 'Capture…' : info?.state === 'stale' ? 'Mise à jour…' : null;
  return (
    <>
      {info?.version ? (
        <img className="frame-snapshot" src={url(story.id, info.version)} alt={story.title} draggable={false} onClick={onActivate} {...drag} title="Cliquer pour l'ouvrir en direct (inspecter, modifier) · glisser pour le déplacer" />
      ) : (
        <button className="frame-loading frame-snapshot-pending" onClick={onActivate}>
          {running ? <span className="spinner" /> : null}
          {running ? 'Capture en cours…' : 'Capture en attente · cliquer pour l’ouvrir en direct'}
        </button>
      )}
      {status && <span className={`frame-badge ${live && shown ? 'is-live' : ''}`}>{status}</span>}
      {/* L'erreur de l'écran en direct (s'il y en a une) passe devant celle de la capture : une seule à la fois. */}
      {!live && !liveError && (info?.state === 'error' || info?.state === 'loop') && info.message && (
        <div className="frame-error frame-snapshot-error" onClick={onActivate}>
          {info.state === 'loop' ? '⟳ ' : ''}
          {info.message}
        </div>
      )}
    </>
  );
}

interface GroupProps {
  group: BoardGroup;
  /** Décalage et élargissement temporaires (palette ouverte à côté d'un écran de la rangée). */
  shift?: { dx: number; dw: number };
  zoom: number;
  editing: boolean;
  members: number;
  /** Liens qui sortent du groupe (mode Flux « Dans les groupes »). */
  leaving: { to: string | null; count: number }[];
  nameOf: (group: string) => string;
  onEdit: (on: boolean) => void;
  onChange: (patch: Partial<BoardGroup>) => void;
  onRemove: () => void;
  onParcours: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}

/** Cadre de couleur : son titre se glisse (avec le contenu), son coin se tire pour le redimensionner. */
function GroupFrame({ group, shift, zoom, editing, members, leaving, nameOf, onEdit, onChange, onRemove, onParcours, onPointerDown, onResizeDown, onPointerMove, onPointerUp }: GroupProps) {
  // Titre lisible quel que soit le zoom.
  const scale = Math.min(4, 1 / zoom);
  const nextColor = GROUP_COLORS[(GROUP_COLORS.indexOf(group.color) + 1) % GROUP_COLORS.length];
  return (
    <div
      className="board-group"
      data-color={group.color}
      style={{ left: group.x, top: group.y, width: group.width + (shift?.dw ?? 0), height: group.height, transform: shift?.dx ? `translateX(${shift.dx}px)` : undefined }}
    >
      <div
        className="board-group-head"
        style={{ transform: `scale(${scale})`, maxWidth: group.width / scale }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onEdit(true)}
        title="Glisser pour déplacer le groupe et son contenu · double-clic pour renommer"
      >
        {editing ? (
          <input
            ref={focusWithoutScroll}
            defaultValue={group.name}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              onChange({ name: e.target.value.trim() || 'Groupe' });
              onEdit(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <span className="board-group-name">{group.name}</span>
        )}
        <span className="muted">{members} écran{members > 1 ? 's' : ''}</span>
        {leaving.map((l) => (
          <span key={l.to ?? '-'} className="board-group-exit" title={`${l.count} lien(s) vers ${nameOf(l.to ?? '')}`}>
            → {l.to ? nameOf(l.to) : 'hors groupe'} · {l.count}
          </span>
        ))}
        <button className="board-color" data-color={nextColor} onClick={() => onChange({ color: nextColor })} title="Changer la couleur" aria-label="Changer la couleur" />
        <button onClick={onParcours} disabled={members === 0} title="Créer un parcours (nouvelle page) avec les écrans de ce groupe">
          ⇢ Parcours
        </button>
        <button className="board-ungroup" onClick={onRemove} title="Dégrouper : supprime le cadre du groupe, les écrans et notes restent en place" aria-label="Dégrouper">
          Dégrouper
        </button>
      </div>
      <div className="board-resize" style={{ transform: `scale(${scale})` }} onPointerDown={onResizeDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} title="Redimensionner" />
    </div>
  );
}

interface NoteProps {
  note: BoardNote;
  /** Décalage horizontal temporaire (palette ouverte à côté d'un écran de la rangée). */
  shift: number;
  editing: boolean;
  moving: boolean;
  onEdit: (on: boolean) => void;
  onChange: (patch: Partial<BoardNote>) => void;
  onRemove: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}

/** Note de texte libre : glisser pour la déplacer, double-clic pour l'écrire. */
function Note({ note, shift, editing, moving, onEdit, onChange, onRemove, onPointerDown, onResizeDown, onPointerMove, onPointerUp }: NoteProps) {
  const nextColor = NOTE_COLORS[(NOTE_COLORS.indexOf(note.color) + 1) % NOTE_COLORS.length];
  return (
    <div
      className={`note ${moving ? 'moving' : ''}`}
      data-color={note.color}
      style={{ left: note.x, top: note.y, width: note.width, transform: shift ? `translateX(${shift}px)` : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onEdit(true)}
      title={editing ? undefined : 'Glisser pour déplacer · double-clic pour écrire'}
    >
      {editing ? (
        <textarea
          ref={focusWithoutScroll}
          defaultValue={note.text}
          placeholder="Écrivez une note…"
          rows={Math.max(3, note.text.split('\n').length + 1)}
          onBlur={(e) => {
            const text = e.target.value;
            // Note laissée vide à sa création : on ne la garde pas.
            if (!text.trim() && !note.text) onRemove();
            else onChange({ text });
            onEdit(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          }}
        />
      ) : (
        <div className="note-text">{note.text || <span className="muted">Note vide</span>}</div>
      )}
      <div className="note-actions">
        <button className="board-color" data-color={nextColor} onClick={() => onChange({ color: nextColor })} title="Changer la couleur" aria-label="Changer la couleur" />
        <button onClick={onRemove} title="Supprimer la note" aria-label="Supprimer la note">
          ×
        </button>
      </div>
      <div className="board-resize note-resize" onPointerDown={onResizeDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} title="Élargir" />
    </div>
  );
}

/** Durée de chargement à côté du nom de l'écran : en direct si chargé dans l'éditeur, sinon sa capture. */
function LoadTime({ live, capture }: { live?: number; capture?: number }) {
  const ms = live ?? capture;
  if (ms === undefined) return null;
  return (
    <span className="load-time" title={live !== undefined ? `Chargé en direct en ${seconds(live)}${capture !== undefined ? ` · capture : ${seconds(capture)}` : ''}` : `Capture faite en ${seconds(ms)} (chargement de l'écran compris)`}>
      {' · '}
      {seconds(ms)}
    </span>
  );
}
