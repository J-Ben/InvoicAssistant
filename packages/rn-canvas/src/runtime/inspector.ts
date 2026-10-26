/**
 * Inspecteur côté app (web) : relie le DOM rendu par react-native-web aux éléments JSX
 * du code grâce à la prop `__rnc` injectée par le plugin Babel, en lisant l'arbre React.
 *
 * Communication avec l'éditeur parent par `postMessage`.
 */
import { createElement, Fragment, type ReactNode } from 'react';
import type { CanvasMode, EditorMessage, LayerNode, Payload, Rect, RuntimeMessage, SelectionInfo } from '../shared/protocol';
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

  const draw = () => {
    overlay.replaceChildren();
    const r = root();
    if (!r) return;
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

  const select = (loc: string | null, fiber?: Fiber) => {
    selected = loc;
    draw();
    const r = root();
    if (!loc || !r) return;
    const target = fiber ?? fibersAt(r, loc)[0];
    const info = target ? selectionInfo(target, r) : null;
    if (info) post({ type: 'select', selection: info });
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

  const onMove = (event: MouseEvent) => {
    if (mode !== 'inspect') return;
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
    if (event.type === 'click') {
      const fiber = fiberAtEvent(event);
      const r = root();
      if (fiber && r) {
        const info = selectionInfo(fiber, r);
        if (info) {
          selected = info.loc;
          draw();
          post({ type: 'select', selection: info });
        }
      }
    }
  };

  const BLOCKED = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'dblclick', 'contextmenu'] as const;
  for (const type of BLOCKED) window.addEventListener(type, block, true);
  window.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseleave', onLeave);

  const onMessage = (event: MessageEvent<EditorMessage>) => {
    const data = event.data;
    if (event.source !== window.parent || data?.source !== 'rn-canvas-editor') return;
    if (data.type === 'mode') {
      mode = data.mode;
      hovered = null;
      draw();
    } else if (data.type === 'select') {
      select(data.loc);
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

  post({ type: 'ready' });
  refresh();

  return {
    stop() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const type of BLOCKED) window.removeEventListener(type, block, true);
      window.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('scroll', draw, true);
      window.removeEventListener('resize', draw);
      overlay.remove();
    },
    reportError(error: Error) {
      post({ type: 'error', message: error.message });
    },
  };
}
