/**
 * Boucle de rendu : un effet qui relance le rendu sans fin (setState dans un useEffect dont une
 * dépendance change à chaque rendu) fait tourner l'écran à plein régime et peut bloquer le
 * navigateur. React le signale par « Maximum update depth exceeded » : au-delà de quelques
 * occurrences rapprochées, on prévient l'éditeur, qui démonte l'écran.
 */
const PATTERN = 'Maximum update depth exceeded';
const THRESHOLD = 5;
const WINDOW = 3000;

export function watchRenderLoops(storyId: string): () => void {
  const original = console.error;
  const times: number[] = [];
  let reported = false;
  console.error = function (...args: unknown[]) {
    if (!reported && args.some((a) => String((a as { message?: unknown } | null)?.message ?? a).includes(PATTERN))) {
      const now = Date.now();
      times.push(now);
      while (times.length && now - times[0] > WINDOW) times.shift();
      if (times.length >= THRESHOLD) {
        reported = true;
        window.parent?.postMessage({ source: 'rn-canvas', type: 'loop', story: storyId, count: times.length }, '*');
      }
    }
    return original.apply(this, args as []);
  };
  return () => {
    console.error = original;
  };
}
