/**
 * Aperçus de la bibliothèque (`?rnc-gallery`) : les composants demandés par l'éditeur, rendus avec
 * les fournisseurs de l'app et des valeurs d'exemple pour leurs props obligatoires.
 *
 * Écrit sans JSX, comme le reste du runtime (invisible dans l'arbre des calques).
 */
import { Component, type ReactNode, Suspense, createElement as h, useEffect, useState } from 'react';
import { LogBox, Pressable, type PressableProps, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { EditorMessage, GalleryItem } from '../shared/protocol';
import { neutralizeRouter } from './CanvasHost';
import { blockNetwork } from './network';
import { hasNavigation, NavigationShell, setNavigation } from './navigation';
import type { CanvasManifest, ComponentExample } from './types';

/** Contenu en position absolue (bandeau, pastille) : le conteneur mesure 0 mais quelque chose s'affiche. */
function hasVisibleContent(target: unknown): boolean {
  const el = target as { querySelectorAll?: (selector: string) => ArrayLike<{ getBoundingClientRect(): { width: number; height: number } }> } | null;
  if (!el?.querySelectorAll) return false;
  const all = el.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const rect = all[i].getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) return true;
  }
  return false;
}

const STORY = 'gallery';

/** Composants qui s'affichent par-dessus l'écran (modale, plein écran) : pas d'aperçu dans une vignette. */
const NO_PREVIEW = /(Modal|Sheet|Prompt|Overlay|Splash|Screen|Wizard|Provider|Bubble|Lock|Popup|Popin|Dialog|Drawer|Popover)$/;
/** Prop booléenne qui ouvre le composant : c'est une superposition, quel que soit son nom (`AddNotePanel`). */
const OPEN_PROP = /^(visible|isVisible|open|isOpen|show|isShown|opened)$/;

function isOverlay(item: GalleryItem): boolean {
  return NO_PREVIEW.test(item.name) || item.props.some((p) => p.type === 'boolean' && OPEN_PROP.test(p.name));
}

/**
 * Filet de sécurité : une modale (react-native-web la téléporte dans <body>) qui s'ouvrirait malgré
 * tout dans une vignette recouvrirait toute la grille. Tout ce qui est ajouté à <body> hors de la
 * racine de l'app est masqué dans le cadre des aperçus.
 */
function hidePortals() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const root = document.getElementById('root') ?? document.getElementById('main');
  const hide = (node: Node) => {
    if (node instanceof HTMLElement && node !== root && !node.contains(root) && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') node.style.display = 'none';
  };
  // Déjà présents (modale ouverte avant cet appel) puis ajoutés ensuite.
  document.body.childNodes.forEach(hide);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(hide);
  }).observe(document.body, { childList: true });
}

function post(message: { type: 'gallery-ready' } | { type: 'pick'; key: string } | { type: 'open'; key: string }) {
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
      // React Navigation : un conteneur pour les composants qui appellent useNavigation().
      setNavigation(loaded.router ? null : loaded.navigation, STORY);
      // Les erreurs des composants privés de données sont attendues (vignette « aperçu impossible ») :
      // pas de bandeau d'erreurs de développement par-dessus la grille.
      LogBox.ignoreAllLogs(true);
      // Sur le web, le bandeau d'erreurs d'Expo se nourrit de console.error (où React signale aussi les
      // erreurs rattrapées) : ce cadre ne sert qu'aux aperçus, on ne les y affiche pas.
      console.error = () => {};
      hidePortals();
      if (loaded.config?.network !== 'allow') blockNetwork(STORY);
      return loaded;
    } catch {
      return null;
    }
  });
  // La grille (et sa liste) vit sous les fournisseurs de l'app : certains, mémorisés (SQLiteProvider
  // d'expo-sqlite), ignorent un changement d'enfants venu d'au-dessus, et la liste ne changerait plus.
  const [grid] = useState(() => {
    const element = h(Grid, { components: manifest?.components, examples: manifest?.config?.examples });
    return hasNavigation() ? h(NavigationShell, { params: null, render: () => element }) : element;
  });
  const Wrapper = manifest?.config?.wrapper;
  return h(View, { style: styles.root }, Wrapper ? h(Wrapper, { story: { id: STORY, parameters: {} }, children: grid }) : grid);
}

type Examples = Record<string, ComponentExample | ComponentExample[]>;

/** Exemples déclarés pour un composant (par nom, ou par `fichier#Nom`), ou un seul sans données. */
function examplesOf(item: GalleryItem, examples?: Examples): (ComponentExample | null)[] {
  const declared = examples?.[item.key] ?? examples?.[item.name];
  if (!declared) return [null];
  return Array.isArray(declared) ? declared : [declared];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Grid({ components, examples }: { components?: Record<string, () => any>; examples?: Examples }) {
  const [items, setItems] = useState<GalleryItem[]>([]);

  // Prête une fois montée sous les fournisseurs (polices, base…) : l'éditeur envoie alors la liste.
  useEffect(() => {
    const onMessage = (event: MessageEvent<EditorMessage>) => {
      if (event.data?.source === 'rn-canvas-editor' && event.data.type === 'gallery') setItems(event.data.items);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'gallery-ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return h(
    ScrollView,
    { contentContainerStyle: styles.grid },
    items.flatMap((item) => examplesOf(item, examples).map((example, i) => h(Cell, { key: `${item.key}:${i}`, item, example, load: components?.[item.key] }))),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Cell({ item, example, load }: { item: GalleryItem; example: ComponentExample | null; load?: () => any }) {
  const [empty, setEmpty] = useState(false);
  // Deux colonnes dans le menu de la barre, une seule dans le panneau latéral (étroit).
  const { width } = useWindowDimensions();
  const cellWidth = Math.min(280, width - 24);
  // Données encore manquantes : props obligatoires sans valeur d'exemple générique ni fournie.
  const missing = item.props.filter((p) => p.type === 'unknown' && p.name !== 'children' && !(example?.props && p.name in example.props)).map((p) => p.name);

  let preview: ReactNode;
  if (isOverlay(item)) {
    // Modale, panneau… : affichée par-dessus tout l'écran, elle a besoin d'un écran à elle.
    preview = h(
      View,
      { style: styles.placeholder },
      h(Text, { style: styles.placeholderText }, "S'affiche par-dessus l'écran."),
      h(
        Pressable,
        { onPress: () => post({ type: 'open', key: item.key }), style: styles.openButton, accessibilityRole: 'button' },
        h(Text, { style: styles.openButtonText }, 'Ouvrir en grand'),
      ),
    );
  }
  else if (!load) preview = h(Placeholder, { text: 'Relancez « npx rn-canvas generate » pour voir cet aperçu.' });
  else {
    preview = h(
      CellBoundary,
      { missing },
      // Un composant qui attend des données (suspend) ne doit pas figer toute la grille : sans
      // limite de Suspense, React garderait l'ancienne liste affichée.
      h(
        Suspense,
        { fallback: h(Placeholder, { text: 'Chargement…' }) },
        h(
          View,
          {
            pointerEvents: 'none',
            onLayout: (e: { nativeEvent: { layout: { height: number }; target?: unknown }; target?: unknown }) => {
              if (e.nativeEvent.layout.height >= 2) return setEmpty(false);
              // Hauteur nulle : peut-être un contenu en position absolue, ou qui apparaît en animation.
              const node = e.nativeEvent.target ?? e.target;
              setTimeout(() => setEmpty(!hasVisibleContent(node)), 800);
            },
          },
          h(Render, { load, item, example }),
        ),
      ),
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
    h(Text, { style: styles.name, numberOfLines: 1 }, example?.name ? `${item.name} · ${example.name}` : item.name),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Render({ load, item, example }: { load: () => any; item: GalleryItem; example: ComponentExample | null }) {
  const Comp = load();
  if (!Comp) throw new Error(`« ${item.name} » introuvable`);
  // Exemple déclaré par-dessus les valeurs génériques (« Label », 0, () => {}…).
  const props = { ...sampleProps(item), ...example?.props };
  const textLike = /(Text|Typography|Title|Heading)$/.test(item.name);
  const children = example?.children ?? (textLike ? 'Nouveau texte' : undefined);
  return h(Comp, props, children);
}

class CellBoundary extends Component<{ missing: string[]; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { missing } = this.props;
    return h(Placeholder, {
      text: missing.length
        ? `Aperçu impossible sans données : ${missing.join(', ')}. Ajoutez un exemple dans rn-canvas.config.tsx (examples).`
        : 'Aperçu impossible avec les valeurs d’exemple.',
    });
  }
}

function Placeholder({ text }: { text: string }) {
  return h(View, { style: styles.placeholder }, h(Text, { style: styles.placeholderText }, text));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
  // `flex-start` : chaque vignette garde sa hauteur au lieu de s'étirer sur la plus haute de la rangée.
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, padding: 12 },
  cell: { borderRadius: 10, borderWidth: 1, borderColor: '#e4e4e9', backgroundColor: '#ffffff', overflow: 'hidden', cursor: 'pointer' } as object,
  cellHovered: { borderColor: '#7c5cff' },
  // Hauteur du composant, bornée : un badge reste petit, une carte haute est coupée.
  preview: { minHeight: 48, maxHeight: 280, padding: 10, overflow: 'hidden', backgroundColor: '#f6f6f8' },
  name: { paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '600', color: '#1d1d22' },
  placeholder: { minHeight: 56, alignItems: 'center', justifyContent: 'center', padding: 8 },
  placeholderText: { fontSize: 11, color: '#7a7a85', textAlign: 'center' },
  openButton: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#7c5cff' },
  openButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
});
