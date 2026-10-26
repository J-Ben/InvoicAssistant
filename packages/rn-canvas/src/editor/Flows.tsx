import type { FlowLink, Rect } from '../shared/protocol.ts';

export interface FlowData {
  links: FlowLink[];
  /** Position des boutons dans chaque écran (coordonnées de l'iframe). */
  rects: Record<string, Record<string, Rect>>;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FlowPath {
  key: string;
  from: string;
  to: string;
  d: string;
  /** Bouton d'origine, en coordonnées du canevas (absent : navigation de l'écran lui-même). */
  anchor: Box | null;
  text: string;
  start: { x: number; y: number };
}

export interface FlowLayout {
  paths: FlowPath[];
  /** Routes visées mais absentes du canevas, avec leur nombre de liens. */
  missing: [string, number][];
  /** Liens dont le bouton n'est affiché dans aucun écran (état vide, élément replié…). */
  hidden: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Trajets des flèches : du bouton (ou du haut de l'écran) vers le bord le plus proche de l'écran cible. */
export function layoutFlows(data: FlowData, frameOf: (story: string) => Box | null): FlowLayout {
  const paths = new Map<string, FlowPath>();
  const missing = new Map<string, number>();
  let hidden = 0;

  for (const link of data.links) {
    const target = link.targets.find((id) => frameOf(id));
    if (!target) {
      if (link.route) missing.set(link.route, (missing.get(link.route) ?? 0) + 1);
      continue;
    }
    const origins: { story: string; anchor: Box | null }[] = [];
    if (link.loc) {
      for (const [story, rects] of Object.entries(data.rects)) {
        const rect = rects[link.loc];
        const frame = frameOf(story);
        if (!rect || !frame) continue;
        const x = clamp(rect.x, 0, frame.width);
        const y = clamp(rect.y, 0, frame.height);
        const anchor = {
          x: frame.x + x,
          y: frame.y + y,
          width: clamp(rect.x + rect.width, 0, frame.width) - x,
          height: clamp(rect.y + rect.height, 0, frame.height) - y,
        };
        if (anchor.width > 0 && anchor.height > 0) origins.push({ story, anchor });
      }
      if (origins.length === 0) hidden++;
    } else {
      for (const story of link.sources) if (frameOf(story)) origins.push({ story, anchor: null });
    }

    const to = frameOf(target)!;
    for (const { story, anchor } of origins) {
      if (story === target) continue;
      const key = `${story}|${link.loc ?? link.file}|${target}`;
      if (paths.has(key)) continue;
      const from = frameOf(story)!;
      const goesRight = to.x > from.x + from.width / 2;
      const goesLeft = to.x + to.width < from.x + from.width / 2;
      const start = anchor
        ? { x: goesLeft ? anchor.x : anchor.x + anchor.width, y: anchor.y + anchor.height / 2 }
        : { x: goesLeft ? from.x : from.x + from.width, y: from.y + 28 };
      let end: { x: number; y: number };
      let d: string;
      if (goesRight || goesLeft) {
        end = { x: goesRight ? to.x : to.x + to.width, y: to.y + 48 };
        const dx = Math.max(60, Math.abs(end.x - start.x) / 2) * (goesRight ? 1 : -1);
        d = `M${start.x},${start.y} C${start.x + dx},${start.y} ${end.x - dx},${end.y} ${end.x},${end.y}`;
      } else {
        // Même colonne : on arrive par le haut ou par le bas de l'écran cible.
        const below = to.y > from.y;
        end = { x: to.x + to.width / 2, y: below ? to.y : to.y + to.height };
        const dy = Math.max(60, Math.abs(end.y - start.y) / 2) * (below ? 1 : -1);
        const side = start.x + 80;
        d = `M${start.x},${start.y} C${side},${start.y} ${end.x},${end.y - dy} ${end.x},${end.y}`;
      }
      paths.set(key, { key, from: story, to: target, d, anchor, start, text: `${link.label ?? link.name ?? 'Écran'} → ${link.href}` });
    }
  }
  return { paths: [...paths.values()], missing: [...missing.entries()].sort((a, b) => b[1] - a[1]), hidden };
}

/** Flèches dessinées dans le repère du canevas (sous la transformation de zoom). */
export function FlowLayer({ layout, width, height, zoom, focus }: { layout: FlowLayout; width: number; height: number; zoom: number; focus: string | null }) {
  const stroke = 2 / zoom;
  const isStrong = (p: FlowPath) => focus !== null && (p.from === focus || p.to === focus);
  // Les liens de l'écran survolé passent au premier plan.
  const ordered = [...layout.paths].sort((a, b) => Number(isStrong(a)) - Number(isStrong(b)));
  return (
    <svg className="flows" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      {ordered.map((p) => {
        const strong = isStrong(p);
        const faded = focus !== null && !strong;
        return (
          <g key={p.key} className={`flow ${strong ? 'strong' : ''} ${faded ? 'faded' : ''}`}>
            {p.anchor && <rect x={p.anchor.x} y={p.anchor.y} width={p.anchor.width} height={p.anchor.height} rx={6} strokeWidth={stroke} />}
            <path d={p.d} strokeWidth={strong ? stroke * 1.5 : stroke} strokeDasharray={p.anchor ? undefined : `${6 / zoom} ${4 / zoom}`} markerEnd="url(#flow-arrow)" />
            {strong && p.from === focus && (
              <text x={p.start.x + 8 / zoom} y={p.start.y - 8 / zoom} fontSize={12 / zoom}>
                {p.text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function FlowLegend({ layout }: { layout: FlowLayout }) {
  const missingLinks = layout.missing.reduce((n, [, count]) => n + count, 0);
  return (
    <div className="flow-legend" role="status">
      <strong>{layout.paths.length} liens</strong> entre les écrans affichés · survolez un écran pour voir les siens
      {missingLinks > 0 && (
        <div title={layout.missing.map(([route, n]) => `${route} (${n})`).join('\n')}>
          {missingLinks} vers des écrans absents du canevas : {layout.missing.map(([route]) => route.replace(/^app\//, '').replace(/\.\w+$/, '')).join(', ')}
        </div>
      )}
      {layout.hidden > 0 && <div>{layout.hidden} bouton(s) non affiché(s) dans l'état actuel des écrans</div>}
    </div>
  );
}
