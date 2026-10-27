import { type Context, type ReactNode, createElement as h, Fragment } from 'react';
import { hasNavigation, NavigationShell } from './navigation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let context: Context<any> | null = null;

/** Contexte des paramètres de route d'expo-router, fourni par le manifeste au démarrage de l'écran. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setRouteParamsContext(value: Context<any> | null | undefined) {
  context = value ?? null;
}

/**
 * Paramètres de route connus seulement au rendu (ex. l'identifiant d'une facture créée par
 * <CanvasSeed>) : `<RouteParams params={{ id }}><Screen /></RouteParams>`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function RouteParams({ params, children }: { params: Record<string, any>; children?: ReactNode }) {
  if (context) return h(context.Provider, { value: params }, children);
  // React Navigation : `useRoute().params` (les props `route` d'un écran viennent de son fichier canvas).
  if (hasNavigation()) return h(NavigationShell, { params, render: () => h(Fragment, null, children) });
  return children ?? null;
}
