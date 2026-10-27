import { type Context, type ReactNode, createElement as h } from 'react';

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
export function RouteParams({ params, children }: { params: Record<string, string>; children?: ReactNode }) {
  return context ? h(context.Provider, { value: params }, children) : (children ?? null);
}
