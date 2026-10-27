/**
 * `rn-canvas shim <module>` : remplacement web inoffensif d'un module natif, propre au projet.
 *
 * Le fichier écrit (canvas/shims/<module>.js) s'appuie sur `deepShim` : toute propriété, à toute
 * profondeur, est une fonction sans effet. Les exports trouvés dans les types du module sont
 * listés en commentaire pour compléter les comportements utiles à la main.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE } from './project.ts';

export interface ShimResult {
  file: string;
  created: boolean;
  exports: string[];
}

/** Nom de fichier sûr : @scope/nom-du-module → scope__nom-du-module. */
export function shimFileName(moduleName: string): string {
  return moduleName.replace(/^@/, '').replace(/[\/\\]/g, '__').replace(/[^\w.-]/g, '_');
}

/** Exports « valeur » (fonctions, constantes, classes, enums) déclarés dans les types du module. */
export function declaredExports(root: string, moduleName: string): string[] {
  const dir = path.join(root, 'node_modules', moduleName);
  const pkg = readJson(path.join(dir, 'package.json')) as { types?: string; typings?: string } | null;
  if (!pkg) return [];
  const entry = [pkg.types, pkg.typings, 'index.d.ts', 'lib/index.d.ts', 'dist/index.d.ts'].filter((f): f is string => !!f).map((f) => path.join(dir, f)).find(isFile);
  if (!entry) return [];
  const names = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string, depth: number) => {
    if (seen.has(file) || depth > 3) return;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(/^export\s+(?:declare\s+)?(?:const|let|var|function|class|enum|abstract\s+class|namespace)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    if (/^export\s+default\b/m.test(code) || /^export\s*=\s*/m.test(code)) names.add('default');
    for (const m of code.matchAll(/^export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/gm)) {
      if (/^export\s+type\b/.test(m[0])) continue;
      for (const spec of m[1].split(',')) {
        const s = spec.trim();
        if (!s || s.startsWith('type ')) continue;
        names.add(s.split(/\s+as\s+/).pop()!.trim());
      }
    }
    for (const m of code.matchAll(/^export\s*\*\s*from\s*['"](\.[^'"]+)['"]/gm)) {
      const base = path.resolve(path.dirname(file), m[1]);
      const next = [base, `${base}.d.ts`, path.join(base, 'index.d.ts'), base.replace(/\.js$/, '.d.ts')].find(isFile);
      if (next) visit(next, depth + 1);
    }
  };
  visit(entry, 0);
  return [...names].sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)));
}

export function shimSource(moduleName: string, exports: string[]): string {
  const listed = exports.length ? `\n// Exports trouvés dans ses types : ${exports.join(', ')}.` : '';
  return `'use strict';
// Remplacement web de ${moduleName}, actif dans le canevas rn-canvas uniquement (RN_CANVAS=1) :
// iOS, Android et le build web habituel utilisent le vrai module.
//
// Par défaut, toute propriété (à toute profondeur) est une fonction sans effet, un HOC renvoie le
// composant reçu et un composant affiche ses enfants. Décrivez ci-dessous ce que les écrans
// doivent recevoir quand la valeur neutre ne suffit pas.${listed}
const { deepShim, passThrough, identity } = require('rn-canvas/shims/_shim.js');

module.exports = deepShim(${JSON.stringify(moduleName)}, {
  // isEnabled: async () => false,
  // ErrorBoundary: passThrough,
  // withSomething: () => identity,
});
`;
}

/** Écrit canvas/shims/<module>.js (s'il n'existe pas) et l'ajoute aux `shims` de rn-canvas.json. */
export function writeShim(root: string, moduleName: string): ShimResult {
  const file = `canvas/shims/${shimFileName(moduleName)}.js`;
  const target = path.join(root, file);
  const exports = declaredExports(root, moduleName);
  const created = !fs.existsSync(target);
  if (created) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, shimSource(moduleName, exports));
  }
  const configPath = path.join(root, CONFIG_FILE);
  const config = (readJson(configPath) as Record<string, any> | null) ?? {};
  if (config.shims?.[moduleName] !== file) {
    config.shims = { ...config.shims, [moduleName]: file };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  return { file, created, exports };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
