import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BoardGroup, BoardNote, BoardPage, StoryEntry } from '../shared/protocol.ts';
import { type FlowData, FlowLayer, FlowLegend, type FlowMode, layoutFlows, viewFlows } from './Flows.tsx';
import { storyUrl } from './urls.ts';
import { PALETTE_GAP, PALETTE_WIDTH, paletteSide } from './palette.ts';

/** `shown` : l'écran a affiché quelque chose ; `empty` : prêt mais toujours vide après un long délai. */
export type LoadState = 'shown' | 'empty';

export interface Device {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const DEVICES: Device[] = [
  { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852 },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915 },
  { id: 'ipad-mini', label: 'iPad mini', width: 744, height: 1133 },
];

const GAP = 80;
const PADDING = 60;
const LABEL = 28;
/** Les écrans sont rangés en grille plutôt qu'en une seule ligne interminable. */
const COLUMNS = 4;
const VIEW_KEY = 'rn-canvas:view';
const VIEWS_KEY = 'rn-canvas:views';
const POSITIONS_KEY = 'rn-canvas:positions';
export const GROUP_COLORS = ['violet', 'blue', 'green', 'yellow', 'pink', 'grey'];
export const NOTE_COLORS = ['yellow', 'blue', 'green', 'pink'];
const newId = () => Math.random().toString(36).slice(2, 10);
/** Pas de la grille de points du fond : un écran déplacé s'y aligne. */
const SNAP = 20;

type View = { x: number; y: number; zoom: number };
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
  | { kind: 'story'; id: string; startX: number; startY: number; from: Point; moved: boolean }
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

export function Canvas(props: Props) {
  const { appUrl, isolateStories, stories, allStories, device, activeStory, errors, loaded, generations, flows, frames, onActivate, onUnload, empty, reveal, children } = props;
  const { blocked = {} } = props;
  const { page, onChangePage, onCreateParcours, flowMode, onFlowMode, isolate, onBackgroundClick, keepLoaded = 24, loadAll = false, showBoardTools = true, showLabels = true } = props;
  const viewport = useRef<HTMLDivElement>(null);
  // Vue mémorisée par page : ni un rechargement ni l'ajout / le masquage d'un écran ne la réinitialisent.
  const [view, setView] = useState<View>(() => readView(page.id) ?? { x: PADDING, y: PADDING, zoom: 0.75 });
  const autoFitted = useRef(readView(page.id) !== null);
  const viewPage = useRef(page.id);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const columns = Math.max(1, Math.min(COLUMNS, stories.length));
  const cellWidth = device.width + GAP;
  const cellHeight = device.height + LABEL + GAP;
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
  // Les écrans non placés à la main se rangent en grille, sous ce qui est déjà disposé : un nouvel
  // écran (fichier canvas ajouté, `rn-canvas screens`) ne tombe ni sur un écran placé ni dans un groupe.
  const gridIndex = useMemo(() => new Map(stories.filter((s) => !positions[s.id]).map((s, i) => [s.id, i])), [stories, positions]);
  const gridOrigin = useMemo(() => {
    const boxes = [
      ...stories.filter((s) => positions[s.id]).map((s) => ({ ...positions[s.id], width: device.width, height: device.height + LABEL })),
      ...page.groups,
      ...page.notes.map((n) => ({ ...n, height: 120 })),
    ];
    if (boxes.length === 0) return { x: 0, y: 0 };
    return { x: Math.min(...boxes.map((b) => b.x)), y: Math.max(...boxes.map((b) => b.y + b.height)) + GAP * 2 };
  }, [stories, positions, page.groups, page.notes, device]);
  const positionOf = useCallback(
    (id: string): Point | null => {
      if (!visible.has(id)) return null;
      if (positions[id]) return positions[id];
      const i = gridIndex.get(id) ?? 0;
      return { x: gridOrigin.x + (i % columns) * cellWidth, y: gridOrigin.y + Math.floor(i / columns) * cellHeight };
    },
    [visible, gridIndex, gridOrigin, positions, columns, cellWidth, cellHeight],
  );

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
  const live = useMemo(() => {
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
  }, [stories, positionOf, settled, viewportSize, device, activeStory, loaded, visible, keepLoaded, loadAll]);

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
    if (from) capture(e, { kind: 'story', id, startX: e.clientX, startY: e.clientY, from, moved: false });
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
    }
    const snap = (v: number) => (e.altKey ? v : Math.round(v / SNAP) * SNAP);
    // Le déplacement aimanté de l'élément tiré s'applique tel quel à son contenu.
    const ox = snap(m.from.x + dx) - m.from.x;
    const oy = snap(m.from.y + dy) - m.from.y;
    if (m.kind === 'story') setPositions((p) => ({ ...p, [m.id]: { x: m.from.x + ox, y: m.from.y + oy } }));
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

  // Dès que l'écran demandé est dans la grille (manifeste rechargé), la vue le cadre.
  const revealed = useRef(0);
  useEffect(() => {
    const el = viewport.current;
    if (!reveal || reveal.seq === revealed.current || !el) return;
    const p = positionOf(reveal.id);
    if (!p) return;
    revealed.current = reveal.seq;
    const { width, height } = el.getBoundingClientRect();
    const zoom = Math.min(1, (height - PADDING) / (device.height + LABEL));
    setView({ zoom, x: width / 2 - (p.x + device.width / 2) * zoom, y: PADDING / 2 - p.y * zoom });
  }, [reveal, positionOf, device]);

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

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (e.target !== e.currentTarget && !target.classList.contains('world') && !target.classList.contains('board-group')) return;
    if (editing && !target.closest('.note, .board-group-head')) setEditing(null);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    // Un clic (sans déplacement) dans le vide, pas un glissement du canevas : désélection.
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) onBackgroundClick?.();
  };

  const center = () => {
    const rect = viewport.current!.getBoundingClientRect();
    return [rect.width / 2, rect.height / 2] as const;
  };

  return (
    <main
      className={`canvas ${panning || movingId ? 'panning' : ''}`}
      ref={viewport}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
              className={`artboard ${activeStory === story.id ? 'active' : ''} ${movingId === story.id ? 'moving' : ''}`}
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
                onClick={() => {
                  if (justMoved.current) justMoved.current = false;
                  else onActivate(story.id);
                }}
                title={`${story.id}\nGlisser pour déplacer l'écran (Alt : sans aimantation)`}
              >
                {story.file.split('/').pop()!.replace(/\.canvas\.\w+$/, '')} · {story.title}
              </button>
              <div className="frame" style={{ width: device.width, height: device.height }}>
                {story.id in admitted && (
                  <iframe
                    title={story.id}
                    src={storyUrl(appUrl, story, isolateStories, generations[story.id])}
                    width={device.width}
                    height={device.height}
                    ref={(el) => {
                      if (el) frames.set(story.id, el);
                      else frames.delete(story.id);
                    }}
                  />
                )}
                {!live.has(story.id) ? (
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
      {pending > 0 && (
        <div className="canvas-progress" role="status">
          <span className="spinner" />
          Chargement des écrans{loadAll ? '' : ' de la vue'} · {live.size - pending}/{live.size}
        </div>
      )}
      {flowLayout && flowView && <FlowLegend layout={flowLayout} view={flowView} mode={page.groups.length ? flowMode : 'all'} onMode={onFlowMode} hasGroups={page.groups.length > 0} parcours={page.stories !== null} />}
      {children}
      <div className="board-tools" hidden={!showBoardTools} onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={addGroup} title="Cadre de couleur pour ranger des écrans (autour de l'écran actif s'il y en a un)">
          ▢ Groupe
        </button>
        <button onClick={addNote} title="Bloc de texte libre">
          ✎ Note
        </button>
      </div>
      <div className="zoom-controls">
        <button onClick={() => zoomAt(1 / 1.2, ...center())} aria-label="Dézoomer">−</button>
        <button onClick={fit} title="Tout afficher">{Math.round(view.zoom * 100)} %</button>
        <button onClick={() => zoomAt(1.2, ...center())} aria-label="Zoomer">+</button>
        <button onClick={resetPositions} disabled={Object.keys(positions).length === 0} title="Remettre les écrans dans la grille d'origine" aria-label="Repositionner les écrans">
          ⊞
        </button>
      </div>
    </main>
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
            autoFocus
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
          autoFocus
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
