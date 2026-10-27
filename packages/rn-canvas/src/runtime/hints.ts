/**
 * Piste pour l'erreur la plus fréquente d'un écran affiché seul : il lit un paramètre de route
 * (`route.params.id`, `useLocalSearchParams()`) que personne ne lui a passé.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hintFor(error: Error, params: Record<string, any> | null, storyId = ''): string | null {
  const file = storyId.slice(0, storyId.lastIndexOf('#')) || 'son fichier canvas';
  // `const { mode } = route.params` sans params : V8 nomme la clé et l'objet lu.
  const destructured = /Cannot destructure property '([^']+)' of '([^']+)' as it is (?:undefined|null)/.exec(error.message);
  if (destructured && /params/.test(destructured[2])) {
    return `Cet écran attend des paramètres de route (« ${destructured[1]} »…) : ajoutez params: { ${destructured[1]}: … } à la variante dans ${file}.`;
  }
  // Safari / JSC ne nomme pas la clé.
  if (/Right side of assignment cannot be destructured/.test(error.message) && !params) {
    return `Cet écran déstructure probablement route.params : ajoutez params: { … } à la variante dans ${file}.`;
  }
  const reading = /Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([^']+)'\)|undefined is not an object \(evaluating '[^']*?\.?(\w+)'\)/.exec(error.message);
  if (!reading) return null;
  const key = reading[1] ?? reading[2];
  // Avec des params déclarés, la piste ne vaut que si la clé lue y manque.
  if (params && key in params) return null;
  return params
    ? `L'écran lit peut-être « ${key} », absent des params de la variante (${Object.keys(params).join(', ') || 'aucun'}) dans ${file}.`
    : `L'écran lit probablement un paramètre de route (« ${key} ») : déclarez-le dans ${file}, ex. params: { ${key}: '42' }.`;
}
