import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StoryEntry } from '../shared/protocol.ts';
import { type FlowData, FlowLayer, FlowLegend, layoutFlows } from './Flows.tsx';
import { storyUrl } from './urls.ts';

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
const POSITIONS_KEY = 'rn-canvas:positions';
/** Pas de la grille de points du fond : un écran déplacé s'y aligne. */
const SNAP = 20;

type View = { x: number; y: number; zoom: number };
type Point = { x: number; y: number };

function readPositions(appUrl: string): Record<string, Point> {
  try {
    const all = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}');
    return all?.[appUrl] ?? {};
  } catch {
    return {};
  }
}

function writePositions(appUrl: string, positions: Record<string, Point>) {
  try {
    const all = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}') ?? {};
    all[appUrl] = positions;
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(all));
  } catch {
    // Stockage indisponible : les positions valent pour la session.
  }
}

function readView(): View | null {
  try {
    const view = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    return view && [view.x, view.y, view.zoom].every(Number.isFinite) ? view : null;
  } catch {
    return null;
  }
}

interface Props {
  appUrl: string;
  isolateStories: boolean;
  /** Écrans affichés (cochés), dans l'ordre de la grille. */
  stories: StoryEntry[];
  /** Tous les écrans : un écran décoché reste chargé mais masqué, pour réapparaître sans délai. */
  allStories: StoryEntry[];
  device: Device;
  activeStory: string | null;
  errors: Record<string, string>;
  /** Écrans affichés (premier rendu reçu) ; les autres montrent un indicateur de chargement. */
  loaded: Record<string, LoadState>;
  /** Stockage de rechange par écran (voir `storyUrl`). */
  generations: Record<string, number>;
  /** Mode Flux : liens de navigation à dessiner ; null quand il est désactivé. */
  flows: FlowData | null;
  frames: Map<string, HTMLIFrameElement>;
  onActivate: (id: string) => void;
  empty: boolean;
}

/**
 * Canevas infini : déplacement (glisser le fond, molette), zoom (Ctrl/⌘ + molette, boutons).
 * Un écran se déplace en glissant son nom ; sa position est mémorisée (bouton ⊞ : grille d'origine).
 */
export function Canvas({ appUrl, isolateStories, stories, allStories, device, activeStory, errors, loaded, generations, flows, frames, onActivate, empty }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  // Vue mémorisée : ni un rechargement ni l'ajout / le masquage d'un écran ne la réinitialisent.
  const [view, setView] = useState<View>(() => readView() ?? { x: PADDING, y: PADDING, zoom: 0.75 });
  const autoFitted = useRef(readView() !== null);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const columns = Math.max(1, Math.min(COLUMNS, stories.length));
  const cellWidth = device.width + GAP;
  const cellHeight = device.height + LABEL + GAP;
  const pending = stories.filter((s) => !loaded[s.id]).length;
  const gridIndex = useMemo(() => new Map(stories.map((s, i) => [s.id, i])), [stories]);

  // Positions choisies à la main (coin haut gauche, nom compris) ; les autres écrans restent en grille.
  const [positions, setPositions] = useState<Record<string, Point>>(() => readPositions(appUrl));
  useEffect(() => writePositions(appUrl, positions), [appUrl, positions]);
  const positionOf = useCallback(
    (id: string): Point | null => {
      const i = gridIndex.get(id);
      if (i === undefined) return null;
      return positions[id] ?? { x: (i % columns) * cellWidth, y: Math.floor(i / columns) * cellHeight };
    },
    [gridIndex, positions, columns, cellWidth, cellHeight],
  );

  // Emprise des écrans affichés, pour « tout afficher » et le calque des flèches.
  const bounds = useMemo(() => {
    const points = stories.map((s) => positionOf(s.id)).filter((p): p is Point => p !== null);
    if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    const x = Math.min(...points.map((p) => p.x));
    const y = Math.min(...points.map((p) => p.y));
    return { x, y, width: Math.max(...points.map((p) => p.x)) + device.width - x, height: Math.max(...points.map((p) => p.y)) + device.height + LABEL - y };
  }, [stories, positionOf, device]);

  // Écran en cours de déplacement (glissé par son nom).
  const moving = useRef<{ id: string; startX: number; startY: number; from: Point; moved: boolean } | null>(null);
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

  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el || stories.length === 0) return;
    const { width, height } = el.getBoundingClientRect();
    const zoom = Math.min(1, (width - PADDING * 2) / bounds.width, (height - PADDING * 2) / bounds.height);
    setView({ zoom, x: (width - bounds.width * zoom) / 2 - bounds.x * zoom, y: Math.max(PADDING / 2, (height - bounds.height * zoom) / 2) - bounds.y * zoom });
  }, [stories.length, bounds]);

  // Retour à la grille d'origine, puis cadrage sur l'ensemble.
  const [regridded, setRegridded] = useState(0);
  const resetPositions = () => {
    setPositions({});
    setRegridded((n) => n + 1);
  };
  useEffect(() => {
    if (regridded) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regridded]);

  const startMove = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    const from = positionOf(id);
    if (!from) return;
    moving.current = { id, startX: e.clientX, startY: e.clientY, from, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
    setPositions((p) => ({ ...p, [m.id]: { x: snap(m.from.x + dx), y: snap(m.from.y + dy) } }));
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
    const { width, height } = el.getBoundingClientRect();
    const rowWidth = columns * cellWidth - GAP;
    const zoom = Math.min(1, (width - PADDING * 2) / rowWidth, (height - PADDING * 2) / (device.height + LABEL));
    setView({ zoom, x: (width - rowWidth * zoom) / 2, y: PADDING / 2 });
  }, [stories.length, columns, cellWidth, device.height]);

  useLayoutEffect(() => {
    if (autoFitted.current || stories.length === 0) return;
    autoFitted.current = true;
    fitFirstRow();
  }, [fitFirstRow, stories.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(view));
      } catch {
        // Stockage indisponible : la vue n'est simplement pas mémorisée.
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [view]);

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
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('world')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const onPointerUp = () => {
    drag.current = null;
    setPanning(false);
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
        {allStories.map((story) => {
          const p = positionOf(story.id);
          return (
            <section
              key={story.id}
              className={`artboard ${activeStory === story.id ? 'active' : ''} ${movingId === story.id ? 'moving' : ''}`}
              style={p === null ? { display: 'none', width: device.width } : { left: p.x, top: p.y, width: device.width }}
              onMouseEnter={() => setHovered(story.id)}
              onMouseLeave={() => setHovered((h) => (h === story.id ? null : h))}
            >
              <button
                className="artboard-label"
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
                {!loaded[story.id] && (
                  <div className="frame-loading" role="status">
                    <span className="spinner" />
                    Chargement de l'écran…
                  </div>
                )}
                {loaded[story.id] === 'empty' && !errors[story.id] && (
                  <div className="frame-empty">Rien d'affiché : données vides ou redirection ? Ouvrez-le en mode Interaction.</div>
                )}
                {errors[story.id] && <div className="frame-error">{errors[story.id]}</div>}
              </div>
            </section>
          );
        })}
        {flowLayout && <FlowLayer layout={flowLayout} width={bounds.x + bounds.width} height={bounds.y + bounds.height} zoom={view.zoom} focus={hovered} />}
      </div>
      {pending > 0 && (
        <div className="canvas-progress" role="status">
          <span className="spinner" />
          Chargement des écrans · {stories.length - pending}/{stories.length}
        </div>
      )}
      {flowLayout && <FlowLegend layout={flowLayout} />}
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
