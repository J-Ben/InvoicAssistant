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

interface Props {
  appUrl: string;
  isolateStories: boolean;
  stories: StoryEntry[];
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

/** Canevas infini : déplacement (glisser le fond, molette), zoom (Ctrl/⌘ + molette, boutons). */
export function Canvas({ appUrl, isolateStories, stories, device, activeStory, errors, loaded, generations, flows, frames, onActivate, empty }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: PADDING, y: PADDING, zoom: 0.75 });
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const columns = Math.max(1, Math.min(COLUMNS, stories.length));
  const rows = Math.ceil(stories.length / columns);
  const cellWidth = device.width + GAP;
  const cellHeight = device.height + LABEL + GAP;
  const contentWidth = columns * cellWidth - GAP;
  const contentHeight = rows * cellHeight - GAP;
  const pending = stories.filter((s) => !loaded[s.id]).length;

  const [hovered, setHovered] = useState<string | null>(null);
  const flowLayout = useMemo(() => {
    if (!flows) return null;
    const index = new Map(stories.map((s, i) => [s.id, i]));
    return layoutFlows(flows, (id) => {
      const i = index.get(id);
      if (i === undefined) return null;
      return { x: (i % columns) * cellWidth, y: Math.floor(i / columns) * cellHeight + LABEL, width: device.width, height: device.height };
    });
  }, [flows, stories, columns, cellWidth, cellHeight, device]);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el || stories.length === 0) return;
    const { width, height } = el.getBoundingClientRect();
    const zoom = Math.min(1, (width - PADDING * 2) / contentWidth, (height - PADDING * 2) / contentHeight);
    setView({ zoom, x: (width - contentWidth * zoom) / 2, y: Math.max(PADDING / 2, (height - contentHeight * zoom) / 2) });
  }, [stories.length, contentWidth, contentHeight]);

  useLayoutEffect(fit, [fit]);

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
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

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
      className={`canvas ${panning ? 'panning' : ''}`}
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
        {stories.map((story, i) => (
          <section
            key={story.id}
            className={`artboard ${activeStory === story.id ? 'active' : ''}`}
            style={{ left: (i % columns) * cellWidth, top: Math.floor(i / columns) * cellHeight, width: device.width }}
            onMouseEnter={() => setHovered(story.id)}
            onMouseLeave={() => setHovered((h) => (h === story.id ? null : h))}
          >
            <button className="artboard-label" onClick={() => onActivate(story.id)} title={story.id}>
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
        ))}
        {flowLayout && <FlowLayer layout={flowLayout} width={contentWidth} height={contentHeight + LABEL} zoom={view.zoom} focus={hovered} />}
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
      </div>
    </main>
  );
}
