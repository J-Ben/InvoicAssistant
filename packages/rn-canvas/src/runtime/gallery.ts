/**
 * Aperçus de la bibliothèque (`?rnc-gallery`) : les composants demandés par l'éditeur, rendus avec
 * les fournisseurs de l'app et des valeurs d'exemple pour leurs props obligatoires.
 *
 * Écrit sans JSX, comme le reste du runtime (invisible dans l'arbre des calques).
 */
import { Component, type ReactNode, createElement as h, useEffect, useState } from 'react';
import { Pressable, type PressableProps, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { EditorMessage, GalleryItem } from '../shared/protocol';
import { neutralizeRouter } from './CanvasHost';
import type { CanvasManifest } from './types';

const STORY = 'gallery';

/** Composants qui s'affichent par-dessus l'écran (modale, plein écran) : pas d'aperçu dans une vignette. */
const NO_PREVIEW = /(Modal|Sheet|Prompt|Overlay|Splash|Screen|Wizard|Provider|Bubble|Lock)$/;

function post(message: { type: 'gallery-ready' } | { type: 'pick'; key: string }) {
  window.parent?.postMessage({ source: 'rn-canvas', story: STORY, ...message }, '*');
}

/** Valeurs d'exemple, les mêmes que celles écrites à l'insertion (« Label », 0, () => {}…). */
export function sampleProps(item: GalleryItem): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const p of item.props) {
    if (p.name === 'children') continue;
    switch (p.type) {
      case 'string':
        props[p.name] = p.name.charAt(0).toUpperCase() + p.name.slice(1);
        break;
      case 'number':
        props[p.name] = /progress|ratio|percent/i.test(p.name) ? 0.6 : 0;
        break;
      case 'boolean':
        props[p.name] = false;
        break;
      case 'function':
        props[p.name] = () => {};
        break;
      case 'array':
        props[p.name] = [];
        break;
    }
  }
  return props;
}

export function GalleryHost({ loadManifest }: { loadManifest: () => CanvasManifest }) {
  const [manifest] = useState(() => {
    try {
      const loaded = loadManifest();
      // Un composant qui navigue (bouton, carte…) ne doit pas faire sortir le cadre des aperçus.
      if (loaded.router) neutralizeRouter(loaded.router, STORY);
      return loaded;
    } catch {
      return null;
    }
  });
  const [items, setItems] = useState<GalleryItem[]>([]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<EditorMessage>) => {
      if (event.data?.source === 'rn-canvas-editor' && event.data.type === 'gallery') setItems(event.data.items);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'gallery-ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  let content: ReactNode = h(
    ScrollView,
    { contentContainerStyle: styles.grid },
    items.map((item) => h(Cell, { key: item.key, item, load: manifest?.components?.[item.key] })),
  );
  const Wrapper = manifest?.config?.wrapper;
  if (Wrapper) content = h(Wrapper, { story: { id: STORY, parameters: {} }, children: content });
  return h(View, { style: styles.root }, content);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Cell({ item, load }: { item: GalleryItem; load?: () => any }) {
  const [empty, setEmpty] = useState(false);
  // Deux colonnes dans le menu de la barre, une seule dans le panneau latéral (étroit).
  const { width } = useWindowDimensions();
  const cellWidth = Math.min(280, width - 24);
  const missing = item.props.filter((p) => p.type === 'unknown' && p.name !== 'children').map((p) => p.name);

  let preview: ReactNode;
  if (NO_PREVIEW.test(item.name)) preview = h(Placeholder, { text: "S'affiche par-dessus l'écran : pas d'aperçu en vignette." });
  else if (!load) preview = h(Placeholder, { text: 'Relancez « npx rn-canvas generate » pour voir cet aperçu.' });
  else {
    preview = h(
      CellBoundary,
      { missing },
      h(View, { pointerEvents: 'none', onLayout: (e: { nativeEvent: { layout: { height: number } } }) => setEmpty(e.nativeEvent.layout.height < 2) }, h(Render, { load, item })),
      empty ? h(Placeholder, { text: missing.length ? `Rien d'affiché sans données : ${missing.join(', ')}.` : "Rien d'affiché avec les valeurs d'exemple." }) : null,
    );
  }

  return h(
    Pressable,
    {
      onPress: () => post({ type: 'pick', key: item.key }),
      // `hovered` n'existe que sur le web (react-native-web), absent des types React Native.
      style: (({ hovered }: { hovered?: boolean }) => [styles.cell, { width: cellWidth }, hovered && styles.cellHovered]) as unknown as PressableProps['style'],
    },
    h(View, { style: styles.preview }, preview),
    h(Text, { style: styles.name, numberOfLines: 1 }, item.name),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Render({ load, item }: { load: () => any; item: GalleryItem }) {
  const Comp = load();
  if (!Comp) throw new Error(`« ${item.name} » introuvable`);
  const props = sampleProps(item);
  const textLike = /(Text|Typography|Title|Heading)$/.test(item.name);
  return h(Comp, props, textLike ? 'Nouveau texte' : undefined);
}

class CellBoundary extends Component<{ missing: string[]; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { missing } = this.props;
    return h(Placeholder, { text: missing.length ? `Aperçu impossible sans données : ${missing.join(', ')}.` : 'Aperçu impossible avec les valeurs d’exemple.' });
  }
}

function Placeholder({ text }: { text: string }) {
  return h(View, { style: styles.placeholder }, h(Text, { style: styles.placeholderText }, text));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 12 },
  cell: { borderRadius: 10, borderWidth: 1, borderColor: '#e4e4e9', backgroundColor: '#ffffff', overflow: 'hidden', cursor: 'pointer' } as object,
  cellHovered: { borderColor: '#7c5cff' },
  preview: { height: 150, padding: 10, overflow: 'hidden', backgroundColor: '#f6f6f8' },
  name: { paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '600', color: '#1d1d22' },
  placeholder: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center', padding: 12 },
  placeholderText: { fontSize: 11, color: '#7a7a85', textAlign: 'center' },
});
