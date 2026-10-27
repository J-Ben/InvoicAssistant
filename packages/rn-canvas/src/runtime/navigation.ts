import { type ReactElement, createElement as h } from 'react';
import type { CanvasManifest } from './types';

type Navigation = NonNullable<CanvasManifest['navigation']>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScreenProps = { navigation: any; route: any };

let navigation: Navigation | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stack: any = null;
let storyId = '';

/** React Navigation du projet (sans expo-router), fourni par le manifeste au démarrage de l'écran. */
export function setNavigation(value: Navigation | null | undefined, story: string) {
  navigation = value?.native?.NavigationContainer ? value : null;
  stack = null;
  storyId = story;
}

export function hasNavigation(): boolean {
  return navigation !== null;
}

const SCREEN = 'RnCanvasScreen';
const NAVIGATING = ['navigate', 'push', 'replace', 'goBack', 'pop', 'popTo', 'popToTop', 'reset', 'dispatch', 'jumpTo'];

/** Une navigation qui sortirait de l'écran isolé est signalée à l'éditeur au lieu d'être jouée. */
function report(action: string, target: unknown) {
  const href = typeof target === 'string' ? target : null;
  window.parent?.postMessage({ source: 'rn-canvas', type: 'navigate', story: storyId, action, href }, '*');
}

/**
 * Affiche l'écran dans un conteneur React Navigation indépendant, avec une pile à un seul écran :
 * `route.params` (et `useRoute()`) donnent `params`, `navigation.setOptions` fonctionne, et une
 * navigation vers un autre écran (`navigate('Detail')`, `goBack()`) est signalée à l'éditeur.
 */
export function NavigationShell({ params, render }: { params: Record<string, unknown> | null; render: (props: ScreenProps) => ReactElement }) {
  const native = navigation!.native;
  if (!stack && navigation!.createStack) stack = navigation!.createStack();
  const onUnhandledAction = (action: { type: string; payload?: { name?: unknown } }) => report(action.type, action.payload?.name);
  // v7 : NavigationIndependentTree ; v6 : prop `independent` du conteneur.
  const Independent = native.NavigationIndependentTree;
  const container = { onUnhandledAction, documentTitle: { enabled: false }, ...(Independent ? {} : { independent: true }) };

  let content: ReactElement;
  if (stack) {
    content = h(
      stack.Navigator,
      { screenOptions: { headerShown: false } },
      h(stack.Screen, { name: SCREEN, initialParams: params ?? undefined, children: (props: ScreenProps) => render(props) }),
    );
  } else {
    // Pas de navigateur de pile installé : `route` seulement, et une `navigation` qui ne fait que signaler.
    const route = { key: SCREEN, name: SCREEN, params: params ?? undefined };
    const nav = new Proxy(
      {},
      {
        get(_, key) {
          if (typeof key === 'symbol' || key === 'then') return undefined;
          if (key === 'canGoBack') return () => false;
          if (key === 'isFocused') return () => true;
          if (key === 'addListener') return () => () => {};
          if (NAVIGATING.includes(key)) return (target?: unknown) => report(key, target);
          return () => {};
        },
      },
    );
    content = render({ navigation: nav, route });
  }
  const tree = h(native.NavigationContainer, container, content);
  return Independent ? h(Independent, null, tree) : tree;
}
