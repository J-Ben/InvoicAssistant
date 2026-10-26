import { useCallback, useEffect, useRef, useState } from 'react';

const LOCK = 'rn-canvas:editor';
const CHANNEL = 'rn-canvas:editor';

/**
 * `owner` : cet onglet affiche les écrans ; `elsewhere` : un autre onglet de l'éditeur les affiche.
 * Un écran a la même adresse (donc la même base SQLite / OPFS) dans tous les onglets : deux onglets
 * ouverts à la fois se disputeraient les bases, et le second échouerait sur chaque écran.
 */
export type TabState = 'checking' | 'owner' | 'elsewhere';

/** Un seul onglet de l'éditeur affiche les écrans ; un autre peut reprendre la main (« Utiliser cet onglet »). */
export function useEditorTab(): { state: TabState; takeOver: () => void } {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const [state, setState] = useState<TabState>(locks ? 'checking' : 'owner');
  const release = useRef<(() => void) | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  const hold = useCallback((lock: Lock | null) => {
    if (!lock) {
      setState('elsewhere');
      return undefined;
    }
    setState('owner');
    // Le verrou reste tenu jusqu'à ce qu'un autre onglet le demande.
    return new Promise<void>((resolve) => {
      release.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (!locks) return;
    const bc = new BroadcastChannel(CHANNEL);
    channel.current = bc;
    bc.onmessage = (event) => {
      if (event.data !== 'take-over' || !release.current) return;
      // Les iframes doivent disparaître (et fermer leurs bases) avant de rendre le verrou.
      setState('elsewhere');
      const done = release.current;
      release.current = null;
      setTimeout(done, 300);
    };
    locks.request(LOCK, { ifAvailable: true }, hold).catch(() => setState('owner'));
    return () => {
      bc.close();
      release.current?.();
    };
  }, [locks, hold]);

  const takeOver = useCallback(() => {
    if (!locks) return;
    setState('checking');
    channel.current?.postMessage('take-over');
    locks.request(LOCK, hold).catch(() => setState('owner'));
  }, [locks, hold]);

  return { state, takeOver };
}
