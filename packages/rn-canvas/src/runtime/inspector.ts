/**
 * Inspecteur côté app (web) : relie le DOM rendu par react-native-web aux éléments JSX
 * du code grâce à la prop `__rnc` injectée par le plugin Babel, en lisant l'arbre React.
 *
 * Communication avec l'éditeur parent par `postMessage`.
 */
import { createElement, Fragment, type ReactNode } from 'react';
import type { CanvasMode, EditorMessage, InsertPosition, LayerNode, Payload, Rect, RuntimeMessage, SelectionInfo } from '../shared/protocol';
import { parseTag } from '../shared/protocol';

/** Marque la frontière de l'écran : les wrappers (navigation, providers) au-dessus sont ignorés. */
export function StoryRoot({ children }: { children?: ReactNode }) {
  return createElement(Fragment, null, children);
}

// Sous-ensemble de la structure interne d'une fibre React dont on a besoin.
interface Fiber {
  tag: number;
  type: unknown;
  stateNode: unknown;
  memoizedProps: Record<string, unknown> | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
}

const HOST_TAGS = new Set([5, 26, 27]); // HostComponent, HostHoistable, HostSingleton

const COMPUTED_KEYS = [
  'width', 'height', 'display', 'flexDirection', 'alignItems', 'justifyContent', 'gap',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'backgroundColor', 'color', 'opacity',
  'borderTopLeftRadius', 'borderTopWidth', 'borderTopColor',
  'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'textAlign',
] as const;

function tagOf(fiber: Fiber): string | null {
  const value = fiber.memoizedProps?.__rnc;
  return typeof value === 'string' ? value : null;
}

function fiberOfNode(node: Node | null): Fiber | null {
  for (let current: Node | null = node; current; current = current.parentNode) {
    for (const key in current) {
      if (key.startsWith('__reactFiber$')) return (current as unknown as Record<string, Fiber>)[key];
    }
  }
  return null;
}

function currentRootFiber(): Fiber | null {
  const container = document.getElementById('root') ?? document.body;
  for (const key in container) {
    if (key.startsWith('__reactContainer$')) {
      const hostRoot = (container as unknown as Record<string, Fiber>)[key];
      return ((hostRoot.stateNode as { current?: Fiber })?.current ?? hostRoot) as Fiber;
    }
  }
  return null;
}

function findStoryRoot(fiber: Fiber | null): Fiber | null {
  if (!fiber) return null;
  if (fiber.type === StoryRoot) return fiber;
  for (let child = fiber.child; child; child = child.sibling) {
    const found = findStoryRoot(child);
    if (found) return found;
  }
  return null;
}

function hostNodes(fiber: Fiber, out: Element[] = []): Element[] {
  if (HOST_TAGS.has(fiber.tag) && fiber.stateNode instanceof Element) {
    out.push(fiber.stateNode);
    return out;
  }
  for (let child = fiber.child; child; child = child.sibling) hostNodes(child, out);
  return out;
}

function unionRect(nodes: Element[]): Rect | null {
  const rects = nodes.map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.left));
  const y = Math.min(...rects.map((r) => r.top));
  return { x, y, width: Math.max(...rects.map((r) => r.right)) - x, height: Math.max(...rects.map((r) => r.bottom)) - y };
}

/** Construit l'arbre des calques sous la racine de l'écran. Les doublons (memo/forwardRef) sont fusionnés. */
function buildTree(root: Fiber): LayerNode[] {
  let counter = 0;
  const visit = (fiber: Fiber, parentTag: string | null, out: LayerNode[]) => {
    for (let child = fiber.child; child; child = child.sibling) {
      const tag = tagOf(child);
      const parsed = tag && tag !== parentTag ? parseTag(tag) : null;
      if (parsed) {
        const node: LayerNode = { key: `${counter++}`, loc: parsed.loc, name: parsed.name, children: [] };
        out.push(node);
        visit(child, tag, node.children);
      } else {
        visit(child, tag ?? parentTag, out);
      }
    }
  };
  const tree: LayerNode[] = [];
  visit(root, null, tree);
  return tree;
}

/** Toutes les fibres (une par instance) qui correspondent à un emplacement du code. */
function fibersAt(root: Fiber, loc: string): Fiber[] {
  const out: Fiber[] = [];
  const visit = (fiber: Fiber, parentTag: string | null) => {
    for (let child = fiber.child; child; child = child.sibling) {
      const tag = tagOf(child);
      if (tag && tag !== parentTag && parseTag(tag)?.loc === loc) out.push(child);
      visit(child, tag ?? parentTag);
    }
  };
  visit(root, null);
  return out;
}

function ancestorsOf(fiber: Fiber, root: Fiber): { loc: string; name: string }[] {
  const out: { loc: string; name: string }[] = [];
  for (let current: Fiber | null = fiber; current && current !== root && current.type !== StoryRoot; current = current.return) {
    const tag = tagOf(current);
    const parsed = tag ? parseTag(tag) : null;
    if (parsed && out[out.length - 1]?.loc !== parsed.loc) out.push({ loc: parsed.loc, name: parsed.name });
  }
  return out;
}

/** Composant (instancié dans le code instrumenté) qui a créé cet élément, d'après React en dev. */
function taggedOwner(fiber: Fiber, root: Fiber): Fiber | null {
  const owner = (fiber as Fiber & { _debugOwner?: unknown })._debugOwner as Fiber | null | undefined;
  if (!owner || typeof owner !== 'object' || !('memoizedProps' in owner)) return null;
  return tagOf(owner) && isInside(owner, root) ? owner : null;
}

/**
 * Niveaux d'imbrication d'un élément, comme les calques de Figma : du composant tel qu'il est
 * écrit dans l'écran jusqu'à l'élément exact. Ex. pour le texte d'un titre de section :
 * [<QuickActionsSection> (écran), <SectionTitle> (organisme), <Text> (atome)].
 */
function nestingPath(fiber: Fiber, root: Fiber): Fiber[] {
  const path: Fiber[] = [];
  for (let current: Fiber | null = fiber; current && path.length < 50; current = taggedOwner(current, root)) path.unshift(current);
  return path;
}

const locOf = (fiber: Fiber) => parseTag(tagOf(fiber)!)?.loc ?? null;

/** `fiber` est-il `ancestor` ou l'un de ses descendants (en tenant compte des fibres alternatives) ? */
function isWithin(fiber: Fiber, ancestor: Fiber): boolean {
  const other = (ancestor as Fiber & { alternate?: Fiber | null }).alternate;
  for (let current: Fiber | null = fiber; current; current = current.return) {
    if (current === ancestor || current === other) return true;
  }
  return false;
}

function isInside(fiber: Fiber, root: Fiber): boolean {
  for (let current: Fiber | null = fiber; current; current = current.return) {
    if (current === root || current.type === StoryRoot) return true;
  }
  return false;
}

export interface InspectorHandle {
  stop(): void;
  reportError(error: Error): void;
}

export function startInspector(storyId: string): InspectorHandle {
  const post = (message: Payload<RuntimeMessage> extends infer M ? (M extends unknown ? Omit<M, 'story'> : never) : never) =>
    window.parent?.postMessage({ source: 'rn-canvas', story: storyId, ...message }, '*');

  let mode: CanvasMode = 'inspect';
  let selected: string | null = null;
  let hovered: string | null = null;
  let lastTree = '';

  const overlay = document.createElement('div');
  overlay.setAttribute('data-rn-canvas-overlay', '');
  Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647' });
  document.body.appendChild(overlay);

  const root = () => findStoryRoot(currentRootFiber());

  // Glisser-déposer : élément attrapé (déplacement) et cible courante sous le pointeur.
  let drag: { fiber: Fiber; loc: string; name: string; x: number; y: number; active: boolean } | null = null;
  let drop: { loc: string; name: string; rect: Rect; position: InsertPosition; valid: boolean; label: string } | null = null;
  let pointer = { x: 0, y: 0 };
  let suppressClick = false;

  const drawDrop = () => {
    if (!drop) return;
    const { rect, position, valid } = drop;
    const color = valid ? '#12B76A' : '#F04438';
    const el = document.createElement('div');
    const style: Partial<CSSStyleDeclaration> = { position: 'fixed', boxSizing: 'border-box', borderRadius: '2px', left: `${rect.x}px`, width: `${rect.width}px` };
    if (position === 'inside') Object.assign(style, { top: `${rect.y}px`, height: `${rect.height}px`, border: `2px dashed ${color}`, background: valid ? 'rgba(18, 183, 106, 0.08)' : 'rgba(240, 68, 56, 0.08)' });
    else Object.assign(style, { top: `${(position === 'before' ? rect.y : rect.y + rect.height) - 1.5}px`, height: '3px', background: color });
    Object.assign(el.style, style);
    overlay.appendChild(el);

    const label = document.createElement('div');
    label.textContent = drop.label;
    Object.assign(label.style, {
      position: 'fixed',
      left: `${pointer.x + 12}px`,
      top: `${pointer.y + 12}px`,
      padding: '3px 7px',
      borderRadius: '4px',
      background: color,
      color: '#fff',
      font: '600 11px -apple-system, system-ui, sans-serif',
      whiteSpace: 'nowrap',
    });
    overlay.appendChild(label);
  };

  const draw = () => {
    overlay.replaceChildren();
    const r = root();
    if (!r) return;
    if (drop) {
      if (drag) paintFiber(drag.fiber, 'dragged');
      drawDrop();
      return;
    }
    const paint = (loc: string | null, kind: 'hover' | 'selected') => {
      if (!loc) return;
      for (const fiber of fibersAt(r, loc)) {
        const rect = unionRect(hostNodes(fiber));
        if (!rect) continue;
        const box = document.createElement('div');
        Object.assign(box.style, {
          position: 'fixed',
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          boxSizing: 'border-box',
          border: kind === 'selected' ? '2px solid #7C5CFF' : '1px dashed #7C5CFF',
          background: kind === 'hover' ? 'rgba(124, 92, 255, 0.08)' : 'transparent',
          borderRadius: '2px',
        });
        overlay.appendChild(box);
      }
    };
    if (mode === 'inspect' && hovered !== selected) paint(hovered, 'hover');
    paint(selected, 'selected');
  };

  function paintFiber(fiber: Fiber, _kind: 'dragged') {
    const rect = unionRect(hostNodes(fiber));
    if (!rect) return;
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, background: 'rgba(124, 92, 255, 0.15)', borderRadius: '2px' });
    overlay.appendChild(box);
  }

  // Niveau de sélection courant (Figma) : chemin de l'élément sélectionné, pour rester au même
  // niveau d'un clic à l'autre dans un même composant.
  let selectedPath: string[] = [];

  /**
   * Élément visé à un point de l'écran, au bon niveau :
   * - `exact` (Alt) : l'élément le plus profond ;
   * - `deeper` (double-clic) : un niveau sous la sélection courante ;
   * - sinon : le même niveau que la sélection courante si on reste dans le même composant,
   *   le niveau de l'écran sinon.
   */
  const pickAt = (x: number, y: number, how: 'level' | 'exact' | 'deeper'): Fiber | null => {
    const r = root();
    let fiber = fiberOfNode(document.elementFromPoint(x, y));
    if (!r || !fiber || !isInside(fiber, r)) return null;
    while (fiber && !tagOf(fiber)) fiber = fiber.return;
    if (!fiber || !isInside(fiber, r)) return null;
    if (how === 'exact') return fiber;
    const path = nestingPath(fiber, r);
    const locs = path.map(locOf);
    const current = locs.indexOf(selected);
    if (how === 'deeper') return path[Math.min(current === -1 ? 0 : current + 1, path.length - 1)];
    // On reste dans le composant commun le plus profond (comme Figma) : même élément, ou son voisin
    // dans le même conteneur, sans remonter au niveau de l'écran.
    let common = 0;
    while (common < selectedPath.length && common < locs.length && selectedPath[common] === locs[common]) common++;
    const depth = Math.min(common, selectedPath.length - 1);
    return path[Math.max(0, Math.min(depth, path.length - 1))];
  };

  const remember = (fiber: Fiber) => {
    const r = root();
    selectedPath = r ? nestingPath(fiber, r).map((f) => locOf(f)!) : [];
  };

  const POSITION_LABEL: Record<InsertPosition, string> = { before: 'avant', after: 'après', inside: 'dans' };

  const computeDrop = (x: number, y: number, exact: boolean, what: { fiber?: Fiber; name: string }) => {
    const fiber = pickAt(x, y, exact ? 'exact' : 'level');
    const rect = fiber ? unionRect(hostNodes(fiber)) : null;
    const tag = fiber ? parseTag(tagOf(fiber)!) : null;
    if (!fiber || !rect || !tag) return null;
    const ratio = rect.height > 0 ? (y - rect.y) / rect.height : 0.5;
    const position: InsertPosition = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
    let valid = true;
    let reason = '';
    if (what.fiber) {
      const source = parseTag(tagOf(what.fiber)!);
      if (isWithin(fiber, what.fiber)) {
        valid = false;
        reason = ' — impossible : dans lui-même';
      } else if (source && source.file !== tag.file) {
        // Le déplacement se fait dans un même fichier (le serveur le vérifie aussi).
        valid = false;
        reason = ` — autre fichier (${tag.file.split('/').pop()})`;
      }
    }
    return { loc: tag.loc, name: tag.name, rect, position, valid, label: `${what.name} → ${POSITION_LABEL[position]} <${tag.name}>${reason}` };
  };

  const endDrag = () => {
    drag = null;
    drop = null;
    document.documentElement.style.cursor = '';
    draw();
  };

  const selectionInfo = (fiber: Fiber, r: Fiber): SelectionInfo | null => {
    const ancestors = ancestorsOf(fiber, r);
    if (ancestors.length === 0) return null;
    const nodes = hostNodes(fibersAt(r, ancestors[0].loc)[0] ?? fiber);
    const computed: Record<string, string> = {};
    if (nodes[0]) {
      const style = getComputedStyle(nodes[0]);
      for (const key of COMPUTED_KEYS) computed[key] = style[key];
    }
    return { loc: ancestors[0].loc, name: ancestors[0].name, ancestors, rect: unionRect(nodes), computed };
  };

  // Élément demandé par l'éditeur mais pas encore rendu (création, Fast Refresh en cours).
  let pending: { loc: string; name?: string } | null = null;

  const select = (loc: string | null, name?: string) => {
    selected = loc;
    pending = null;
    draw();
    const r = root();
    if (!loc || !r) return;
    const target = fibersAt(r, loc).find((f) => !name || parseTag(tagOf(f)!)?.name === name);
    if (target) remember(target);
    const info = target ? selectionInfo(target, r) : null;
    if (info) post({ type: 'select', selection: info });
    else pending = { loc, name };
  };

  // Mode Flux : position du premier exemplaire visible de chaque élément demandé.
  const measure = (locs: Set<string>): Record<string, Rect> => {
    const r = root();
    const rects: Record<string, Rect> = {};
    if (!r || locs.size === 0) return rects;
    const visit = (fiber: Fiber, parentTag: string | null) => {
      for (let child = fiber.child; child; child = child.sibling) {
        const tag = tagOf(child);
        const loc = tag && tag !== parentTag ? parseTag(tag)?.loc : undefined;
        if (loc && locs.has(loc) && !rects[loc]) {
          const rect = unionRect(hostNodes(child));
          if (rect && rect.y + rect.height > 0 && rect.y < window.innerHeight) rects[loc] = rect;
        }
        visit(child, tag ?? parentTag);
      }
    };
    visit(r, null);
    return rects;
  };

  const sendTree = () => {
    const r = root();
    if (!r) return;
    const tree = buildTree(r);
    const json = JSON.stringify(tree);
    if (json !== lastTree) {
      lastTree = json;
      post({ type: 'tree', tree });
    }
  };

  // Fibre instrumentée la plus proche du point visé, limitée à l'écran.
  const fiberAtEvent = (event: Event): Fiber | null => {
    const r = root();
    let fiber = fiberOfNode(event.target as Node);
    if (!r || !fiber || !isInside(fiber, r)) return null;
    while (fiber && !tagOf(fiber)) fiber = fiber.return;
    return fiber && isInside(fiber, r) ? fiber : null;
  };

  const onPointerMove = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (mode !== 'inspect' || !drag) return;
    if (!(event.buttons & 1)) return endDrag();
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    drag.active = true;
    hovered = null;
    document.documentElement.style.cursor = 'grabbing';
    drop = computeDrop(event.clientX, event.clientY, event.altKey, { fiber: drag.fiber, name: drag.name });
    draw();
  };

  // Composant glissé depuis l'onglet Composants de l'éditeur (glisser-déposer HTML entre cadres).
  const onDragOver = (event: DragEvent) => {
    if (mode !== 'inspect') return;
    event.preventDefault();
    pointer = { x: event.clientX, y: event.clientY };
    drop = computeDrop(event.clientX, event.clientY, event.altKey, { name: 'Composant' });
    if (event.dataTransfer) event.dataTransfer.dropEffect = drop?.valid ? 'copy' : 'none';
    draw();
  };
  const onDragLeave = (event: DragEvent) => {
    if (!event.relatedTarget) endDrag();
  };
  const onDrop = (event: DragEvent) => {
    if (mode !== 'inspect') return;
    event.preventDefault();
    if (drop?.valid) post({ type: 'drop', kind: 'component', from: null, target: { loc: drop.loc, name: drop.name }, position: drop.position });
    endDrag();
  };

  const onMove = (event: MouseEvent) => {
    if (mode !== 'inspect' || drag?.active) return;
    const fiber = fiberAtEvent(event);
    const loc = fiber ? parseTag(tagOf(fiber)!)?.loc ?? null : null;
    if (loc !== hovered) {
      hovered = loc;
      draw();
    }
  };

  const onLeave = () => {
    hovered = null;
    draw();
  };

  // En mode inspection, on bloque les interactions de l'app (boutons, navigation…).
  const block = (event: Event) => {
    if (mode !== 'inspect') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'pointerdown' && (event as PointerEvent).button === 0) {
      const e = event as PointerEvent;
      const fiber = pickAt(e.clientX, e.clientY, e.altKey ? 'exact' : 'level');
      const tag = fiber ? parseTag(tagOf(fiber)!) : null;
      drag = fiber && tag ? { fiber, loc: tag.loc, name: tag.name, x: e.clientX, y: e.clientY, active: false } : null;
    }
    if (event.type === 'pointerup' && drag) {
      if (drag.active) {
        suppressClick = true;
        if (drop?.valid) post({ type: 'drop', kind: 'move', from: { loc: drag.loc, name: drag.name }, target: { loc: drop.loc, name: drop.name }, position: drop.position });
      }
      endDrag();
    }
    if (event.type === 'click' || event.type === 'dblclick') {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      // Comme dans Figma : clic = l'élément tel qu'il est écrit dans l'écran (ou au niveau où l'on
      // est déjà entré), double-clic = un niveau plus profond, Alt+clic = l'élément exact.
      const e = event as MouseEvent;
      const fiber = pickAt(e.clientX, e.clientY, e.altKey ? 'exact' : event.type === 'dblclick' ? 'deeper' : 'level');
      const r = root();
      if (fiber && r) {
        const info = selectionInfo(fiber, r);
        if (info) {
          selected = info.loc;
          remember(fiber);
          draw();
          post({ type: 'select', selection: info });
        }
      }
    }
  };

  const BLOCKED = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'dblclick', 'contextmenu'] as const;
  for (const type of BLOCKED) window.addEventListener(type, block, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('dragover', onDragOver, true);
  window.addEventListener('dragleave', onDragLeave, true);
  window.addEventListener('drop', onDrop, true);
  document.addEventListener('mouseleave', onLeave);

  // Les raccourcis de l'éditeur doivent marcher même quand le focus est dans l'écran.
  const onKey = (event: KeyboardEvent) => {
    // Zoom du canevas (⌘/Ctrl + / - / 0) : dans tous les modes, et jamais le zoom du navigateur.
    if ((event.metaKey || event.ctrlKey) && ['=', '+', '-', '0'].includes(event.key)) {
      event.preventDefault();
      post({ type: 'key', key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey });
      return;
    }
    if (mode !== 'inspect') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
    const combo = event.metaKey || event.ctrlKey;
    const relayed = combo ? ['z', 'y', 'd'].includes(event.key.toLowerCase()) : ['Delete', 'Backspace', 'Escape', 'v', 'i'].includes(event.key);
    if (!relayed) return;
    event.preventDefault();
    post({ type: 'key', key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey });
  };
  window.addEventListener('keydown', onKey, true);

  // ⌘/Ctrl + molette (et pincement du trackpad) zoome le canevas, même au-dessus d'un écran.
  const onWheel = (event: WheelEvent) => {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    post({ type: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY, x: event.clientX, y: event.clientY, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
  };
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });

  const onMessage = (event: MessageEvent<EditorMessage>) => {
    const data = event.data;
    if (event.source !== window.parent || data?.source !== 'rn-canvas-editor') return;
    if (data.type === 'mode') {
      mode = data.mode;
      hovered = null;
      draw();
    } else if (data.type === 'select') {
      select(data.loc, data.name);
    } else if (data.type === 'snapshot') {
      const storage: Record<string, string> = {};
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i)!;
          storage[key] = window.localStorage.getItem(key) ?? '';
        }
      } catch {
        // Stockage indisponible : variante sans données.
      }
      post({ type: 'snapshot', requestId: data.requestId, storage });
    } else if (data.type === 'measure') {
      post({ type: 'measured', requestId: data.requestId, rects: measure(new Set(data.locs)), viewport: { width: window.innerWidth, height: window.innerHeight } });
    } else if (data.type === 'hover') {
      hovered = data.loc;
      draw();
    }
  };
  window.addEventListener('message', onMessage);

  // Rendu modifié (Fast Refresh, état, défilement) : on met à jour calques et surbrillances.
  let frame = 0;
  const refresh = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      sendTree();
      if (pending) select(pending.loc, pending.name);
      draw();
    });
  };
  const observer = new MutationObserver((mutations) => {
    if (mutations.every((m) => overlay.contains(m.target))) return;
    refresh();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  window.addEventListener('scroll', draw, true);
  window.addEventListener('resize', draw);
  // Le Fast Refresh peut changer les emplacements (__rnc) sans toucher au DOM : vérification régulière.
  const poll = window.setInterval(refresh, 1000);

  post({ type: 'ready' });
  refresh();

  return {
    stop() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.clearInterval(poll);
      for (const type of BLOCKED) window.removeEventListener(type, block, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('drop', onDrop, true);
      document.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('scroll', draw, true);
      window.removeEventListener('resize', draw);
      overlay.remove();
    },
    reportError(error: Error) {
      post({ type: 'error', message: error.message });
    },
  };
}
