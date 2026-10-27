import { useEffect, useRef, useState } from 'react';
import { type ComponentEntry, type EditorMessage, GALLERY_PARAM, type GalleryItem, type RuntimeMessage } from '../shared/protocol.ts';

export const componentKey = (c: ComponentEntry) => `${c.file}#${c.name}`;

export type LibraryView = 'previews' | 'list';

/** Affichage des composants (aperçus ou liste), mémorisé dans le navigateur sous `key`. */
export function useLibraryView(key: string): [LibraryView, (view: LibraryView) => void] {
  const [view, setView] = useState<LibraryView>(() => {
    try {
      return localStorage.getItem(key) === 'list' ? 'list' : 'previews';
    } catch {
      return 'previews';
    }
  });
  const choose = (next: LibraryView) => {
    setView(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Préférence non mémorisée.
    }
  };
  return [view, choose];
}

/** Bascule Aperçus / Liste. */
export function ViewToggle({ view, onChange }: { view: LibraryView; onChange: (view: LibraryView) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Affichage des composants">
      <button className={view === 'previews' ? 'on' : ''} onClick={() => onChange('previews')} title="Rendu réel des composants">
        Aperçus
      </button>
      <button className={view === 'list' ? 'on' : ''} onClick={() => onChange('list')} title="Noms et props, à glisser sur un écran">
        Liste
      </button>
    </div>
  );
}

/**
 * URL du cadre des aperçus. Chaque cadre a son sous-domaine (`rnc-bar.localhost`…) : son propre
 * stockage, sans disputer la base SQLite d'un écran ni celle d'un autre cadre d'aperçus.
 */
function galleryUrl(appUrl: string, isolate: boolean, name: string): string {
  const url = new URL(appUrl);
  if (isolate && url.hostname === 'localhost') url.hostname = `rnc-${name}.localhost`;
  url.searchParams.set(GALLERY_PARAM, '1');
  return url.toString();
}

interface Props {
  /** Distingue les cadres (barre, panneau) : un sous-domaine chacun. */
  name: string;
  appUrl: string;
  isolateStories: boolean;
  /** Composants à afficher, dans l'ordre. */
  components: ComponentEntry[];
  onPick: (component: ComponentEntry) => void;
  /** « Ouvrir en grand » (modales, panneaux) : écran dédié dans le canevas. */
  onOpen?: (component: ComponentEntry) => void;
  hidden?: boolean;
  className?: string;
}

/**
 * Aperçus réels des composants (rendus par l'app, avec ses fournisseurs et des valeurs d'exemple).
 * Le cadre reste chargé une fois affiché : seule la liste envoyée change.
 */
export function GalleryFrame({ name, appUrl, isolateStories, components, onPick, onOpen, hidden, className }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const pick = useRef(onPick);
  pick.current = onPick;
  const open = useRef(onOpen);
  open.current = onOpen;
  const list = useRef(components);
  list.current = components;

  useEffect(() => {
    const onMessage = (event: MessageEvent<RuntimeMessage>) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== 'rn-canvas') return;
      if (event.data.type === 'gallery-ready') setReady(true);
      if (event.data.type === 'pick' || event.data.type === 'open') {
        const { type, key } = event.data;
        const c = list.current.find((x) => componentKey(x) === key);
        if (c) (type === 'open' ? open.current : pick.current)?.(c);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const message: EditorMessage = {
      source: 'rn-canvas-editor',
      type: 'gallery',
      items: components.map((c): GalleryItem => ({ key: componentKey(c), name: c.name, props: c.props })),
    };
    frame.current?.contentWindow?.postMessage(message, '*');
  }, [ready, components]);

  return (
    <div className={`library-gallery ${className ?? ''}`} hidden={hidden}>
      <iframe ref={frame} title="Aperçus des composants" src={galleryUrl(appUrl, isolateStories, name)} />
      {!ready && (
        <div className="frame-loading" role="status">
          <span className="spinner" />
          Chargement des aperçus…
        </div>
      )}
    </div>
  );
}
