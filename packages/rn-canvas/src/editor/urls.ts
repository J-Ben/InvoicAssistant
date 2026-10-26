import type { StoryEntry } from '../shared/protocol.ts';

/**
 * URL d'un écran. Isolé : un sous-domaine de localhost par écran (`accueil-actuel-1k2j.localhost`),
 * que les navigateurs résolvent vers la machine locale ; chaque écran a ainsi son propre stockage.
 */
export function storyUrl(appUrl: string, story: StoryEntry, isolate: boolean): string {
  const url = new URL(appUrl);
  if (isolate && url.hostname === 'localhost') {
    let hash = 5381;
    for (const ch of story.id) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0;
    const base = `${story.file.split('/').pop()!.replace(/\.canvas\.\w+$/, '')}-${story.exportName}`;
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    url.hostname = `${slug}-${hash.toString(36)}.localhost`;
  }
  url.searchParams.set('rnc-story', story.id);
  return url.toString();
}
