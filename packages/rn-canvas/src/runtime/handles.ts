/**
 * Poignées sur l'élément sélectionné : rayon des coins, marges intérieures et extérieures,
 * espacement entre enfants, largeur et hauteur.
 *
 * Pendant le glisser, l'élément est modifié en direct (style inline du DOM rendu), puis la valeur
 * est envoyée à l'éditeur au relâchement : une seule écriture dans le code, une seule étape
 * d'annulation. L'aperçu est retiré une fois le code rechargé.
 */
import type { HandleSet, Loc, Rect } from '../shared/protocol';

type Side = 'Top' | 'Right' | 'Bottom' | 'Left';
type Corner = 'TopLeft' | 'TopRight' | 'BottomRight' | 'BottomLeft';

interface Handle {
  /** Ce qui est modifié, pour l'aperçu et l'étiquette. */
  kind: 'radius' | 'padding' | 'margin' | 'gap' | 'width' | 'height';
  side?: Side;
  corner?: Corner;
  /** Position du centre de la poignée dans l'écran. */
  x: number;
  y: number;
  /** Barre horizontale, verticale, ou point. */
  shape: 'h' | 'v' | 'dot';
  cursor: string;
  start: number;
  /** Nouvelle valeur pour un déplacement du pointeur (dx, dy). */
  valueFor: (dx: number, dy: number) => number;
  title: string;
}

interface Drag {
  handle: Handle;
  x: number;
  y: number;
  value: number;
  /** Modificateurs : Alt = les deux côtés de l'axe (ou un seul coin), Maj = tous les côtés. */
  alt: boolean;
  shift: boolean;
}

const COLORS = { radius: '#7C5CFF', padding: '#E8368F', margin: '#F79009', gap: '#12B76A', width: '#2E90FA', height: '#2E90FA' };
const SIDES: Side[] = ['Top', 'Right', 'Bottom', 'Left'];
const CORNERS: Corner[] = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];

/** Arrondi à l'entier, attiré par les multiples de 4 (l'échelle d'espacement usuelle). */
function snap(value: number, free: boolean): number {
  const rounded = Math.round(value);
  if (free) return rounded;
  const four = Math.round(value / 4) * 4;
  return Math.abs(value - four) <= 1.5 ? four : rounded;
}

const px = (value: string | undefined) => {
  const n = parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
};

export interface HandlesController {
  configure(loc: Loc | null, handles: HandleSet | null): void;
  /** Dessine les poignées de `loc` (premier exemplaire : `node`, sa zone `rect`) dans `layer`. */
  render(layer: HTMLElement, loc: Loc | null, node: Element | null, rect: Rect | null, instances: Element[]): void;
  dragging(): boolean;
  /** Vrai une fois juste après un glisser : le clic qui suit ne doit pas changer la sélection. */
  consumeClick(): boolean;
  /** Réponse de l'éditeur après l'écriture : retire l'aperçu (tout de suite en cas d'échec). */
  applied(ok: boolean): void;
}

export function createHandles(post: (message: { type: 'style-drag'; loc: Loc; key: string; value: number }) => void, redraw: () => void): HandlesController {
  let config: { loc: Loc; handles: HandleSet } | null = null;
  let drag: Drag | null = null;
  let current: { loc: Loc; node: Element; instances: Element[] } | null = null;
  // Valeurs inline d'origine des éléments modifiés en aperçu, pour les rétablir.
  const previewed = new Map<HTMLElement, Map<string, string>>();
  let clearTimer = 0;
  let justDragged = false;

  const setPreview = (props: Record<string, string>) => {
    for (const el of current?.instances ?? []) {
      const node = el as HTMLElement;
      const saved = previewed.get(node) ?? new Map<string, string>();
      for (const [prop, value] of Object.entries(props)) {
        if (!saved.has(prop)) saved.set(prop, node.style.getPropertyValue(prop));
        node.style.setProperty(prop, value);
      }
      previewed.set(node, saved);
    }
  };
  const clearPreview = () => {
    window.clearTimeout(clearTimer);
    for (const [node, saved] of previewed) for (const [prop, value] of saved) node.style.setProperty(prop, value);
    previewed.clear();
  };

  /** Clé écrite dans le code et propriétés CSS de l'aperçu, selon la poignée et les modificateurs. */
  const target = (d: Drag): { key: string; css: string[] } => {
    const { handle, alt, shift } = d;
    if (handle.kind === 'radius') {
      if (alt && handle.corner) return { key: `border${handle.corner}Radius`, css: [`border-${kebab(handle.corner)}-radius`] };
      return { key: 'borderRadius', css: CORNERS.map((c) => `border-${kebab(c)}-radius`) };
    }
    if (handle.kind === 'padding' || handle.kind === 'margin') {
      const base = handle.kind;
      const vertical = handle.side === 'Top' || handle.side === 'Bottom';
      if (shift) return { key: base, css: SIDES.map((s) => `${base}-${s.toLowerCase()}`) };
      if (alt) return { key: `${base}${vertical ? 'Vertical' : 'Horizontal'}`, css: (vertical ? ['top', 'bottom'] : ['left', 'right']).map((s) => `${base}-${s}`) };
      return { key: `${base}${handle.side}`, css: [`${base}-${handle.side!.toLowerCase()}`] };
    }
    if (handle.kind === 'gap') return { key: 'gap', css: ['gap', 'row-gap', 'column-gap'] };
    return { key: handle.kind, css: [handle.kind] };
  };

  const onMove = (event: PointerEvent) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    drag.alt = event.altKey;
    drag.shift = event.shiftKey;
    const raw = drag.handle.valueFor(event.clientX - drag.x, event.clientY - drag.y);
    // ⌘/Ctrl : valeur libre, sans aimant sur les multiples de 4.
    drag.value = snap(raw, event.metaKey || event.ctrlKey);
    const { css } = target(drag);
    setPreview(Object.fromEntries(css.map((c) => [c, `${drag!.value}px`])));
    redraw();
  };

  const onUp = (event: PointerEvent) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const d = drag;
    drag = null;
    justDragged = true;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    document.documentElement.style.cursor = '';
    if (current && d.value !== d.handle.start) post({ type: 'style-drag', loc: current.loc, key: target(d).key, value: d.value });
    else clearPreview();
    redraw();
  };

  const startDrag = (event: PointerEvent, handle: Handle) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    clearPreview();
    drag = { handle, x: event.clientX, y: event.clientY, value: handle.start, alt: event.altKey, shift: event.shiftKey };
    document.documentElement.style.cursor = handle.cursor;
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  };

  /** Poignées possibles pour l'élément, d'après ses styles calculés. */
  const handlesFor = (node: Element, rect: Rect, set: HandleSet): Handle[] => {
    const cs = getComputedStyle(node);
    const out: Handle[] = [];
    const { x, y, width: w, height: h } = rect;
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (set.radius && w >= 24 && h >= 24) {
      const max = Math.min(w, h) / 2;
      for (const corner of CORNERS) {
        const r = Math.min(px(cs.getPropertyValue(`border-${kebab(corner)}-radius`)), max);
        const inset = Math.min(Math.max(10, r * 0.6 + 6), max - 2);
        const left = corner.endsWith('Left');
        const top = corner.startsWith('Top');
        const sx = left ? 1 : -1;
        const sy = top ? 1 : -1;
        out.push({
          kind: 'radius',
          corner,
          x: (left ? x : x + w) + sx * inset,
          y: (top ? y : y + h) + sy * inset,
          shape: 'dot',
          cursor: left === top ? 'nwse-resize' : 'nesw-resize',
          start: r,
          // Vers l'intérieur du coin : l'arrondi grandit (projection sur la diagonale).
          valueFor: (dx, dy) => Math.min(max, Math.max(0, r + (sx * dx + sy * dy) / 2)),
          title: 'Rayon des coins (Alt : ce coin seulement)',
        });
      }
    }

    const spacing = (kind: 'padding' | 'margin') => {
      for (const side of SIDES) {
        const value = px(cs.getPropertyValue(`${kind}-${side.toLowerCase()}`));
        const vertical = side === 'Top' || side === 'Bottom';
        // Padding : au bord intérieur de la zone ; margin : au bord extérieur. Jamais collés au contour.
        const offset = kind === 'padding' ? Math.max(value, 6) : -Math.max(value, 6);
        const pos =
          side === 'Top' ? { x: cx, y: y + offset } : side === 'Bottom' ? { x: cx, y: y + h - offset } : side === 'Left' ? { x: x + offset, y: cy } : { x: x + w - offset, y: cy };
        // Tirer vers l'intérieur augmente le padding ; vers l'extérieur, la marge.
        const dir = kind === 'padding' ? 1 : -1;
        const sign = side === 'Top' || side === 'Left' ? dir : -dir;
        out.push({
          kind,
          side,
          ...pos,
          shape: vertical ? 'h' : 'v',
          cursor: vertical ? 'ns-resize' : 'ew-resize',
          start: value,
          valueFor: (dx, dy) => {
            const next = value + sign * (vertical ? dy : dx);
            return kind === 'padding' ? Math.max(0, next) : next;
          },
          title: `${kind === 'padding' ? 'Marge intérieure' : 'Marge extérieure'} (Alt : les deux côtés · Maj : tous les côtés)`,
        });
      }
    };
    if (set.padding && w >= 40 && h >= 24) spacing('padding');
    if (set.margin) spacing('margin');

    if (set.gap && cs.display.includes('flex')) {
      const children = Array.from(node.children).filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(c).position !== 'absolute';
      });
      if (children.length >= 2) {
        const column = cs.flexDirection.startsWith('column');
        const a = children[0].getBoundingClientRect();
        const b = children[1].getBoundingClientRect();
        const value = px(column ? cs.rowGap : cs.columnGap);
        out.push({
          kind: 'gap',
          x: column ? cx : (a.right + b.left) / 2,
          y: column ? (a.bottom + b.top) / 2 : cy,
          shape: column ? 'h' : 'v',
          cursor: column ? 'ns-resize' : 'ew-resize',
          start: value,
          valueFor: (dx, dy) => Math.max(0, value + (column ? dy : dx)),
          title: 'Espacement entre les enfants',
        });
      }
    }

    if (set.width) out.push({ kind: 'width', x: x + w, y: cy, shape: 'v', cursor: 'ew-resize', start: Math.round(w), valueFor: (dx) => Math.max(0, w + dx), title: 'Largeur' });
    if (set.height) out.push({ kind: 'height', x: cx, y: y + h, shape: 'h', cursor: 'ns-resize', start: Math.round(h), valueFor: (_dx, dy) => Math.max(0, h + dy), title: 'Hauteur' });
    return out;
  };

  const label = (layer: HTMLElement, text: string, x: number, y: number, color: string) => {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      padding: '3px 7px',
      borderRadius: '4px',
      background: color,
      color: '#fff',
      font: '600 11px -apple-system, system-ui, sans-serif',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    layer.appendChild(el);
  };

  /** Zones de marge (extérieures) et de padding (intérieures), hachurées pendant le glisser. */
  const zones = (layer: HTMLElement, node: Element, rect: Rect, kind: 'padding' | 'margin') => {
    const cs = getComputedStyle(node);
    const v = (side: string) => px(cs.getPropertyValue(`${kind}-${side}`));
    const [t, r, b, l] = ['top', 'right', 'bottom', 'left'].map(v);
    const boxes =
      kind === 'padding'
        ? [
            { x: rect.x, y: rect.y, width: rect.width, height: t },
            { x: rect.x, y: rect.y + rect.height - b, width: rect.width, height: b },
            { x: rect.x, y: rect.y + t, width: l, height: rect.height - t - b },
            { x: rect.x + rect.width - r, y: rect.y + t, width: r, height: rect.height - t - b },
          ]
        : [
            { x: rect.x - l, y: rect.y - t, width: rect.width + l + r, height: t },
            { x: rect.x - l, y: rect.y + rect.height, width: rect.width + l + r, height: b },
            { x: rect.x - l, y: rect.y, width: l, height: rect.height },
            { x: rect.x + rect.width, y: rect.y, width: r, height: rect.height },
          ];
    const color = kind === 'padding' ? '232, 54, 143' : '247, 144, 9';
    for (const box of boxes) {
      if (box.width <= 0 || box.height <= 0) continue;
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed',
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        background: `repeating-linear-gradient(45deg, rgba(${color}, 0.22) 0 2px, rgba(${color}, 0.08) 2px 6px)`,
        pointerEvents: 'none',
      });
      layer.appendChild(el);
    }
  };

  return {
    configure(loc, handles) {
      config = loc && handles ? { loc, handles } : null;
    },
    render(layer, loc, node, rect, instances) {
      layer.replaceChildren();
      if (!config || !loc || loc !== config.loc || !node || !rect) {
        current = null;
        return;
      }
      current = { loc, node, instances };
      if (drag) {
        const { handle } = drag;
        if (handle.kind === 'padding' || handle.kind === 'margin') zones(layer, node, rect, handle.kind);
        label(layer, `${target(drag).key} ${drag.value}`, drag.x + 14, drag.y + 14, COLORS[handle.kind]);
        return;
      }
      for (const handle of handlesFor(node, rect, config.handles)) {
        const el = document.createElement('div');
        const color = COLORS[handle.kind];
        const size = handle.shape === 'dot' ? { width: 10, height: 10 } : handle.shape === 'h' ? { width: 18, height: 6 } : { width: 6, height: 18 };
        el.title = handle.title;
        Object.assign(el.style, {
          position: 'fixed',
          left: `${handle.x - size.width / 2}px`,
          top: `${handle.y - size.height / 2}px`,
          width: `${size.width}px`,
          height: `${size.height}px`,
          boxSizing: 'border-box',
          borderRadius: '999px',
          background: handle.shape === 'dot' ? '#fff' : color,
          border: `2px solid ${handle.shape === 'dot' ? color : '#fff'}`,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
          cursor: handle.cursor,
          pointerEvents: 'auto',
          touchAction: 'none',
        });
        el.addEventListener('pointerdown', (event) => startDrag(event, handle));
        // Zones visibles au survol de la poignée, pour voir ce qu'elle règle.
        if (handle.kind === 'padding' || handle.kind === 'margin') {
          const kind = handle.kind;
          const shade = document.createElement('div');
          el.addEventListener('pointerenter', () => {
            shade.replaceChildren();
            zones(shade, node, rect, kind);
            layer.insertBefore(shade, layer.firstChild);
          });
          el.addEventListener('pointerleave', () => shade.remove());
        }
        layer.appendChild(el);
      }
    },
    dragging: () => drag !== null,
    consumeClick() {
      const was = justDragged;
      justDragged = false;
      return was;
    },
    applied(ok) {
      window.clearTimeout(clearTimer);
      // Succès : on laisse au rechargement du code (Fast Refresh) le temps d'arriver.
      if (ok) clearTimer = window.setTimeout(clearPreview, 2500);
      else clearPreview();
    },
  };
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase());
}
