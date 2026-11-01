/**
 * Conventions du projet pour créer des composants et des écrans : déduites du code existant (dossiers
 * Atomic Design, forme d'un composant, alias d'import, style du code), jamais imposées. Chaque valeur
 * peut être fixée dans `rn-canvas.json`, clé `create` ; elle passe alors devant la détection.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ConventionLayout, ConventionLevel, Conventions } from '../shared/protocol.ts';
import { resolveRelative, stripJsonComments } from './setup.ts';

/** Niveaux Atomic Design reconnus, du plus simple au plus composé. */
export const ATOMIC_LEVELS = ['atoms', 'molecules', 'organisms', 'templates', 'pages'];

export type Level = ConventionLevel;
export type Layout = ConventionLayout;
export type { Conventions };

const DEFAULT_LAYOUT: Layout = { folder: true, propsFile: true, stylesFile: true, index: true, exportDefault: true };
const SKIP = new Set(['node_modules', '.git', 'ios', 'android', 'dist', 'build', '.expo', 'canvas', '__tests__']);

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const list = (p: string) => {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
};

/** Dossier contenant des niveaux Atomic Design (`atoms`, `molecules`…), cherché en largeur. */
function findAtomicRoot(root: string, starts: string[]): string | null {
  const queue = starts.filter((s) => isDir(path.join(root, s))).map((s) => ({ rel: s, depth: 0 }));
  while (queue.length) {
    const { rel, depth } = queue.shift()!;
    const children = list(path.join(root, rel));
    if (children.filter((c) => ATOMIC_LEVELS.includes(c)).length >= 2) return rel;
    if (depth >= 4) continue;
    for (const c of children) if (!SKIP.has(c) && !c.startsWith('.') && isDir(path.join(root, rel, c))) queue.push({ rel: `${rel}/${c}`, depth: depth + 1 });
  }
  return null;
}

/** Dossier de composant : il contient `<NomDuDossier>.tsx` (ou .jsx). */
const isComponentDir = (abs: string) => /\.(tsx|jsx)$/.test(list(abs).find((f) => f.replace(/\.(tsx|jsx)$/, '') === path.basename(abs)) ?? '');

function readConfig(root: string): Record<string, any> {
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(path.join(root, 'rn-canvas.json'), 'utf8'))).create ?? {};
  } catch {
    return {};
  }
}

function tsconfigAliases(root: string): { alias: string; dir: string }[] {
  try {
    const json = JSON.parse(stripJsonComments(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8')).replace(/,(\s*[}\]])/g, '$1'));
    const base = json.compilerOptions?.baseUrl ?? '.';
    return Object.entries((json.compilerOptions?.paths ?? {}) as Record<string, string[]>)
      .filter(([key, targets]) => key.endsWith('/*') && targets[0]?.endsWith('/*'))
      .map(([key, targets]) => ({ alias: key.slice(0, -2), dir: path.posix.normalize(path.posix.join(base, targets[0].slice(0, -2))).replace(/^\.\//, '') }));
  } catch {
    return [];
  }
}

export function detectConventions(root: string, options: { include: string[]; screenFiles: string[] }): Conventions {
  const config = readConfig(root);
  const source: Conventions['source'] = {};
  const pick = <T>(key: string, configured: T | undefined, detected: T | undefined, fallback: T): T => {
    source[key] = configured !== undefined ? 'configuré' : detected !== undefined ? 'détecté' : 'par défaut';
    return configured ?? detected ?? fallback;
  };

  // Dossier Atomic Design et ses niveaux (ceux qui contiennent déjà quelque chose).
  const detectedRoot = findAtomicRoot(root, [...new Set([...options.include, 'src', 'app', 'components'])]);
  const componentsRoot = pick<string | null>('componentsRoot', config.componentsRoot, detectedRoot ?? undefined, null);
  const aliases = tsconfigAliases(root);
  const levelNames: string[] = config.levels ?? (componentsRoot ? ATOMIC_LEVELS.filter((l) => list(path.join(root, componentsRoot, l)).some((c) => !c.startsWith('.'))) : []);
  source.levels = config.levels ? 'configuré' : componentsRoot ? 'détecté' : 'par défaut';
  // Composants existants : un dossier à leur nom (`Button/Button.tsx`) ou un fichier seul (`Button.tsx`).
  const samples: { file: string; dir: string; name: string; folder: boolean }[] = [];
  const collect = (dirAbs: string) => {
    for (const child of list(dirAbs)) {
      const abs = path.join(dirAbs, child);
      if (isDir(abs)) {
        if (isComponentDir(abs)) {
          const main = list(abs).find((f) => f.replace(/\.(tsx|jsx)$/, '') === child && /\.(tsx|jsx)$/.test(f))!;
          samples.push({ file: path.join(abs, main), dir: abs, name: child, folder: true });
        }
      } else if (/^[A-Z]\w*\.(tsx|jsx)$/.test(child) && !/\.(test|spec|stories)\./.test(child)) {
        samples.push({ file: abs, dir: dirAbs, name: child.replace(/\.(tsx|jsx)$/, ''), folder: false });
      }
    }
  };
  const levels: Level[] = componentsRoot
    ? levelNames.map((name) => {
        const dir = `${componentsRoot}/${name}`;
        const groups: string[] = [];
        collect(path.join(root, dir));
        for (const child of list(path.join(root, dir))) {
          const abs = path.join(root, dir, child);
          if (!isDir(abs) || isComponentDir(abs) || child.startsWith('__')) continue;
          // Sous-dossier de rangement : il contient des composants sans en être un.
          const before = samples.length;
          collect(abs);
          if (samples.length > before) groups.push(child);
        }
        return { name, dir, alias: aliases.find((a) => a.dir === dir)?.alias ?? null, groups };
      })
    : [];

  // Forme d'un composant : celle de la majorité des composants existants.
  const sample = samples.slice(0, 60);
  const majority = (test: (s: (typeof sample)[number]) => boolean) => (sample.length ? sample.filter(test).length / sample.length >= 0.5 : undefined);
  const read = (file: string) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };
  const sibling = (s: (typeof sample)[number], suffix: string) => list(s.dir).some((f) => f.startsWith(`${s.name}.${suffix}.`));
  const detectedLayout: Partial<Layout> = sample.length
    ? {
        folder: majority((s) => s.folder),
        propsFile: majority((s) => sibling(s, 'props')),
        stylesFile: majority((s) => sibling(s, 'styles')),
        // Un index par composant n'a de sens que rangé dans son dossier.
        index: majority((s) => s.folder && list(s.dir).some((f) => /^index\.(ts|tsx|js)$/.test(f))),
        exportDefault: majority((s) => /export default /.test(read(s.file))),
      }
    : {};
  const layout = Object.fromEntries(
    (Object.keys(DEFAULT_LAYOUT) as (keyof Layout)[]).map((key) => [key, pick(`layout.${key}`, config.layout?.[key], detectedLayout[key], DEFAULT_LAYOUT[key])]),
  ) as unknown as Layout;

  // Style du code : celui d'un fichier de composant existant.
  const code = sample.length ? read(sample[0].file) : '';
  const importLine = /^import \{([^}]*)\} from (['"])/m.exec(code);
  const indentLine = /^( +|\t)\S/m.exec(code);
  const codeStyle = {
    quote: pick<"'" | '"'>('code.quote', config.code?.quote, importLine ? (importLine[2] as "'" | '"') : undefined, "'"),
    bracketSpacing: pick('code.bracketSpacing', config.code?.bracketSpacing, importLine ? importLine[1].startsWith(' ') : undefined, true),
    semicolons: pick('code.semicolons', config.code?.semicolons, code ? /;\s*$/m.test(code.split('\n')[0] ?? '') : undefined, true),
    indent: pick('code.indent', config.code?.indent, indentLine ? indentLine[1] : undefined, '  '),
    // `export interface XProps` (sinon une interface locale au fichier).
    exportProps: pick('code.exportProps', config.code?.exportProps, sample.length ? majority((s) => new RegExp(`export (interface|type) ${s.name}Props\\b`).test(read(s.file)) || sibling(s, 'props')) : undefined, true),
  };

  const stylesSource = sample.map((s) => list(s.dir).find((f) => f.startsWith(`${s.name}.styles.`)) ?? null).find(Boolean);
  const stylesCode = stylesSource ? read(path.join(sample.find((s) => list(s.dir).includes(stylesSource))!.dir, stylesSource)) : code;
  const styles = pick<Conventions['styles']>('styles', config.styles, stylesCode ? (/StyleSheet\.create/.test(stylesCode) ? 'stylesheet' : /styled/.test(stylesCode) ? 'styled-components' : undefined) : undefined, 'stylesheet');

  // Dossiers d'écrans : ceux qui rangent les écrans déclarés dans la navigation (le plus commun d'abord).
  const counts = new Map<string, number>();
  for (const file of options.screenFiles) {
    const dir = path.posix.dirname(file);
    const base = path.posix.basename(file).replace(/\.(tsx|jsx|ts|js)$/, '');
    // Écran rangé dans son dossier (`devis/in-progress/in-progress.tsx`, `Home/index.tsx`) : le dossier qui
    // range ces dossiers ; écran en fichier seul (`screens/HomeScreen.tsx`) : son dossier.
    const own = base === 'index' || base === path.posix.basename(dir);
    const home = own ? path.posix.dirname(dir) : dir;
    if (home === '.') continue;
    counts.set(home, (counts.get(home) ?? 0) + 1);
    // Sa racine (`app/screens`) : un peu moins, pour la proposer aussi.
    const top = home.split('/').slice(0, 2).join('/');
    if (top !== home) counts.set(top, (counts.get(top) ?? 0) + 0.5);
  }
  const detectedScreens = [...counts].sort((a, b) => b[1] - a[1]).map(([dir]) => dir).slice(0, 12);
  const screenDirs = pick<string[]>('screenDirs', config.screenDirs, detectedScreens.length ? detectedScreens : undefined, [options.include.find((d) => d !== 'canvas') ?? 'src']);

  let pkg: Record<string, any> = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    // Pas de package.json lisible : pas d'intégration.
  }
  const skeleton = pick('skeleton', config.skeleton, Boolean({ ...pkg.dependencies, ...pkg.devDependencies }['react-zero-skeleton']) || undefined, false);

  return { componentsRoot, levels, layout, styles, screenDirs, skeleton, code: codeStyle, source };
}

/** Fichiers des écrans affichés par les fichiers canvas (pour proposer leurs dossiers). */
export function screenFilesOf(root: string, canvasFiles: string[]): string[] {
  const out: string[] = [];
  for (const file of canvasFiles) {
    let code = '';
    try {
      code = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const match of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('rn-canvas')) continue;
      const target = resolveRelative(root, file, match[1]);
      if (target && !target.includes('.canvas.') && !target.startsWith('canvas/')) out.push(target);
    }
  }
  return out;
}

/** Niveau Atomic Design d'un fichier (son rang dans `levels`), ou null s'il n'est pas rangé dedans. */
export function levelOf(conventions: Conventions, file: string): number | null {
  const i = conventions.levels.findIndex((l) => file.startsWith(`${l.dir}/`));
  return i === -1 ? null : ATOMIC_LEVELS.indexOf(conventions.levels[i].name);
}
