// Modifications de fichiers de configuration du projet hôte (utilisées par `rn-canvas init`).
/**
 * Ajoute 'rn-canvas/babel' en tête de `plugins` (react-native-reanimated/plugin doit rester le
 * dernier), ou crée `plugins` après `presets`. null si la forme du fichier n'est pas reconnue.
 */
export function addBabelPlugin(code: string): string | null {
  const plugins = /^([ \t]*)plugins:\s*\[/m.exec(code);
  if (plugins) {
    const indent = `${plugins[1]}  `;
    const at = plugins.index + plugins[0].length;
    return `${code.slice(0, at)}\n${indent}// rn-canvas : actif seulement pour le bundle web de développement.\n${indent}'rn-canvas/babel',${code.slice(at)}`;
  }
  const presets = /^([ \t]*)presets:\s*(\[[^\]]*\]|'[^']*'|"[^"]*"),?[ \t]*$/m.exec(code);
  if (presets) {
    const at = presets.index + presets[0].length;
    const comma = presets[0].trimEnd().endsWith(',') ? '' : ',';
    return `${code.slice(0, at)}${comma}\n${presets[1]}plugins: ['rn-canvas/babel'],${code.slice(at)}`;
  }
  return null;
}
