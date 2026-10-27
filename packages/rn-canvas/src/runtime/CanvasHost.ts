import { Component, type ComponentType, type ReactElement, type ReactNode, createElement as h, useEffect, useState, version } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { startInspector, StoryRoot } from './inspector';
import { RouteParams, setRouteParamsContext } from './params';
import type { CanvasManifest, CanvasMeta, CanvasStoryObject, CanvasWrapperProps } from './types';

interface ResolvedStory {
  render: () => ReactElement;
  wrappers: ComponentType<CanvasWrapperProps>[];
  setups: (() => void | (() => void))[];
  parameters: Record<string, unknown>;
  storage: Record<string, string> | null;
  params: Record<string, string> | null;
}

/** Props de l'exemple `component` (variante `variant`, sinon la première) déclaré dans rn-canvas.config.tsx. */
function exampleProps(manifest: CanvasManifest, component: string | undefined, variant: string | undefined): Record<string, unknown> {
  if (!component) return {};
  const declared = manifest.config?.examples?.[component];
  const list = Array.isArray(declared) ? declared : declared ? [declared] : [];
  const example = (variant && list.find((e) => e.name === variant)) || list[0];
  return example?.props ?? {};
}

/**
 * Rend le composant de l'écran. Les panneaux pilotés par ref (BottomSheetModal de @gorhom, ou un
 * composant qui en expose un via forwardRef) restent fermés tant que personne n'appelle `present()` :
 * on l'appelle au montage pour qu'ils s'affichent ouverts, comme les modales à prop `visible`.
 */
function Presented({ component, props }: { component: ComponentType<any>; props: Record<string, unknown> }) {
  const ref = (instance: unknown) => {
    const present = (instance as { present?: unknown } | null)?.present;
    if (typeof present !== 'function') return;
    const timer = setTimeout(() => present.call(instance), 0);
    return () => clearTimeout(timer);
  };
  return h(component, canTakeRef(component) ? { ...props, ref } : props);
}

/**
 * React 19 passe `ref` comme une prop ordinaire ; React 18 l'interdit sur un composant fonction
 * (avertissement) : seulement forwardRef, memo(forwardRef) et les classes.
 */
function canTakeRef(component: unknown): boolean {
  if (Number(version.split('.')[0]) >= 19) return true;
  const c = component as { $$typeof?: symbol; type?: unknown; prototype?: { isReactComponent?: unknown } } | null;
  if (!c) return false;
  if (c.$$typeof === Symbol.for('react.forward_ref')) return true;
  if (c.$$typeof === Symbol.for('react.memo')) return canTakeRef(c.type);
  return Boolean(c.prototype?.isReactComponent);
}

function resolveStory(storyId: string, manifest: CanvasManifest): ResolvedStory {
  const hash = storyId.lastIndexOf('#');
  const file = storyId.slice(0, hash);
  const exportName = storyId.slice(hash + 1);
  const load = manifest.files[file];
  if (!load) throw new Error(`Fichier canvas inconnu : ${file}. Lancez « npx rn-canvas generate ».`);

  const mod = load();
  const meta: CanvasMeta = mod.default ?? {};
  const story = mod[exportName];
  if (!story) throw new Error(`Export « ${exportName} » introuvable dans ${file}.`);

  const wrappers = [manifest.config?.wrapper, meta.wrapper].filter(Boolean) as ComponentType<CanvasWrapperProps>[];

  if (typeof story === 'function') {
    return { render: () => h(story), wrappers, setups: meta.setup ? [meta.setup] : [], parameters: meta.parameters ?? {}, storage: null, params: meta.params ?? null };
  }

  const s = story as CanvasStoryObject;
  // Ordre : props de l'écran (valeurs de repli), puis exemple déclaré, puis props de la variante.
  const props = { ...meta.props, ...exampleProps(manifest, meta.example, s.example), ...s.props };
  const render = s.render
    ? () => s.render!(props)
    : meta.component
      ? () => h(Presented, { component: meta.component!, props })
      : () => {
          throw new Error(`« ${exportName} » n'a ni render ni component (export par défaut).`);
        };
  return {
    render,
    wrappers: s.wrapper ? [...wrappers, s.wrapper] : wrappers,
    setups: [meta.setup, s.setup].filter(Boolean) as ResolvedStory['setups'],
    parameters: { ...meta.parameters, ...s.parameters },
    storage: s.storage ?? null,
    params: meta.params || s.params ? { ...meta.params, ...s.params } : null,
  };
}

export function CanvasHost({ storyId, loadManifest }: { storyId: string; loadManifest: () => CanvasManifest }) {
  // Résolution + setup synchrones : les stores sont remplis avant le premier rendu de l'écran.
  const [state] = useState(() => {
    try {
      const manifest = loadManifest();
      if (manifest.router) neutralizeRouter(manifest.router, storyId);
      setRouteParamsContext(manifest.routeParams);
      const story = resolveStory(storyId, manifest);
      if (story.storage) restoreStorage(story.storage);
      const cleanups = story.setups.map((setup) => setup());
      return { story, cleanups, error: null as Error | null };
    } catch (error) {
      return { story: null, cleanups: [], error: error as Error };
    }
  });

  useEffect(() => {
    const inspector = startInspector(storyId);
    if (state.error) inspector.reportError(state.error);
    return () => {
      inspector.stop();
      for (const cleanup of state.cleanups) if (typeof cleanup === 'function') cleanup();
    };
  }, [storyId, state]);

  if (!state.story) return h(ErrorView, { error: state.error! });

  const { story } = state;
  let element: ReactNode = h(StoryRoot, null, h(StoryRender, { render: story.render }));
  // Paramètres de route : ceux que l'écran lirait dans l'URL (useLocalSearchParams).
  if (story.params) element = h(RouteParams, { params: story.params }, element);
  for (const Wrapper of [...story.wrappers].reverse()) {
    element = h(Wrapper, { story: { id: storyId, parameters: story.parameters }, children: element });
  }
  return h(ErrorBoundary, { storyId }, h(View, { style: styles.root }, element));
}

const NAVIGATION_METHODS = ['navigate', 'push', 'replace', 'back', 'goBack', 'dismiss', 'dismissAll', 'dismissTo', 'linkTo', 'reload'];

/**
 * Un écran affiché seul ne doit pas naviguer : une redirection (`router.replace` dans un effet)
 * changerait l'URL de l'iframe et la ferait recharger en boucle. La demande est signalée à l'éditeur.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function neutralizeRouter(router: Record<string, any>, storyId: string) {
  // expo-router rebranche ses méthodes (Object.assign) après le premier rendu : des accesseurs
  // dont l'écriture est ignorée gardent la version neutre.
  const pin = (key: string, value: unknown) => Object.defineProperty(router, key, { get: () => value, set: () => {}, configurable: true, enumerable: true });
  for (const action of NAVIGATION_METHODS) {
    pin(action, (target?: unknown) => {
      const href = typeof target === 'string' ? target : target && typeof target === 'object' && 'pathname' in target ? String((target as { pathname: unknown }).pathname) : null;
      window.parent?.postMessage({ source: 'rn-canvas', type: 'navigate', story: storyId, action, href }, '*');
    });
  }
  pin('canGoBack', () => false);
  pin('canDismiss', () => false);
}

/** Remplace le stockage de l'écran par celui de la variante (chaque écran a sa propre origine). */
function restoreStorage(storage: Record<string, string>) {
  try {
    window.localStorage.clear();
    for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible : la variante s'affiche avec l'état par défaut.
  }
}

function StoryRender({ render }: { render: () => ReactElement }) {
  return render();
}

class ErrorBoundary extends Component<{ storyId: string; children?: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    window.parent?.postMessage({ source: 'rn-canvas', type: 'error', story: this.props.storyId, message: error.message }, '*');
  }

  render() {
    return this.state.error ? h(ErrorView, { error: this.state.error }) : this.props.children;
  }
}

function ErrorView({ error }: { error: Error }) {
  return h(
    ScrollView,
    { contentContainerStyle: styles.error },
    h(Text, { style: styles.errorTitle }, "Impossible d'afficher cet écran"),
    h(Text, { style: styles.errorMessage }, error.message),
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  error: { padding: 24, gap: 12 },
  errorTitle: { fontSize: 16, fontWeight: '600', color: '#B42318' },
  errorMessage: { fontSize: 13, color: '#344054', fontFamily: 'monospace' },
});
