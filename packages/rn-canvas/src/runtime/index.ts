/**
 * Runtime rn-canvas, chargé dans l'app (web, développement uniquement).
 *
 * Écrit sans JSX : le plugin Babel n'instrumente que le JSX, le runtime reste donc
 * invisible dans l'arbre des calques.
 */
import { type ComponentType, createElement } from 'react';
import { Platform } from 'react-native';
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
    return function RnCanvasGallery() {
      return createElement(GalleryHost, { loadManifest });
    };
  }
  const storyId = params.get(STORY_PARAM);
  if (!storyId) return App;
  return function RnCanvasRoot() {
    return createElement(CanvasHost, { storyId, loadManifest });
  };
}
