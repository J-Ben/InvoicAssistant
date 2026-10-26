import { type ReactNode, createElement as h, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

/**
 * Prépare des données avant d'afficher l'écran d'une variante (remplir une base, un store…).
 * À utiliser dans le `wrapper` d'une story, là où les hooks de l'app sont disponibles :
 *
 *   wrapper: ({ children }) => {
 *     const di = useDI();
 *     return <CanvasSeed run={() => seedBudget(di)}>{children}</CanvasSeed>;
 *   }
 *
 * `run` n'est exécuté qu'une fois par chargement de l'écran.
 */
export function CanvasSeed({ run, children }: { run: () => Promise<unknown> | unknown; children?: ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; error: Error | null }>({ ready: false, error: null });

  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(run)
      .then(
        () => alive && setState({ ready: true, error: null }),
        (error: unknown) => alive && setState({ ready: false, error: error instanceof Error ? error : new Error(String(error)) }),
      );
    return () => {
      alive = false;
    };
    // `run` change à chaque rendu du wrapper : on ne prépare qu'une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.error) {
    return h(View, { style: styles.center }, h(Text, { style: styles.error }, `Préparation des données impossible : ${state.error.message}`));
  }
  if (!state.ready) return h(View, { style: styles.center }, h(ActivityIndicator, null));
  return children ?? null;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#B42318', fontSize: 13, textAlign: 'center' },
});
