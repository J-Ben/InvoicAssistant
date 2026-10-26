/**
 * Runtime rn-canvas, chargé dans l'app (web, développement uniquement).
 *
 * Écrit sans JSX : le plugin Babel n'instrumente que le JSX, le runtime reste donc
 * invisible dans l'arbre des calques.
 */
import { type ComponentType, createElement } from 'react';
import { Platform } from 'react-native';
import { CanvasHost } from './CanvasHost';
import type { CanvasManifest } from './types';

export type { CanvasManifest, CanvasMeta, CanvasRuntimeConfig, CanvasStory, CanvasStoryObject, CanvasWrapperProps } from './types';

export const STORY_PARAM = 'rnc-story';

/**
 * Enveloppe le composant racine : si l'URL contient `?rnc-story=…` (web, dev), on affiche
 * l'écran isolé demandé par l'éditeur ; sinon l'app normale, sans aucun surcoût.
 */
export function withCanvas<P extends object>(App: ComponentType<P>, loadManifest: () => CanvasManifest): ComponentType<P> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return App;
  const storyId = new URLSearchParams(window.location.search).get(STORY_PARAM);
  if (!storyId) return App;
  return function RnCanvasRoot() {
    return createElement(CanvasHost, { storyId, loadManifest });
  };
}
