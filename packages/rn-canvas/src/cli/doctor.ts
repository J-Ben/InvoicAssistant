/**
 * `rn-canvas doctor` : ce qui empêchera un projet de s'afficher dans le canevas, et comment le corriger.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CONFIG_FILE, Project, loadConfig } from '../server/project.ts';
import { analyzeEntry } from '../server/setup.ts';

export type Level = 'ok' | 'warn' | 'error';

export interface Check {
  level: Level;
  title: string;
  detail?: string;
  fix?: string;
}

/** Bibliothèques de style dont les styles ne sont pas (ou mal) modifiables dans l'éditeur. */
const STYLE_LIBRARIES: Record<string, string> = {
  nativewind: 'NativeWind (className Tailwind)',
  twrnc: 'twrnc (Tailwind)',
  'styled-components': 'styled-components',
  '@emotion/native': 'Emotion',
  tamagui: 'Tamagui',
  '@tamagui/core': 'Tamagui',
  '@shopify/restyle': 'Restyle',
  'react-native-unistyles': 'Unistyles',
};

/** Modules natifs connus pour fonctionner sur le web sans aide. */
const WEB_OK = new Set(['react', 'react-native', 'react-dom', 'react-native-web', 'expo', 'expo-router', '@expo/metro-runtime', 'expo-sqlite', 'react-native-vector-icons', '@expo/vector-icons']);
/** Familles de paquets qui fonctionnent sur le web (polices d'icônes : du JS commun et un fichier de police). */
const WEB_OK_PREFIXES = ['@react-native-vector-icons/'];
const isWebOk = (name: string) => WEB_OK.has(name) || WEB_OK_PREFIXES.some((p) => name.startsWith(p));

/** Version installée `version` dans la plage `range` (`~1.2.0`, `^1.2.0`, `1.2.3`) : sans dépendance semver. */
export function satisfies(version: string, range: string): boolean {
  const parse = (v: string) => v.replace(/^[~^=v\s]+/, '').split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [a, b, c] = parse(version);
  const [x, y, z] = parse(range);
  const atLeast = a > x || (a === x && (b > y || (b === y && c >= z)));
  if (range.trim().startsWith('~')) return a === x && b === y && atLeast;
  if (range.trim().startsWith('^')) return (x > 0 ? a === x : y > 0 ? a === 0 && b === y : a === 0 && b === 0 && c === z) && atLeast;
  return a === x && b === y && c === z;
}

/**
 * Modules déjà remplacés sur le web par la configuration Metro du projet (resolveRequest existant) :
 * on interroge le resolver avec un contexte factice ; s'il ne délègue pas au résolveur par défaut,
 * le module est couvert. Configuration illisible (fonction, promesse, erreur) : aucun.
 */
function coveredByMetro(root: string, metroFile: string | undefined, names: string[]): Set<string> {
  const covered = new Set<string>();
  if (!metroFile || names.length === 0) return covered;
  let config: { resolver?: { resolveRequest?: (context: unknown, name: string, platform: string) => unknown } } | null = null;
  try {
    config = createRequire(path.join(root, 'package.json'))(path.join(root, metroFile));
  } catch {
    return covered;
  }
  const resolve = config && typeof config === 'object' ? config.resolver?.resolveRequest : undefined;
  if (typeof resolve !== 'function') return covered;
  const fallback = { type: 'sourceFile', filePath: '__rn-canvas-default__' };
  for (const name of names) {
    const context = { originModulePath: path.join(root, 'index.js'), resolveRequest: () => fallback, preferNativePlatform: false, platform: 'web' };
    try {
      if (resolve(context, name, 'web') !== fallback) covered.add(name);
    } catch {
      // Le resolver attend un vrai contexte Metro : impossible à dire.
    }
  }
  return covered;
}

/** rn-canvas/metro tel que le projet le résout, sinon celui de ce paquet (sources ou dist/). */
function loadMetro(root: string): { shimsFor: (root: string) => { shims: Record<string, string> } } {
  try {
    return createRequire(path.join(root, 'package.json'))('rn-canvas/metro');
  } catch {
    const here = createRequire(import.meta.url);
    for (const candidate of ['../../metro.cjs', '../metro.cjs']) {
      try {
        return here(candidate);
      } catch {
        // essai suivant
      }
    }
    throw new Error('rn-canvas/metro introuvable');
  }
}

function readJson(file: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function exists(root: string, ...parts: string[]): boolean {
  return fs.existsSync(path.join(root, ...parts));
}

function read(root: string, file: string): string {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return '';
  }
}

/** Le paquet contient-il du code natif (iOS / Android) ? */
function isNative(dir: string, pkg: Record<string, any>): boolean {
  return (
    fs.existsSync(path.join(dir, 'android')) ||
    fs.existsSync(path.join(dir, 'ios')) ||
    fs.existsSync(path.join(dir, 'expo-module.config.json')) ||
    Boolean(pkg.codegenConfig) ||
    fs.readdirSync(dir).some((f) => f.endsWith('.podspec'))
  );
}

/**
 * Le paquet a-t-il une implémentation web ? Indices : champ browser, fichiers .web.*, ou au
 * contraire des fichiers .native.* / un champ "react-native" distinct de "main" — la version par
 * défaut est alors celle du web.
 */
function hasWebImplementation(dir: string, pkg: Record<string, any>): boolean {
  if (pkg.browser || JSON.stringify(pkg.exports ?? {}).includes('"browser"')) return true;
  if (typeof pkg['react-native'] === 'string' && pkg.main && pkg['react-native'] !== pkg.main) return true;
  let seen = 0;
  const visit = (d: string, depth: number): boolean => {
    if (depth > 4) return false;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (++seen > 3000) return false;
      if (e.isDirectory()) {
        if (['node_modules', 'android', 'ios', '__tests__', 'example'].includes(e.name)) continue;
        if (visit(path.join(d, e.name), depth + 1)) return true;
      } else if (/\.(web|native)\.(m?js|tsx?)$/.test(e.name)) return true;
    }
    return false;
  };
  return visit(dir, 0);
}

/** Nombre de fichiers sources qui importent chacun des paquets donnés. */
function filesImporting(root: string, dirs: string[], packages: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', '.git', '.expo', 'android', 'ios', 'dist', 'build'].includes(e.name)) visit(full);
      } else if (/\.(m?[jt]sx?)$/.test(e.name)) {
        const code = fs.readFileSync(full, 'utf8');
        for (const p of packages) if (new RegExp(`['"]${p.replace(/[/.]/g, '\\$&')}(/[^'"]*)?['"]`).test(code)) counts.set(p, (counts.get(p) ?? 0) + 1);
      }
    }
  };
  for (const d of new Set(dirs)) visit(path.join(root, d));
  return counts;
}

/** Paquets importés par le code de l'app (imports, require), d'après une lecture rapide des sources. */
function importedPackages(root: string, dirs: string[]): Set<string> {
  const names = new Set<string>();
  const scan = (file: string) => {
    let code: string;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    for (const m of code.matchAll(/(?:from\s+|require\(\s*|import\(\s*|import\s+)['"]([^'"./][^'"]*)['"]/g)) {
      const spec = m[1];
      names.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
  };
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', '.git', '.expo', 'android', 'ios', 'dist', 'build'].includes(e.name)) visit(full);
      } else if (/\.(m?[jt]sx?)$/.test(e.name)) scan(full);
    }
  };
  for (const d of dirs) visit(path.join(root, d));
  for (const f of fs.readdirSync(root)) if (/\.(m?[jt]sx?)$/.test(f)) scan(path.join(root, f));
  return names;
}

/**
 * Commande d'installation avec la version qu'attend l'Expo installé (bundledNativeModules.json, ou
 * dépendances du paquet expo). Sans réseau, `npx expo install` peut prendre la dernière version
 * publiée au lieu de celle du SDK : une version explicite évite ce piège.
 */
export function installCommand(root: string, names: string[], dev = false): string {
  const bundled = readJson(path.join(root, 'node_modules/expo/bundledNativeModules.json')) ?? {};
  const expoDeps = readJson(path.join(root, 'node_modules/expo/package.json'))?.dependencies ?? {};
  const specs = names.map((n) => (bundled[n] ?? expoDeps[n] ? `${n}@${bundled[n] ?? expoDeps[n]}` : n));
  const manager = exists(root, 'yarn.lock') ? 'yarn add' : exists(root, 'pnpm-lock.yaml') ? 'pnpm add' : exists(root, 'bun.lockb') || exists(root, 'bun.lock') ? 'bun add' : 'npm install';
  return `${manager}${dev ? (manager === 'npm install' ? ' -D' : ' -D') : ''} ${specs.join(' ')}`;
}

/** Version attendue par l'Expo installé, s'il en impose une. */
function expectedVersion(root: string, name: string): string | null {
  const bundled = readJson(path.join(root, 'node_modules/expo/bundledNativeModules.json')) ?? {};
  return bundled[name] ?? readJson(path.join(root, 'node_modules/expo/package.json'))?.dependencies?.[name] ?? null;
}

export function diagnose(root: string): Check[] {
  const checks: Check[] = [];
  const add = (level: Level, title: string, extra: Omit<Check, 'level' | 'title'> = {}) => checks.push({ level, title, ...extra });

  // Node : même minimum qu'Expo SDK 58 (les tests du package, eux, demandent Node 22.18).
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 20 || (major === 20 && minor >= 19)) add('ok', `Node ${process.versions.node}`);
  else add('error', `Node ${process.versions.node} : trop ancien`, { fix: 'Installez Node 20.19 ou plus récent.' });

  const pkg = readJson(path.join(root, 'package.json'));
  if (!pkg) {
    add('error', 'Aucun package.json ici', { fix: 'Lancez la commande à la racine du projet.' });
    return checks;
  }
  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

  // Expo
  if (!deps.expo) {
    add('error', 'Projet React Native sans Expo : non pris en charge', {
      detail: "rn-canvas affiche les écrans via le serveur web d'Expo (Metro + react-native-web).",
      fix: 'Ajoutez Expo au projet (npx install-expo-modules) ou attendez la prise en charge des projets sans Expo.',
    });
    return checks;
  }
  const expoPkg = readJson(path.join(root, 'node_modules/expo/package.json'));
  if (!expoPkg) {
    add('error', 'Dépendances non installées', { fix: 'npm install' });
    return checks;
  }
  add('ok', `Expo SDK ${expoPkg.version.split('.')[0]}`);
  const bundled = readJson(path.join(root, 'node_modules/expo/bundledNativeModules.json')) ?? {};
  const expoInstall = (names: string[]) => installCommand(root, names);

  // Support web
  const webDeps = ['react-dom', 'react-native-web', '@expo/metro-runtime'];
  const missingWeb = webDeps.filter((d) => !deps[d]);
  if (missingWeb.length) add('error', `Support web absent : ${missingWeb.join(', ')}`, { fix: expoInstall(missingWeb) });
  else {
    // Version installée comparée à la plage attendue (^0.21.2 installé en 0.21.2 satisfait ~0.21.0).
    const installedVersion = (d: string) => readJson(path.join(root, 'node_modules', d, 'package.json'))?.version as string | undefined;
    const mismatched = webDeps.filter((d) => {
      const version = installedVersion(d);
      return bundled[d] && version && !satisfies(version, bundled[d]);
    });
    if (mismatched.length) {
      add('warn', `Versions web différentes de celles attendues par Expo : ${mismatched.map((d) => `${d} ${installedVersion(d)} (attendu ${bundled[d]})`).join(', ')}`, { fix: expoInstall(mismatched) });
    } else add('ok', 'Support web installé (react-dom, react-native-web, @expo/metro-runtime)');
  }

  // Babel
  const babelFile = ['babel.config.js', 'babel.config.cjs', '.babelrc', '.babelrc.js'].find((f) => exists(root, f));
  if (!babelFile) add('error', 'Pas de configuration Babel : le plugin rn-canvas n’est pas chargé', { fix: 'npx rn-canvas init' });
  else if (!read(root, babelFile).includes('rn-canvas/babel')) add('error', `${babelFile} ne charge pas le plugin rn-canvas`, { fix: `Ajoutez 'rn-canvas/babel' à la liste plugins de ${babelFile} (avant react-native-reanimated/plugin s'il est présent).` });
  else add('ok', `Plugin Babel chargé (${babelFile})`);
  if (babelFile && !deps['babel-preset-expo']) add('warn', 'babel-preset-expo n’est pas une dépendance directe', { detail: 'Un babel.config.js explicite doit pouvoir le résoudre depuis la racine.', fix: installCommand(root, ['babel-preset-expo'], true) });
  else if (babelFile) {
    // Une version d'un autre SDK (installée sans réseau, par exemple) casse la résolution des modules d'Expo.
    const wanted = expectedVersion(root, 'babel-preset-expo');
    const installed = readJson(path.join(root, 'node_modules/babel-preset-expo/package.json'))?.version as string | undefined;
    if (wanted && installed && installed.split('.')[0] !== wanted.replace(/^[~^]/, '').split('.')[0]) {
      add('error', `babel-preset-expo ${installed} ne correspond pas à ce SDK (attendu ${wanted})`, { fix: installCommand(root, ['babel-preset-expo'], true) });
    }
  }

  // Metro
  const metroFile = ['metro.config.js', 'metro.config.cjs'].find((f) => exists(root, f));
  if (!metroFile) add('warn', 'Pas de metro.config.js : remplacements web désactivés', { detail: 'Les modules natifs sans version web risquent de faire planter les écrans.', fix: 'npx rn-canvas init (crée metro.config.js avec withRnCanvas)' });
  else if (!read(root, metroFile).includes('rn-canvas/metro')) {
    add('warn', `${metroFile} n'utilise pas withRnCanvas : remplacements web désactivés`, {
      fix: `Dans ${metroFile} : const { withRnCanvas } = require('rn-canvas/metro'); puis module.exports = withRnCanvas(config);`,
    });
  } else add('ok', `Remplacements web actifs (${metroFile})`);

  // Point d'entrée : mise en page d'expo-router, sinon l'entrée (ou le composant qu'elle enregistre).
  const usesRouter = Boolean(deps['expo-router']);
  const layout = ['app/_layout.tsx', 'app/_layout.jsx', 'app/_layout.js', 'src/app/_layout.tsx', 'src/app/_layout.jsx'].find((f) => exists(root, f));
  if (usesRouter && layout) {
    if (read(root, layout).includes('rn-canvas/runtime')) add('ok', `${layout} branché (expo-router)`);
    else add('error', `${layout} n'est pas branché`, { fix: 'npx rn-canvas init, ou enveloppez la mise en page racine avec withCanvas (voir README).' });
  } else {
    const entry = analyzeEntry(root);
    const wired = entry && (entry.patched || (entry.componentFile && read(root, entry.componentFile).includes('rn-canvas/runtime')));
    if (wired) add('ok', `Point d'entrée branché (${entry!.patched ? entry!.file : entry!.componentFile})`);
    else if (!entry) add('error', "Point d'entrée introuvable", { fix: 'Renseignez "main" dans package.json, ou créez index.js (voir README).' });
    else add('error', `Point d'entrée non branché (${entry.file})`, { fix: 'npx rn-canvas init, ou enveloppez le composant racine avec withCanvas (voir README).' });
  }

  // Écrans
  if (!exists(root, CONFIG_FILE)) add('warn', `Pas de ${CONFIG_FILE}`, { fix: 'npx rn-canvas init' });
  const project = new Project(root);
  const files = project.canvasFiles();
  if (files.length === 0) add('warn', 'Aucun écran déclaré (*.canvas.tsx)', { fix: usesRouter ? 'Créez canvas/MonEcran.canvas.tsx (voir README).' : 'Créez MonEcran.canvas.tsx à côté de l’écran (voir README).' });
  else add('ok', `${files.length} fichier(s) d'écrans déclarés`);
  const inApp = files.filter((f) => f.startsWith('app/'));
  if (usesRouter && inApp.length) add('error', `Fichiers canvas dans app/ : expo-router en fait des routes (${inApp.join(', ')})`, { fix: 'Déplacez-les dans canvas/ et ajoutez "canvas" à "include" dans rn-canvas.json.' });
  if (files.length && !exists(root, loadConfig(root).manifest)) add('warn', 'Manifeste des écrans absent', { fix: 'npx rn-canvas generate' });
  const outside = project.canvasFilesOutsideInclude();
  if (outside.length) {
    const dirs = [...new Set(outside.map((f) => f.split('/')[0]))];
    add('warn', `${outside.length} fichier(s) *.canvas.tsx hors des dossiers « include » : ignorés`, {
      detail: `Dossiers scannés : ${project.config.include.join(', ') || '(aucun)'} ; trouvés dans : ${dirs.join(', ')}.`,
      fix: `Ajoutez ${dirs.map((d) => `"${d}"`).join(', ')} à "include" dans ${CONFIG_FILE}.`,
    });
  }

  // Modules natifs
  let shimmed: string[] = [];
  try {
    shimmed = Object.keys(loadMetro(root).shimsFor(root).shims);
  } catch {
    // metro.cjs introuvable : on ne connaît que les remplacements configurés.
    shimmed = Object.keys(readJson(path.join(root, CONFIG_FILE))?.shims ?? {});
  }
  const replaced: string[] = [];
  const candidates: string[] = [];
  const risky: string[] = [];
  const imported = importedPackages(root, [...new Set([...loadConfig(root).include, 'app', 'src', 'components'])]);
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    // Un module jamais importé par le code de l'app (expo-dev-client…) ne peut pas faire planter un écran.
    if (!imported.has(name)) continue;
    const dir = path.join(root, 'node_modules', name);
    const depPkg = readJson(path.join(dir, 'package.json'));
    if (!depPkg || isWebOk(name)) continue;
    if (shimmed.includes(name)) {
      replaced.push(name);
      continue;
    }
    if (isNative(dir, depPkg) && !hasWebImplementation(dir, depPkg)) candidates.push(name);
  }
  // Déjà remplacés sur le web par le resolveRequest du metro.config.js du projet.
  const byMetro = coveredByMetro(root, metroFile, candidates);
  for (const name of candidates) (byMetro.has(name) ? replaced : risky).push(name);
  if (replaced.length) add('ok', `Remplacés dans le canevas : ${replaced.join(', ')}${byMetro.size ? ` (dont ${[...byMetro].join(', ')} par ${metroFile})` : ''}`);
  for (const name of risky) {
    add('warn', `${name} : module natif sans version web`, {
      detail: "S'il est appelé au chargement d'un écran, l'écran plantera dans le canevas.",
      fix: `npx rn-canvas shim ${name} (crée un remplacement inoffensif et l'ajoute à ${CONFIG_FILE}), ou fichier .web.ts, ou Platform.OS === 'web'.`,
    });
  }
  if (deps['expo-sqlite']) {
    const cfg = loadConfig(root);
    if (cfg.isolateStories) add('ok', 'expo-sqlite : chaque écran a sa propre base (isolateStories)');
    else add('warn', 'expo-sqlite avec isolateStories désactivé', { detail: 'Sur le web, la base ne s’ouvre que dans un cadre à la fois : un seul écran s’affichera.', fix: `Retirez "isolateStories": false de ${CONFIG_FILE} et servez l'app sur localhost.` });
  }

  // Styles
  const styleLibs = Object.keys(STYLE_LIBRARIES).filter((d) => deps[d]);
  if (styleLibs.length) {
    const counts = filesImporting(root, [...new Set([...loadConfig(root).include, 'app', 'src', 'components'])], styleLibs);
    const labels = [...new Set(styleLibs.map((d) => STYLE_LIBRARIES[d]))];
    const total = styleLibs.reduce((n, d) => n + (counts.get(d) ?? 0), 0);
    add('warn', `Styles avec ${labels.join(', ')} : édition des styles limitée (${total} fichier(s) concerné(s))`, {
      detail: "L'éditeur modifie les styles écrits avec StyleSheet ou en ligne ; ces styles-là s'affichent mais restent à modifier dans le code.",
    });
  }

  return checks;
}

const ICON: Record<Level, string> = { ok: '\x1b[32m✓\x1b[0m', warn: '\x1b[33m⚠\x1b[0m', error: '\x1b[31m✗\x1b[0m' };

export function printChecks(checks: Check[]): void {
  for (const c of checks) {
    console.log(`${ICON[c.level]} ${c.title}`);
    if (c.detail) console.log(`    ${c.detail}`);
    if (c.fix) console.log(`    → ${c.fix}`);
  }
  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warn').length;
  console.log(
    errors
      ? `\n${errors} problème(s) bloquant(s), ${warnings} avertissement(s).`
      : warnings
        ? `\nPrêt, avec ${warnings} avertissement(s) : npm run canvas`
        : '\nTout est prêt : npm run canvas',
  );
}
