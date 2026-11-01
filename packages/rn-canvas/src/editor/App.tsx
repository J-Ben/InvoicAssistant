import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasMode, ComponentEntry, EditValue, StyleTarget, EditorMessage, EditRequest, FlowLink, HistoryState, InsertPosition, InspectResult, LayerNode, Payload, ProjectInfo, Rect, RuntimeMessage, SelectionInfo, SnapshotStatus, CreateInfo, SnippetRequest } from '../shared/protocol.ts';
import { api } from './api.ts';
import { Canvas, DEVICES, TOOL_KEY, TOPBAR_BOARD_SLOT, readTool, type Device, type LoadState, type Tool } from './Canvas.tsx';
import { SNIPPET_ROOT, parseLoc } from '../shared/protocol.ts';
import { useEditorTab } from './tab.ts';
import { ContextMenu } from './ContextMenu.tsx';
import { Inspector } from './Inspector.tsx';
import { CONTAINERS, Sidebar, takeDraggedComponent, SEARCH_INPUT_ID, SIDEBAR_TAB_EVENT } from './Sidebar.tsx';
import { LibraryBar } from './LibraryBar.tsx';
import { PagesBar, useBoard } from './Pages.tsx';
import { BranchMenu } from './BranchMenu.tsx';
import { MemoryBadge } from './MemoryBadge.tsx';
import { SelectionToolbar } from './SelectionToolbar.tsx';
import { defaultTarget, mergedStyle, styleEntries } from './styleModel.ts';
import { type InstanceScope, numberOf, type Styleless } from './fields.tsx';
import type { FlowMode } from './Flows.tsx';
import { DisplayMenu, useDisplay } from './display.tsx';
import { CreateDialog, type Placement } from './CreateDialog.tsx';

type ThemePref = 'system' | 'light' | 'dark';
export type Restack = 'front' | 'forward' | 'backward' | 'back';
/** Version et date de construction, injectées par build.mjs. */
declare const __RNC_BUILD__: string | undefined;

const THEME_KEY = 'rn-canvas:theme';
const THEME_LABEL: Record<ThemePref, string> = { system: 'Système', light: 'Clair', dark: 'Sombre' };
const THEME_ICON: Record<ThemePref, string> = { system: '◐', light: '☀', dark: '☾' };
/**
 * Délai après lequel un écran prêt mais toujours vide est considéré comme chargé (rendu null,
 * redirection…). Long : plusieurs écrans qui ouvrent leur base en parallèle peuvent mettre 30 s.
 */
const LOAD_GRACE = 60000;
/** Base de l'écran encore tenue par une page qui se ferme (rechargement, autre onglet) : on réessaie. */
const STORAGE_BUSY = /createSyncAccessHandle|Access Handles? cannot be created|NoModificationAllowedError/i;
const BUSY_RETRIES = 3;
const GENERATIONS_KEY = 'rn-canvas:generations';

function readGenerations(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(GENERATIONS_KEY) ?? '{}');
  } catch {
    return {};
  }
}
const STRUCTURAL = new Set<EditRequest['op']>(['remove', 'duplicate', 'move', 'insert', 'insertSnippet']);

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export interface Selection {
  story: string;
  info: SelectionInfo;
  inspect: InspectResult | null;
  error: string | null;
}

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<CanvasMode>('inspect');
  // Outil du canevas (Sélection, Main) : avec le mode, il forme les trois outils de la barre du haut.
  const [tool, setToolState] = useState<Tool>(readTool);
  const setTool = useCallback((next: Tool) => {
    setToolState(next);
    if (next === 'hand') setMode('inspect');
    try {
      localStorage.setItem(TOOL_KEY, next);
    } catch {
      // Stockage indisponible : l'outil vaut pour la session.
    }
  }, []);
  const [display, setDisplay, resetDisplay] = useDisplay();
  const [device, setDevice] = useState<Device>(() => DEVICES.find((d) => d.id === 'iphone-15') ?? DEVICES[0]);
  const [trees, setTrees] = useState<Record<string, LayerNode[]>>({});
  const [storyErrors, setStoryErrors] = useState<Record<string, string>>({});
  // Appels réseau coupés par écran (hôtes distincts), affichés sur son cadre.
  const [blocked, setBlocked] = useState<Record<string, { count: number; hosts: string[] }>>({});
  const [loaded, setLoaded] = useState<Record<string, LoadState>>({});
  const markLoaded = useCallback((id: string, state: LoadState) => setLoaded((l) => (l[id] === 'shown' || l[id] === state ? l : { ...l, [id]: state })), []);
  const [activeStory, setActiveStory] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [toast, setToast] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [themePref, setThemePref] = useState<ThemePref>(readThemePref);
  const [history, setHistory] = useState<HistoryState>({ undo: null, redo: null });
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const busyRetries = useRef(new Map<string, number>());
  const graceTimers = useRef(new Map<string, number>());
  // Nouvel essai d'un écran (rechargement, stockage neuf) : il repasse « en chargement ».
  const resetLoad = useCallback((id: string) => {
    window.clearTimeout(graceTimers.current.get(id));
    graceTimers.current.delete(id);
    setLoaded(({ [id]: _, ...rest }) => rest);
  }, []);
  // Écrans passés sur un stockage neuf ; mémorisé pour retrouver leurs données à la session suivante.
  const [generations, setGenerations] = useState<Record<string, number>>(readGenerations);
  const nextGeneration = useCallback((id: string) => {
    setGenerations((g) => {
      const next = { ...g, [id]: (g[id] ?? 0) + 1 };
      try {
        localStorage.setItem(GENERATIONS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  const tab = useEditorTab();
  // Écrans (re)montés quand cet onglet prend la main : on repart d'un état de chargement propre.
  useEffect(() => {
    if (tab.state !== 'owner') return;
    setLoaded({});
    setStoryErrors({});
    busyRetries.current.clear();
  }, [tab.state]);
  // Mode Flux : liens de navigation lus dans le code et position de leurs boutons dans chaque écran.
  const [showFlows, setShowFlows] = useState(false);
  // Menu du clic droit (écran ou calques), sur l'élément sélectionné.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [flows, setFlows] = useState<FlowLink[]>([]);
  const [flowRects, setFlowRects] = useState<Record<string, Record<string, Rect>>>({});
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Captures des écrans (moteur du serveur) pour l'appareil affiché.
  const [snapStatus, setSnapStatus] = useState<SnapshotStatus | null>(null);
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const snapTimer = useRef<number | undefined>(undefined);
  const loadSnapshots = useCallback((delay = 0) => {
    window.clearTimeout(snapTimer.current);
    snapTimer.current = window.setTimeout(() => {
      const { width, height } = deviceRef.current;
      api.snapshots(width, height).then(setSnapStatus, () => setSnapStatus(null));
    }, delay);
  }, []);
  useEffect(() => loadSnapshots(), [device, loadSnapshots]);
  const priorityTimer = useRef<number | undefined>(undefined);
  const prioritize = useCallback((ids: string[]) => {
    window.clearTimeout(priorityTimer.current);
    priorityTimer.current = window.setTimeout(() => {
      const { width, height } = deviceRef.current;
      api.snapshotPriority(width, height, ids).catch(() => {});
    }, 200);
  }, []);
  // Écrans en boucle de rendu (signalés par le runtime) : démontés jusqu'à une nouvelle sélection.
  const [looping, setLooping] = useState<Set<string>>(new Set());
  const activate = useCallback((id: string) => {
    setLooping((l) => (l.has(id) ? new Set([...l].filter((x) => x !== id)) : l));
    setActiveStory(id);
  }, []);

  const loadProject = useCallback(() => {
    api
      .project()
      .then((p) => {
        setProject(p);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    api.history().then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    loadProject();
    const stop = api.events((type) => {
      if (type === 'stories') loadProject();
      // Une capture faite ou en cours : état relu (regroupé, pour ne pas relire à chaque image).
      loadSnapshots(type === 'stories' ? 0 : 250);
    });
    window.addEventListener('focus', loadProject);
    return () => {
      stop();
      window.removeEventListener('focus', loadProject);
    };
  }, [loadProject, loadSnapshots]);

  const stories = useMemo(() => project?.stories.flatMap((g) => g.stories) ?? [], [project]);
  // Pages : la vue d'ensemble montre les écrans cochés, un parcours ceux qu'il reprend (dans son ordre).
  const boardState = useBoard(project?.appUrl ?? null, (text) => setToast({ kind: 'error', text }));
  const { board, page } = boardState;
  const [flowMode, setFlowMode] = useState<FlowMode>('all');
  // Routes d'expo-router sans écran : proposées dans l'onglet Écrans.
  const [missingRoutes, setMissingRoutes] = useState<{ file: string; title: string }[]>([]);
  useEffect(() => {
    if (project) api.missingRoutes().then(setMissingRoutes, () => setMissingRoutes([]));
  }, [project]);
  const generateRoutes = async () => {
    try {
      const { created } = await api.generateRoutes();
      setToast({ kind: 'ok', text: `${created.length} écran(s) créé(s) dans ${created[0]?.split('/').slice(0, -1).join('/') ?? 'canvas'}` });
      loadProject();
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    }
  };
  const visible = useMemo(
    () =>
      page?.stories
        ? page.stories.map((id) => stories.find((s) => s.id === id)).filter((s): s is (typeof stories)[number] => Boolean(s))
        : stories.filter((s) => !hidden.has(s.id)),
    [page, stories, hidden],
  );
  // Écrans non affichés sur la page (cases décochées de la liste).
  const pageHidden = useMemo(() => (page?.stories ? new Set(stories.filter((s) => !page.stories!.includes(s.id)).map((s) => s.id)) : hidden), [page, stories, hidden]);

  const send = useCallback((story: string | null, message: Payload<EditorMessage>) => {
    const payload = { source: 'rn-canvas-editor', ...message };
    for (const [id, frame] of frames.current) {
      if (story === null || id === story) frame.contentWindow?.postMessage(payload, '*');
    }
  }, []);

  const showError = (text: string) => setToast({ kind: 'error', text });

  // Liens relus à l'activation, et après chaque modification du code ou de la liste des écrans.
  useEffect(() => {
    if (!showFlows) return;
    api.flows().then(setFlows, (e: Error) => setToast({ kind: 'error', text: e.message }));
  }, [showFlows, project, history]);

  // Les boutons bougent (défilement, chargement des données) : position redemandée régulièrement.
  useEffect(() => {
    if (!showFlows) return;
    const locs = [...new Set(flows.map((link) => link.loc).filter((loc): loc is string => loc !== null))];
    const measure = () => send(null, { type: 'measure', requestId: 0, locs });
    measure();
    const timer = window.setInterval(measure, 1500);
    return () => window.clearInterval(timer);
  }, [showFlows, flows, send]);

  // Chaque analyse porte un numéro : une réponse arrivée après une plus récente (ou après une édition) est ignorée.
  const inspectSeq = useRef(0);
  const inspect = useCallback(async (story: string, info: SelectionInfo) => {
    const seq = ++inspectSeq.current;
    // Même élément (resélection après Fast Refresh) : on garde l'affichage pendant la mise à jour.
    setSelection((s) => (s && s.info.loc === info.loc ? { ...s, story, info } : { story, info, inspect: null, error: null }));
    try {
      const result = await api.inspect(info.loc, info.name);
      if (seq === inspectSeq.current) setSelection((s) => (s ? { ...s, inspect: result, error: null } : s));
    } catch (e) {
      if (seq === inspectSeq.current) setSelection((s) => (s ? { ...s, error: (e as Error).message } : s));
    }
  }, []);

  // Messages des écrans (iframes).
  useEffect(() => {
    const onMessage = (event: MessageEvent<RuntimeMessage>) => {
      const data = event.data;
      if (data?.source !== 'rn-canvas') return;
      switch (data.type) {
        case 'ready':
          send(data.story, { type: 'mode', mode: modeRef.current });
          setStoryErrors(({ [data.story]: _, ...rest }) => rest);
          // Un écran qui reste vide (rendu null) ne doit pas garder l'indicateur indéfiniment.
          window.clearTimeout(graceTimers.current.get(data.story));
          graceTimers.current.set(data.story, window.setTimeout(() => markLoaded(data.story, 'empty'), LOAD_GRACE));
          break;
        case 'loop':
          setLooping((l) => new Set([...l, data.story]));
          setStoryErrors((e) => ({ ...e, [data.story]: `Boucle de rendu (${data.count} × « Maximum update depth exceeded ») : écran arrêté pour ne pas bloquer le navigateur. Cliquez sur son image pour réessayer.` }));
          resetLoad(data.story);
          break;
        case 'tree':
          setTrees((t) => ({ ...t, [data.story]: data.tree }));
          if (data.tree.length > 0) {
            markLoaded(data.story, 'shown');
            busyRetries.current.delete(data.story);
          }
          break;
        case 'select':
          setActiveStory(data.story);
          for (const id of frames.current.keys()) if (id !== data.story) send(id, { type: 'select', loc: null });
          inspect(data.story, data.selection);
          break;
        case 'error': {
          const attempt = (busyRetries.current.get(data.story) ?? 0) + 1;
          if (STORAGE_BUSY.test(data.message)) {
            busyRetries.current.set(data.story, attempt);
            resetLoad(data.story);
            if (attempt <= BUSY_RETRIES) {
              window.setTimeout(() => {
                const frame = frames.current.get(data.story);
                if (frame) frame.src = frame.src;
              }, 1000 * attempt);
              break;
            }
            // Toujours tenue (ancien onglet, verrou resté bloqué dans le navigateur) : base neuve.
            if (attempt === BUSY_RETRIES + 1) {
              nextGeneration(data.story);
              break;
            }
          }
          setStoryErrors((e) => ({ ...e, [data.story]: data.message }));
          markLoaded(data.story, 'shown');
          break;
        }
        case 'network-blocked': {
          let host = data.url;
          try {
            host = new URL(data.url).host;
          } catch {
            // URL relative ou invalide : affichée telle quelle.
          }
          setBlocked((all) => {
            const hosts = all[data.story]?.hosts ?? [];
            return { ...all, [data.story]: { count: data.count, hosts: hosts.includes(host) ? hosts : [...hosts, host] } };
          });
          break;
        }
        case 'navigate':
          setToast({ kind: 'ok', text: `Navigation ignorée dans le canevas : ${data.action}(${data.href ?? ''})` });
          break;
        case 'measured':
          setFlowRects((all) => (JSON.stringify(all[data.story]) === JSON.stringify(data.rects) ? all : { ...all, [data.story]: data.rects }));
          break;
        case 'snapshot':
          snapshots.current.get(data.requestId)?.(data.storage);
          snapshots.current.delete(data.requestId);
          break;
        case 'drop':
          if (data.kind === 'move' && data.from) {
            editRef.current({ op: 'move', loc: data.from.loc, name: data.from.name, target: data.target.loc, targetName: data.target.name, position: data.position });
          } else if (data.kind === 'component') {
            const component = takeDraggedComponent();
            if (component) editRef.current({ op: 'insert', loc: data.target.loc, name: data.target.name, position: data.position, component });
          }
          break;
        case 'contextmenu': {
          const frame = frames.current.get(data.story);
          if (!frame) break;
          const rect = frame.getBoundingClientRect();
          const scale = rect.width / (frame.offsetWidth || 1);
          setMenu({ x: rect.left + data.x * scale, y: rect.top + data.y * scale });
          break;
        }
        case 'wheel': {
          // Rejoue la molette sur le canevas, au point équivalent de l'éditeur.
          const frame = frames.current.get(data.story);
          const canvas = document.querySelector('main.canvas');
          if (!frame || !canvas) break;
          const rect = frame.getBoundingClientRect();
          const scale = rect.width / (frame.offsetWidth || 1);
          canvas.dispatchEvent(
            new WheelEvent('wheel', { deltaX: data.deltaX, deltaY: data.deltaY, clientX: rect.left + data.x * scale, clientY: rect.top + data.y * scale, metaKey: data.metaKey, ctrlKey: data.ctrlKey, cancelable: true }),
          );
          break;
        }
        case 'style-drag': {
          // Poignée relâchée : une seule écriture, puis l'écran retire son aperçu.
          const current = selectionRef.current;
          if (!current || current.info.loc !== data.loc) {
            send(data.story, { type: 'style-applied', ok: false });
            break;
          }
          const written = data.more?.length
            ? writeStylesRef.current([{ key: data.key, value: data.value }, ...data.more].map((e) => ({ key: e.key, value: { kind: 'literal' as const, value: e.value } })))
            : writeStyleRef.current(data.key, { kind: 'literal', value: data.value });
          written.then((ok) => send(data.story, { type: 'style-applied', ok }));
          break;
        }
        case 'text-edit': {
          const current = selectionRef.current;
          if (current?.info.loc === data.loc) editRef.current({ op: 'setText', loc: data.loc, name: current.info.name, value: data.value });
          break;
        }
        case 'selection-rect':
          setSelectionRect({ story: data.story, loc: data.loc, rect: data.rect });
          break;
        case 'key':
          // Rejoue le raccourci dans l'éditeur, comme s'il avait été tapé ici.
          window.dispatchEvent(new KeyboardEvent('keydown', { key: data.key, code: data.code, metaKey: data.metaKey, ctrlKey: data.ctrlKey, shiftKey: data.shiftKey, altKey: data.altKey }));
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [inspect, send]);

  useEffect(() => send(null, { type: 'mode', mode }), [mode, send]);

  useEffect(() => {
    const root = document.documentElement;
    if (themePref === 'system') delete root.dataset.theme;
    else root.dataset.theme = themePref;
    try {
      localStorage.setItem(THEME_KEY, themePref);
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la session.
    }
  }, [themePref]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') {
        setSelection(null);
        send(null, { type: 'select', loc: null });
      } else if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        // ⌘\ : masquer les deux panneaux pour ne garder que les écrans (ou les réafficher).
        e.preventDefault();
        const show = !(displayRef.current.leftPanel || displayRef.current.rightPanel);
        setDisplay('leftPanel', show);
        setDisplay('rightPanel', show);
      } else if ((e.metaKey || e.ctrlKey) && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        // ⌘] / ⌘[ : avancer / reculer d'un plan ; avec ⌥ : premier plan / arrière-plan.
        e.preventDefault();
        const up = e.code === 'BracketRight';
        restackRef.current(e.altKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward');
      } else if (e.key === 'v') setMode('inspect');
      else if (e.key === 'i') {
        setMode('interact');
        setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send, setDisplay]);
  const displayRef = useRef(display);
  displayRef.current = display;
  // ⌘K, Ctrl+K ou « / » : la recherche du panneau de gauche (rouvert s'il était masqué).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (!(((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing))) return;
      e.preventDefault();
      if (!displayRef.current.leftPanel) setDisplay('leftPanel', true);
      window.setTimeout(() => {
        const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
        input?.focus();
        input?.select();
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDisplay]);

  /** Clic dans le vide du canevas : on sort de la sélection (palette, poignées, inspecteur). */
  const clearSelection = useCallback(() => {
    setSelection(null);
    send(null, { type: 'select', loc: null });
  }, [send]);

  const selectLoc = useCallback(
    (story: string, loc: string, name?: string) => {
      setActiveStory(story);
      for (const id of frames.current.keys()) send(id, id === story ? { type: 'select', loc, name } : { type: 'select', loc: null });
    },
    [send],
  );

  const edit = useCallback(
    async (request: EditRequest) => {
      const seq = ++inspectSeq.current;
      try {
        const result = await api.edit(request);
        setHistory(result.history);
        if (request.op === 'setToken' || request.op === 'addStory') {
          loadProject();
        } else if (STRUCTURAL.has(request.op)) {
          // Nouvel élément (ou supprimé) : l'écran le resélectionne dès que le Fast Refresh l'a rendu.
          const story = selection?.story ?? activeStory;
          if (!result.loc) {
            setSelection(null);
            send(null, { type: 'select', loc: null });
          } else if (story) {
            const name = request.op === 'insert' ? request.component.name : request.op === 'insertSnippet' ? SNIPPET_ROOT[request.snippet.kind] : 'name' in request ? request.name : '';
            selectLoc(story, result.loc, name || undefined);
            // Sélection mise à jour tout de suite (nouvel emplacement renvoyé par le serveur) : une action
            // enchaînée avant le rendu de l'écran ne doit pas viser un emplacement périmé.
            inspect(story, { loc: result.loc, name, ancestors: [{ loc: result.loc, name }], rect: null, computed: {} });
          }
          if (request.op === 'insert' || request.op === 'insertSnippet') loadProject();
        } else if (selection && result.loc) {
          const loc = result.loc;
          const fresh = await api.inspect(loc, selection.info.name);
          if (seq === inspectSeq.current) {
            setSelection((s) => (s ? { ...s, info: { ...s.info, loc }, inspect: fresh, error: null } : s));
          }
          // Le Fast Refresh recharge l'écran ; on resélectionne l'élément une fois le rendu à jour.
          send(selection.story, { type: 'select', loc, name: selection.info.name });
        }
        setToast({ kind: 'ok', text: `Écrit dans ${result.file}` });
        return true;
      } catch (e) {
        showError((e as Error).message);
        return false;
      }
    },
    [selection, activeStory, send, selectLoc, loadProject, inspect],
  );

  // Source des styles modifiée, par élément : choisie dans le panneau de droite, partagée avec la barre flottante.
  const [targets, setTargets] = useState<Record<string, StyleTarget>>({});
  const sources = selection?.inspect?.style.sources;
  const chosen = selection?.inspect ? targets[selection.inspect.loc] : undefined;
  const styleTarget: StyleTarget =
    chosen && (chosen.kind === 'instance' || sources?.some((s) => s.ref === chosen.ref)) ? chosen : defaultTarget(sources ?? []);

  /** Écrit une propriété de style de la sélection (et aligne ses variantes plus précises). */
  const writeStyle = useCallback(
    (key: string, value: EditValue) => {
      const target = selection?.inspect;
      if (!selection || !target) return Promise.resolve(false);
      const entries = styleEntries(target, styleTarget, key, value);
      const { loc, name } = selection.info;
      return edit(entries.length > 1 ? { op: 'setStyles', loc, name, entries, target: styleTarget } : { op: 'setStyle', loc, name, key, value: entries[0].value, target: styleTarget });
    },
    [selection, styleTarget, edit],
  );
  const writeStyleRef = useRef(writeStyle);
  writeStyleRef.current = writeStyle;
  // Plusieurs propriétés d'un coup (coin de taille : largeur et hauteur) : une seule modification à annuler.
  const writeStyles = useCallback(
    (values: { key: string; value: EditValue }[]) => {
      const target = selection?.inspect;
      if (!selection || !target) return Promise.resolve(false);
      const entries = values.flatMap((v) => styleEntries(target, styleTarget, v.key, v.value));
      const { loc, name } = selection.info;
      return edit({ op: 'setStyles', loc, name, entries, target: styleTarget });
    },
    [selection, styleTarget, edit],
  );
  const writeStylesRef = useRef(writeStyles);
  writeStylesRef.current = writeStyles;

  // Plans (zIndex) : premier plan / avancer / reculer / arrière-plan, parmi les frères de l'élément.
  const restack = useCallback(
    (how: Restack) => {
      const stack = selection?.info.stack;
      if (!stack || !selection?.inspect?.style.editable) return;
      const { z, min, max } = stack;
      const flat = min === max;
      const next = how === 'forward' ? z + 1 : how === 'backward' ? z - 1 : how === 'front' ? (z < max || flat ? max + 1 : z) : z > min || flat ? min - 1 : z;
      if (next === z) return;
      const loc = selection.info.loc;
      void writeStyle('zIndex', next === 0 ? { kind: 'remove' } : { kind: 'literal', value: next }).then((ok) => {
        // L'écran ne renvoie pas la sélection après l'écriture : le plan suivant part de la nouvelle valeur.
        if (ok) setSelection((s) => (s && s.info.loc === loc ? { ...s, info: { ...s.info, stack: { ...stack, z: next, min: Math.min(min, next), max: Math.max(max, next) } } } : s));
      });
    },
    [selection, writeStyle],
  );
  const restackRef = useRef(restack);
  restackRef.current = restack;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Poignées affichées dans l'écran : selon ce que le code de l'élément permet d'écrire.
  useEffect(() => {
    const target = selection?.inspect;
    if (!selection || !target || target.loc !== selection.info.loc) return;
    // Poignées masquées (menu Affichage) : aucune n'est proposée.
    const editable = target.style.editable && display.handles;
    const merged = mergedStyle(target.style.sources);
    send(selection.story, {
      type: 'handles',
      loc: selection.info.loc,
      handles: {
        radius: editable,
        padding: editable,
        margin: editable,
        gap: editable,
        // Taille : sur tout élément qui n'est pas un texte, même sans largeur ni hauteur écrites (une carte
        // posée sans taille n'avait aucune poignée de taille, et l'on tirait à la place celle de la marge).
        width: editable && (merged.has('width') || !target.text),
        height: editable && (merged.has('height') || !target.text),
        text: display.handles && Boolean(target.text?.editable),
        fontSize: editable && Boolean(target.text),
      },
    });
  }, [selection, send, display.handles]);

  // Position de la sélection dans son écran, pour la barre flottante.
  const [selectionRect, setSelectionRect] = useState<{ story: string; loc: string; rect: Rect | null } | null>(null);

  // Variante depuis l'état d'un écran : on demande son stockage, puis on l'écrit dans le fichier canvas.
  const snapshots = useRef(new Map<number, (storage: Record<string, string>) => void>());
  const saveVariant = useCallback(
    async (storyId: string, exportName: string) => {
      const story = stories.find((s) => s.id === storyId);
      if (!story) return;
      try {
        const requestId = Date.now();
        const storage = await new Promise<Record<string, string>>((resolve, reject) => {
          snapshots.current.set(requestId, resolve);
          send(storyId, { type: 'snapshot', requestId });
          window.setTimeout(() => snapshots.current.delete(requestId) && reject(new Error("L'écran ne répond pas : rechargez-le et réessayez.")), 3000);
        });
        await edit({ op: 'addStory', file: story.file, base: story.exportName, exportName, storage });
        setHidden((h) => {
          const next = new Set(h);
          next.delete(`${story.file}#${exportName}`);
          return next;
        });
      } catch (e) {
        showError((e as Error).message);
      }
    },
    [stories, send],
  );

  const editRef = useRef(edit);
  editRef.current = edit;

  const travel = useCallback(
    async (direction: 'undo' | 'redo') => {
      ++inspectSeq.current;
      try {
        const result = await (direction === 'undo' ? api.undo() : api.redo());
        setHistory(result.history);
        loadProject();
        const story = selection?.story ?? activeStory;
        if (result.loc && story) selectLoc(story, result.loc);
        else if (!result.loc) {
          setSelection(null);
          send(null, { type: 'select', loc: null });
        }
        setToast({ kind: 'ok', text: `${direction === 'undo' ? 'Annulé' : 'Rétabli'} dans ${result.file}` });
      } catch (e) {
        showError((e as Error).message);
        api.history().then(setHistory).catch(() => {});
      }
    },
    [selection, activeStory, selectLoc, send, loadProject],
  );

  // Barre de la bibliothèque : dans la sélection (conteneur) ou juste après ; sinon dans l'écran actif.
  const rootLayer = activeStory ? trees[activeStory]?.[0] : undefined;
  const insertTarget = selection
    ? { loc: selection.info.loc, name: selection.info.name, position: (CONTAINERS.has(selection.info.name) ? 'inside' : 'after') as InsertPosition }
    : rootLayer
      ? { loc: rootLayer.loc, name: rootLayer.name, position: 'inside' as InsertPosition }
      : null;
  const insertTargetLabel = insertTarget && `${insertTarget.position === 'inside' ? 'dans' : 'après'} <${insertTarget.name}>`;
  // « Ouvrir en grand » : écran du composant créé (ou retrouvé), puis la vue s'y déplace.
  const [reveal, setReveal] = useState<{ id: string; seq: number } | null>(null);
  // Fenêtre « Créer » : conventions du projet lues à l'ouverture (elles suivent le code).
  const [creating, setCreating] = useState<CreateInfo | null>(null);
  // Polices chargées par le projet, proposées pour fontFamily dans l'inspecteur.
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    if (project) api.fonts().then(setFonts, () => setFonts([]));
  }, [project]);
  const [place, setPlace] = useState<{ id: string; mode: Placement; anchor: string | null; seq: number } | null>(null);
  const openCreate = () => api.conventions().then(setCreating, (e: Error) => showError(e.message));
  const openComponentScreen = async (c: ComponentEntry) => {
    if (!c.file) return;
    try {
      const result = await api.componentStory(c.file, c.name);
      setToast({ kind: 'ok', text: result.created ? `Écran créé : ${result.file}` : `Écran de ${c.name}` });
      loadProject();
      setActiveStory(result.story);
      setReveal((r) => ({ id: result.story, seq: (r?.seq ?? 0) + 1 }));
    } catch (e) {
      showError((e as Error).message);
    }
  };

  const insertComponent = (c: ComponentEntry) => {
    if (!insertTarget) return;
    edit({ op: 'insert', loc: insertTarget.loc, name: insertTarget.name, position: insertTarget.position, component: { name: c.name, file: c.file } });
  };
  const insertSnippet = (snippet: SnippetRequest) => {
    if (!insertTarget) return;
    edit({ op: 'insertSnippet', loc: insertTarget.loc, name: insertTarget.name, position: insertTarget.position, snippet });
  };

  // ⌘Z / ⇧⌘Z (ou ⌘Y) : annuler / rétablir. Dans un champ de saisie, on laisse l'annulation du champ.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        e.preventDefault();
        travel(key === 'y' || e.shiftKey ? 'redo' : 'undo');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [travel]);

  // Raccourcis : Suppr pour supprimer, ⌘/Ctrl+D pour dupliquer l'élément sélectionné.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selection || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const { loc, name } = selection.info;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        edit({ op: 'remove', loc, name });
      } else if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        edit({ op: 'duplicate', loc, name });
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.metaKey || e.ctrlKey || e.altKey) && selection.inspect?.style.editable) {
        // ⌘/Ctrl + ↑/↓ : marge intérieure (padding), Alt + ↑/↓ : marge extérieure ; de 4 en 4 (Maj : 1).
        e.preventDefault();
        const key = e.altKey ? 'margin' : 'padding';
        const written = numberOf(String((mergedStyle(selection.inspect.style.sources).get(key)?.value.value ?? '')));
        const current = written ?? numberOf(selection.info.computed[`${key}Top`]) ?? 0;
        const next = current + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 4);
        writeStyle(key, { kind: 'literal', value: key === 'padding' ? Math.max(0, next) : next });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, edit, writeStyle]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Palette contextuelle : en haut du panneau de droite quand il est ouvert, sinon à côté de l'écran.
  // Instance d'un composant du projet sans prop `style` : ses réglages de style seraient sans effet.
  const styleless = useMemo<Styleless | null>(() => {
    const name = selection?.inspect?.name;
    const matches = name && project ? project.components.filter((c) => c.file && c.name === name) : [];
    if (matches.length !== 1 || matches[0].acceptsStyle !== false) return null;
    const entry = matches[0];
    return {
      name: entry.name,
      onAdd: () => {
        void Promise.resolve(edit({ op: 'addStyleProp', file: entry.file!, name: entry.name })).then(loadProject);
      },
    };
  }, [selection?.inspect?.name, project, edit, loadProject]);

  // Élément d'un composant du projet : bascule entre l'instance (dans l'écran) et sa définition.
  const instanceScope = useMemo<InstanceScope | null>(() => {
    if (!selection?.inspect || !project) return null;
    const { info, story } = selection;
    const fileOf = (loc: string) => loc.split(':')[0];
    const screenFile = fileOf(info.ancestors[info.ancestors.length - 1]?.loc ?? info.loc);
    if (fileOf(info.loc) !== screenFile) {
      // Dans la définition : l'instance est le premier ancêtre écrit dans l'écran.
      const instance = info.ancestors.slice(1).find((a) => fileOf(a.loc) === screenFile);
      if (!instance) return null;
      return { component: instance.name, file: fileOf(info.loc), scope: 'all', onInstance: () => selectLoc(story, instance.loc), onAll: () => {} };
    }
    // Sur l'instance : la définition commence au premier calque écrit dans le fichier du composant.
    const entries = project.components.filter((c) => c.file && c.name === info.name);
    if (entries.length !== 1) return null;
    const file = entries[0].file!;
    const find = (nodes: LayerNode[]): LayerNode | null => {
      for (const n of nodes) if (n.loc === info.loc) return n; else { const f = find(n.children); if (f) return f; }
      return null;
    };
    const first = (n: LayerNode): LayerNode | null => {
      for (const c of n.children) if (fileOf(c.loc) === file) return c; else { const f = first(c); if (f) return f; }
      return null;
    };
    const node = find(trees[story] ?? []);
    const definition = node && first(node);
    if (!definition) return null;
    return { component: info.name, file, scope: 'instance', onInstance: () => {}, onAll: () => selectLoc(story, definition.loc) };
  }, [selection, project, trees, selectLoc]);

  // Inspecteur complet : panneau de droite, ou déplié dans la palette quand ce panneau est fermé.
  const inspector = (embedded: boolean) => (
    <Inspector
      embedded={embedded}
      styleless={styleless}
      instanceScope={instanceScope}
      fonts={fonts}
      selection={selection}
      palette={!embedded && paletteVisible ? palette(true) : null}
      liveRect={selection && selectionRect?.story === selection.story && selectionRect.loc === selection.info.loc ? selectionRect.rect : null}
      theme={project!.theme}
      root={project!.root}
      onSelectAncestor={(loc) => selection && selectLoc(selection.story, loc)}
      onEdit={edit}
      target={styleTarget}
      onTarget={(t) => selection?.inspect && setTargets((all) => ({ ...all, [selection.inspect!.loc]: t }))}
    />
  );

  const palette = (docked: boolean) =>
    selection?.inspect && selectionRect?.rect ? (
      <SelectionToolbar
        docked={docked}
        onRestack={restack}
        styleless={styleless}
        instanceScope={instanceScope}
        selection={selection}
        rect={selectionRect.rect}
        frame={frames.current.get(selection.story)!}
        theme={project?.theme ?? null}
        target={styleTarget}
        onEdit={edit}
        onStyle={(key, value) => writeStyle(key, value)}
        onMore={() => document.getElementById('inspector-style')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        more={docked ? undefined : inspector(true)}
        onOpenPanel={docked ? undefined : () => setDisplay('rightPanel', true)}
      />
    ) : null;

  // Palette contextuelle de la sélection (mode Sélection).
  const paletteVisible = Boolean(
    display.palette &&
    mode === 'inspect' &&
      tab.state === 'owner' &&
      selection?.inspect &&
      selectionRect?.rect &&
      selectionRect.story === selection.story &&
      selectionRect.loc === selection.info.loc &&
      frames.current.get(selection.story),
  );

  if (loadError) {
    return (
      <div className="empty-state">
        <h1>rn-canvas</h1>
        <p>Impossible de joindre le serveur : {loadError}</p>
      </div>
    );
  }
  if (!project) return <div className="empty-state">Chargement…</div>;

  return (
    <div className="app" style={{ gridTemplateColumns: `${display.leftPanel ? '260px' : '0'} 1fr ${display.rightPanel ? '320px' : '0'}` }}>
      <header className="topbar">
        <div className="topbar-zone left">
          <div className="brand">
            <span className="logo" title="rn-canvas">◆</span> {project.name}
            <span className="build" title="Version de l'éditeur">{typeof __RNC_BUILD__ === 'string' ? __RNC_BUILD__ : 'dev'}</span>
          </div>
          <BranchMenu onError={(text) => setToast({ kind: 'error', text })} />
          {board && page && display.pagesBar && (<PagesBar
            board={board}
            page={page}
            onSelect={boardState.setPageId}
            onAdd={(name) => boardState.addPage(name)}
            onRename={(id, name) => boardState.updatePage(id, (p) => ({ ...p, name }))}
            onRemove={boardState.removePage}
            />
          )}
        </div>
        <div className="topbar-zone center">
          <div className="segmented tools" role="group" aria-label="Outil">
            <button className={mode === 'inspect' && tool === 'select' ? 'on' : ''} onClick={() => (setMode('inspect'), setTool('select'))} title="Sélection (V) : choisir un élément d'un écran, déplacer des écrans" aria-label="Sélection">
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M5 3l14 8-6.2 1.6L9.5 19z" fill="currentColor" /></svg>
            </button>
            <button className={mode === 'inspect' && tool === 'hand' ? 'on' : ''} onClick={() => setTool('hand')} title="Main (H, ou maintenir Espace) : se déplacer sur le canevas" aria-label="Main">
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M8 11V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-.5V6a1.5 1.5 0 013 0v7.5c0 4-2.5 7-6.5 7-3 0-4.6-1.6-6-4l-2.3-4a1.4 1.4 0 012.3-1.6L8 13V8.5a1.5 1.5 0 013 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className={mode === 'interact' ? 'on' : ''} onClick={() => (setMode('interact'), setTool('select'))} title="Interaction (I) : utiliser l'app normalement (taper, naviguer)" aria-label="Interaction">
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M9 11.5V5a1.5 1.5 0 013 0v5.5l4.3.9a2 2 0 011.6 2.2l-.6 4.6A3 3 0 0114.3 21h-3.1a3 3 0 01-2.4-1.2l-3.3-4.4a1.5 1.5 0 012.2-2L9 14.5M6.5 7.5a4 4 0 017.6-1.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {/* Flux : s'allume et s'éteint, sans changer d'outil. */}
            <span className="tools-separator" />
            <button className={`toggle ${showFlows ? 'on' : ''}`} aria-pressed={showFlows} onClick={() => setShowFlows((v) => !v)} title="Flux : afficher les liens de navigation entre écrans" aria-label="Flux">
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><rect x="3" y="4" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="15" y="14" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M9 7h3.5a2.5 2.5 0 012.5 2.5V14m-2.5-2.5L15 14l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          {/* Créer, Groupe, Note : posés ici par le canevas. */}
          <div id={TOPBAR_BOARD_SLOT} className="topbar-board" />
        </div>
        <div className="topbar-zone right">
          <MemoryBadge />
          <DisplayMenu display={display} onChange={setDisplay} onReset={resetDisplay} snapshotsAvailable={Boolean(snapStatus?.engine)} />
          <div className="history" role="group" aria-label="Historique">
            <button aria-label="Annuler" disabled={!history.undo} onClick={() => travel('undo')} title={history.undo ? `Annuler ${history.undo} (⌘Z)` : 'Rien à annuler'}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button aria-label="Rétablir" disabled={!history.redo} onClick={() => travel('redo')} title={history.redo ? `Rétablir ${history.redo} (⇧⌘Z)` : 'Rien à rétablir'}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <button
            className="theme-toggle"
            onClick={() => setThemePref((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'))}
            title={`Thème de l'éditeur : ${THEME_LABEL[themePref]} (clic : changer)`}
            aria-label={`Thème : ${THEME_LABEL[themePref]}`}
          >
            {THEME_ICON[themePref]}
          </button>
          <label className="device" title={`${device.label} : ${device.width} × ${device.height}`}>
            <select value={device.id} onChange={(e) => setDevice(DEVICES.find((d) => d.id === e.target.value)!)} aria-label="Appareil">
              {(['iPhone', 'Android', 'Pliables', 'Tablettes'] as const).map((group) => (
                <optgroup key={group} label={group}>
                  {DEVICES.filter((d) => d.group === group).map((d) => (
                    <option key={d.id} value={d.id} title={`${d.width} × ${d.height}`}>
                      {d.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </header>

      <Sidebar
        open={display.leftPanel}
        onOpenComponent={openComponentScreen}
        onCreate={openCreate}
        onRevealStory={(id) => {
          setActiveStory(id);
          setReveal((r) => ({ id, seq: (r?.seq ?? 0) + 1 }));
        }}
        onLayerContextMenu={(loc, x, y) => {
          if (!activeStory) return;
          selectLoc(activeStory, loc);
          setMenu({ x, y });
        }}
        project={project}
        hidden={pageHidden}
        parcours={page?.stories ? page.name : null}
        missingRoutes={missingRoutes}
        onGenerateRoutes={generateRoutes}
        onToggleStory={(id) =>
          page?.stories
            ? boardState.updatePage(page.id, (p) => ({ ...p, stories: p.stories!.includes(id) ? p.stories!.filter((s) => s !== id) : [...p.stories!, id] }))
            : setHidden((h) => {
                const next = new Set(h);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
        }
        activeStory={activeStory}
        onActivateStory={setActiveStory}
        tree={activeStory ? trees[activeStory] ?? [] : []}
        selectedLoc={selection?.story === activeStory ? selection.info.loc : null}
        onSelectLayer={(loc) => activeStory && selectLoc(activeStory, loc)}
        onHoverLayer={(loc) => activeStory && send(activeStory, { type: 'hover', loc })}
        selection={selection}
        onEdit={edit}
        onSaveVariant={saveVariant}
      />

      {tab.state !== 'owner' ? (
        <main className="canvas">
          <div className="canvas-empty">
            {tab.state === 'checking' ? (
              <p>Ouverture des écrans…</p>
            ) : (
              <>
                <h2>L'éditeur est ouvert dans un autre onglet</h2>
                <p>Un seul onglet à la fois peut afficher les écrans : ils partagent les mêmes bases de données.</p>
                <button className="primary-button" onClick={tab.takeOver}>
                  Utiliser cet onglet
                </button>
              </>
            )}
          </div>
        </main>
      ) : !board || !page ? (
        <main className="canvas" />
      ) : (
        <Canvas
          isolate={paletteVisible && !display.rightPanel ? selection!.story : null}
          page={page}
          onChangePage={(update) => boardState.updatePage(page.id, update)}
          onCreateParcours={(name, ids) => {
            boardState.addPage(name, ids);
            setToast({ kind: 'ok', text: `Parcours « ${name} » créé avec ${ids.length} écran(s)` });
          }}
          flowMode={flowMode}
          onFlowMode={setFlowMode}
          appUrl={project.appUrl}
          isolateStories={project.isolateStories}
          stories={visible}
          allStories={stories}
          device={device}
          activeStory={activeStory}
          errors={storyErrors}
          blocked={blocked}
          loaded={loaded}
          generations={generations}
          flows={showFlows ? { links: flows, rects: flowRects } : null}
          reveal={reveal}
          frames={frames.current}
          onActivate={activate}
          onUnload={resetLoad}
          snapshots={
            display.snapshots && snapStatus?.engine
              ? { items: snapStatus.items, queued: snapStatus.queued, running: snapStatus.running, url: (id, version) => api.snapshotUrl(id, device.width, device.height, version) }
              : null
          }
          onVisible={prioritize}
          looping={looping}
          empty={stories.length === 0}
          onBackgroundClick={clearSelection}
          keepLoaded={display.loadAll ? 0 : display.keepLoaded}
          loadAll={display.loadAll}
          showBoardTools={display.boardTools}
          showLabels={display.storyLabels}
          showMinimap={display.minimap}
          tool={tool}
          onToolChange={setTool}
          onCreate={openCreate}
          place={place}
          onHideStories={(ids) =>
            page.stories
              ? boardState.updatePage(page.id, (p) => ({ ...p, stories: p.stories!.filter((s) => !ids.includes(s)) }))
              : setHidden((h) => new Set([...h, ...ids]))
          }
        >
          {display.libraryBar && (
            <LibraryBar
              components={project.components}
              target={insertTargetLabel}
              onInsert={insertComponent}
              onInsertSnippet={insertSnippet}
              onShowComponents={() => {
                if (!displayRef.current.leftPanel) setDisplay('leftPanel', true);
                window.setTimeout(() => window.dispatchEvent(new CustomEvent(SIDEBAR_TAB_EVENT, { detail: 'components' })), 0);
              }}
            />
          )}
        </Canvas>
      )}

      {creating && project && (
        <CreateDialog
          conventions={creating}
          components={project.components}
          activeTitle={activeStory ? (stories.find((s) => s.id === activeStory)?.file.split('/').pop()?.replace(/\.canvas\.\w+$/, '') ?? null) : null}
          onClose={() => setCreating(null)}
          onCreated={(result, placement) => {
            setCreating(null);
            setToast({ kind: 'ok', text: `${result.name} créé : ${result.files.length} fichier(s)` });
            setPlace((p) => ({ id: result.story.id, mode: placement, anchor: activeStory, seq: (p?.seq ?? 0) + 1 }));
            loadProject();
          }}
        />
      )}
      {display.rightPanel && inspector(false)}

      {paletteVisible && !display.rightPanel && palette(false)}

      {menu && selection && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={`<${selection.info.name}>`}
          onClose={() => setMenu(null)}
          items={(() => {
            const { loc, name, ancestors } = selection.info;
            const parsed = parseLoc(loc);
            const copy = (text: string, what: string) =>
              navigator.clipboard.writeText(text).then(
                () => setToast({ kind: 'ok', text: `${what} copié` }),
                () => showError('Copie refusée par le navigateur.'),
              );
            return [
              { label: 'Dupliquer', hint: '⌘D', run: () => edit({ op: 'duplicate', loc, name }) },
              { label: 'Copier le code JSX', disabled: !selection.inspect, run: () => selection.inspect && copy(selection.inspect.source, 'Code JSX') },
              { label: "Copier l'emplacement", run: () => copy(loc, 'Emplacement') },
              {
                label: 'Ouvrir dans VS Code',
                disabled: !parsed,
                run: () => parsed && window.open(`vscode://file/${project.root}/${parsed.file}:${parsed.line}:${parsed.column + 1}`),
              },
              'separator' as const,
              { label: 'Premier plan', hint: '⌥⌘]', disabled: !selection.info.stack, run: () => restack('front') },
              { label: 'Avancer', hint: '⌘]', disabled: !selection.info.stack, run: () => restack('forward') },
              { label: 'Reculer', hint: '⌘[', disabled: !selection.info.stack, run: () => restack('backward') },
              { label: 'Arrière-plan', hint: '⌥⌘[', disabled: !selection.info.stack, run: () => restack('back') },
              'separator' as const,
              { label: 'Sélectionner le parent', disabled: ancestors.length < 2, run: () => ancestors[1] && selectLoc(selection.story, ancestors[1].loc, ancestors[1].name) },
              'separator' as const,
              { label: 'Supprimer', hint: '⌫', danger: true, run: () => edit({ op: 'remove', loc, name }) },
            ];
          })()}
        />
      )}

      <button
        className={`panel-toggle left${display.leftPanel ? '' : ' closed'}`}
        onClick={() => setDisplay('leftPanel', !display.leftPanel)}
        title={display.leftPanel ? 'Masquer le panneau de gauche (⌘\\ : les deux panneaux)' : 'Afficher le panneau de gauche'}
        aria-label={display.leftPanel ? 'Masquer le panneau de gauche' : 'Afficher le panneau de gauche'}
      >
        {display.leftPanel ? '‹' : '›'}
      </button>
      <button
        className={`panel-toggle right${display.rightPanel ? '' : ' closed'}`}
        onClick={() => setDisplay('rightPanel', !display.rightPanel)}
        title={display.rightPanel ? "Masquer l'inspecteur (⌘\\ : les deux panneaux)" : "Afficher l'inspecteur"}
        aria-label={display.rightPanel ? "Masquer l'inspecteur" : "Afficher l'inspecteur"}
      >
        {display.rightPanel ? '›' : '‹'}
      </button>
      {toast && <div className={`toast ${toast.kind}${display.libraryBar ? ' above-library' : ''}`}>{toast.text}</div>}
    </div>
  );
}
