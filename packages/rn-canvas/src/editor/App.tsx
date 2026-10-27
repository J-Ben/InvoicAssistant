import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasMode, ComponentEntry, EditorMessage, EditRequest, FlowLink, HistoryState, InsertPosition, InspectResult, LayerNode, Payload, ProjectInfo, Rect, RuntimeMessage, SelectionInfo } from '../shared/protocol.ts';
import { api } from './api.ts';
import { Canvas, DEVICES, type Device, type LoadState } from './Canvas.tsx';
import { parseLoc } from '../shared/protocol.ts';
import { useEditorTab } from './tab.ts';
import { ContextMenu } from './ContextMenu.tsx';
import { Inspector } from './Inspector.tsx';
import { CONTAINERS, Sidebar, takeDraggedComponent } from './Sidebar.tsx';
import { LibraryBar } from './LibraryBar.tsx';

type ThemePref = 'system' | 'light' | 'dark';
/** Version et date de construction, injectées par build.mjs. */
declare const __RNC_BUILD__: string | undefined;

const THEME_KEY = 'rn-canvas:theme';
const THEME_LABEL: Record<ThemePref, string> = { system: '◐ Système', light: '☀ Clair', dark: '☾ Sombre' };
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
const STRUCTURAL = new Set<EditRequest['op']>(['remove', 'duplicate', 'move', 'insert']);

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
  const [device, setDevice] = useState<Device>(DEVICES[0]);
  const [trees, setTrees] = useState<Record<string, LayerNode[]>>({});
  const [storyErrors, setStoryErrors] = useState<Record<string, string>>({});
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
    const stop = api.events((type) => type === 'stories' && loadProject());
    window.addEventListener('focus', loadProject);
    return () => {
      stop();
      window.removeEventListener('focus', loadProject);
    };
  }, [loadProject]);

  const stories = useMemo(() => project?.stories.flatMap((g) => g.stories) ?? [], [project]);
  const visible = stories.filter((s) => !hidden.has(s.id));

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
        case 'key':
          // Rejoue le raccourci dans l'éditeur, comme s'il avait été tapé ici.
          window.dispatchEvent(new KeyboardEvent('keydown', { key: data.key, metaKey: data.metaKey, ctrlKey: data.ctrlKey, shiftKey: data.shiftKey, altKey: data.altKey }));
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
      } else if (e.key === 'v') setMode('inspect');
      else if (e.key === 'i') setMode('interact');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
            const name = request.op === 'insert' ? request.component.name : 'name' in request ? request.name : '';
            selectLoc(story, result.loc, name || undefined);
            // Sélection mise à jour tout de suite (nouvel emplacement renvoyé par le serveur) : une action
            // enchaînée avant le rendu de l'écran ne doit pas viser un emplacement périmé.
            inspect(story, { loc: result.loc, name, ancestors: [{ loc: result.loc, name }], rect: null, computed: {} });
          }
          if (request.op === 'insert') loadProject();
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
      } catch (e) {
        showError((e as Error).message);
      }
    },
    [selection, activeStory, send, selectLoc, loadProject, inspect],
  );

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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, edit]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

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
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> rn-canvas <span className="muted">/ {project.name}</span>
          <span className="build" title="Version de l'éditeur">{typeof __RNC_BUILD__ === 'string' ? __RNC_BUILD__ : 'dev'}</span>
        </div>
        <div className="segmented" role="group" aria-label="Mode">
          <button className={mode === 'inspect' ? 'on' : ''} onClick={() => setMode('inspect')} title="Sélectionner des éléments (V)">
            Sélection
          </button>
          <button className={mode === 'interact' ? 'on' : ''} onClick={() => setMode('interact')} title="Utiliser l'app normalement (I)">
            Interaction
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Affichage">
          <button className={showFlows ? 'on' : ''} aria-pressed={showFlows} onClick={() => setShowFlows((v) => !v)} title="Afficher les liens de navigation entre écrans">
            ⇢ Flux
          </button>
        </div>
        <div className="history" role="group" aria-label="Historique">
          <button disabled={!history.undo} onClick={() => travel('undo')} title={history.undo ? `Annuler ${history.undo} (⌘Z)` : 'Rien à annuler'}>
            ↶
          </button>
          <button disabled={!history.redo} onClick={() => travel('redo')} title={history.redo ? `Rétablir ${history.redo} (⇧⌘Z)` : 'Rien à rétablir'}>
            ↷
          </button>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setThemePref((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'))}
          title="Thème de l'éditeur"
        >
          {THEME_LABEL[themePref]}
        </button>
        <label className="device">
          <select value={device.id} onChange={(e) => setDevice(DEVICES.find((d) => d.id === e.target.value)!)}>
            {DEVICES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} — {d.width}×{d.height}
              </option>
            ))}
          </select>
        </label>
      </header>

      <Sidebar
        onOpenComponent={openComponentScreen}
        onLayerContextMenu={(loc, x, y) => {
          if (!activeStory) return;
          selectLoc(activeStory, loc);
          setMenu({ x, y });
        }}
        project={project}
        hidden={hidden}
        onToggleStory={(id) =>
          setHidden((h) => {
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
      ) : (
        <Canvas
          appUrl={project.appUrl}
          isolateStories={project.isolateStories}
          stories={visible}
          allStories={stories}
          device={device}
          activeStory={activeStory}
          errors={storyErrors}
          loaded={loaded}
          generations={generations}
          flows={showFlows ? { links: flows, rects: flowRects } : null}
          reveal={reveal}
          frames={frames.current}
          onActivate={setActiveStory}
          empty={stories.length === 0}
        >
          <LibraryBar components={project.components} target={insertTargetLabel} onInsert={insertComponent} onOpenComponent={openComponentScreen} appUrl={project.appUrl} isolateStories={project.isolateStories} />
        </Canvas>
      )}

      <Inspector
        selection={selection}
        theme={project.theme}
        root={project.root}
        onSelectAncestor={(loc) => selection && selectLoc(selection.story, loc)}
        onEdit={edit}
      />

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
              { label: 'Sélectionner le parent', disabled: ancestors.length < 2, run: () => ancestors[1] && selectLoc(selection.story, ancestors[1].loc, ancestors[1].name) },
              'separator' as const,
              { label: 'Supprimer', hint: '⌫', danger: true, run: () => edit({ op: 'remove', loc, name }) },
            ];
          })()}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
