import { Component, type ComponentType, type ReactElement, type ReactNode, createElement as h, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { startInspector, StoryRoot } from './inspector';
import type { CanvasManifest, CanvasMeta, CanvasStoryObject, CanvasWrapperProps } from './types';

interface ResolvedStory {
  render: () => ReactElement;
  wrappers: ComponentType<CanvasWrapperProps>[];
  setups: (() => void | (() => void))[];
  parameters: Record<string, unknown>;
  storage: Record<string, string> | null;
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
    return { render: () => h(story), wrappers, setups: meta.setup ? [meta.setup] : [], parameters: meta.parameters ?? {}, storage: null };
  }

  const s = story as CanvasStoryObject;
  const props = { ...meta.props, ...s.props };
  const render = s.render
    ? () => s.render!(props)
    : meta.component
      ? () => h(meta.component!, props)
      : () => {
          throw new Error(`« ${exportName} » n'a ni render ni component (export par défaut).`);
        };
  return {
    render,
    wrappers: s.wrapper ? [...wrappers, s.wrapper] : wrappers,
    setups: [meta.setup, s.setup].filter(Boolean) as ResolvedStory['setups'],
    parameters: { ...meta.parameters, ...s.parameters },
    storage: s.storage ?? null,
  };
}

export function CanvasHost({ storyId, loadManifest }: { storyId: string; loadManifest: () => CanvasManifest }) {
  // Résolution + setup synchrones : les stores sont remplis avant le premier rendu de l'écran.
  const [state] = useState(() => {
    try {
      const story = resolveStory(storyId, loadManifest());
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
  for (const Wrapper of [...story.wrappers].reverse()) {
    element = h(Wrapper, { story: { id: storyId, parameters: story.parameters }, children: element });
  }
  return h(ErrorBoundary, { storyId }, h(View, { style: styles.root }, element));
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
