/**
 * Runtime rn-canvas, chargé dans l'app (web, développement uniquement).
 *
 * Écrit sans JSX : le plugin Babel n'instrumente que le JSX, le runtime reste donc
 * invisible dans l'arbre des calques.
 */
import { type ComponentType, createElement } from 'react';
import { AppRegistry, Platform } from 'react-native';
import { GALLERY_PARAM } from '../shared/protocol';
import { CanvasHost } from './CanvasHost';
import { GalleryHost } from './gallery';
import type { CanvasManifest } from './types';

export type { CanvasManifest, CanvasMeta, CanvasRuntimeConfig, CanvasStory, CanvasStoryObject, CanvasWrapperProps, ComponentExample } from './types';

export { CanvasSeed } from './seed';
export { RouteParams } from './params';

export const STORY_PARAM = 'rnc-story';

/**
 * Enveloppe le composant racine : si l'URL contient `?rnc-story=…` (web, dev), on affiche
 * l'écran isolé demandé par l'éditeur ; sinon l'app normale, sans aucun surcoût.
 */
export function withCanvas<P extends object>(App: ComponentType<P>, loadManifest: () => CanvasManifest): ComponentType<P> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return App;
  const params = new URLSearchParams(window.location.search);
  // Aperçus de la bibliothèque, demandés par la barre de l'éditeur.
  if (params.has(GALLERY_PARAM)) {
    return ensureMounted(function RnCanvasGallery() {
      return createElement(GalleryHost, { loadManifest });
    });
  }
  const storyId = params.get(STORY_PARAM);
  if (!storyId) return App;
  return ensureMounted(function RnCanvasRoot() {
    return createElement(CanvasHost, { storyId, loadManifest });
  });
}

/**
 * Sur le web, Expo ne lance l'app que pour `registerRootComponent` : un point d'entrée qui fait
 * seulement `AppRegistry.registerComponent(name, () => App)` (projet React Native CLI) n'affiche
 * rien. Dans le canevas, si personne n'a monté d'arbre React dans #root, on y lance l'écran.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureMounted<C extends ComponentType<any>>(Root: C): C {
  setTimeout(() => {
    const rootTag = document.getElementById('root');
    if (!rootTag || rootTag.hasChildNodes() || Object.keys(rootTag).some((k) => k.startsWith('__reactContainer'))) return;
    AppRegistry.registerComponent('rn-canvas', () => Root);
    AppRegistry.runApplication('rn-canvas', { rootTag } as unknown as Parameters<typeof AppRegistry.runApplication>[1]);
  }, 0);
  return Root;
}
