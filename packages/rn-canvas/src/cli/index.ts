/**
 * CLI rn-canvas.
 *
 *   rn-canvas init       branche le projet courant (config, Babel, point d'entrée, manifeste)
 *   rn-canvas dev        lance l'éditeur (+ le serveur Expo si besoin)
 *   rn-canvas generate   régénère le manifeste des stories
 *   rn-canvas screens    crée un fichier canvas par route d'expo-router qui n'en a pas
 *   rn-canvas examples   données d'exemple des composants, tirées des types de leurs props
 *   rn-canvas providers  propose rn-canvas.config.tsx à partir des fournisseurs du layout racine
 *   rn-canvas mcp        serveur MCP (stdio) pour piloter les écrans depuis une IA
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/http.ts';
import { serveMcp } from '../server/mcp.ts';
import { CONFIG_FILE, Project } from '../server/project.ts';
import { diagnose, installCommand, printChecks } from './doctor.ts';
import { addBabelPlugin } from './patch.ts';
import { proposeProviders, rootLayoutFile } from '../server/scaffold.ts';
import { examplesFile } from '../server/examples.ts';

const EDITOR_DIR = fileURLToPath(new URL('./editor', import.meta.url));
const ENTRY_IMPORT = "import { withCanvas } from 'rn-canvas/runtime';";

const [command = 'help', ...args] = process.argv.slice(2);
const root = process.cwd();

const commands: Record<string, () => Promise<void> | void> = { init, dev, generate, screens, providers, examples, mcp, doctor, help };
await (commands[command] ?? help)();

function flag(name: string): string | true | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function log(message: string) {
  console.log(`\x1b[35m[rn-canvas]\x1b[0m ${message}`);
}

function doctor() {
  const checks = diagnose(root);
  printChecks(checks);
  if (checks.some((c) => c.level === 'error')) process.exitCode = 1;
}

function help() {
  console.log(`rn-canvas — éditeur visuel aller-retour pour React Native

  rn-canvas init                 Branche le projet courant
  rn-canvas dev [--port 7007]    Lance l'éditeur ; démarre Expo si l'app ne répond pas
              [--no-app]         … sans démarrer Expo
  rn-canvas generate             Régénère le manifeste des stories
  rn-canvas screens              Crée un écran du canevas pour chaque route de app/ qui n'en a pas
  rn-canvas examples             Génère les données d'exemple des composants à partir des types de leurs props
  rn-canvas providers            Reprend les fournisseurs de app/_layout.tsx (ou App.tsx) dans rn-canvas.config.tsx
              [--print]          … ou les affiche sans rien écrire
  rn-canvas doctor               Vérifie le projet : ce qui bloquera le canevas, et comment le corriger
  rn-canvas mcp                  Serveur MCP (stdio) : claude mcp add rn-canvas -- npx rn-canvas mcp`);
}

function mcp() {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  serveMcp(new Project(root), pkg.version);
}

function screens() {
  const project = new Project(root);
  if (!project.config.routerRoot) return log("Pas de dossier de routes expo-router (app/) : rien à générer.");
  const { created } = project.generateRouteStories();
  if (!created.length) return log('Chaque route a déjà son écran.');
  log(`${created.length} écran(s) créé(s) :`);
  for (const file of created) console.log(`  • ${file}`);
}

/** Écrit rn-canvas.config.tsx (s'il n'existe pas) avec les fournisseurs du layout racine. */
function writeProviders(project: Project, print: boolean): void {
  const layout = rootLayoutFile(root, project.config.routerRoot);
  if (!layout) return log('Aucune mise en page racine trouvée (app/_layout.tsx, App.tsx) : pas de fournisseurs à reprendre.');
  const generated = examplesFile(project.config.include);
  const proposal = proposeProviders(root, layout, project.config.runtimeConfig, fs.existsSync(path.join(root, generated)) ? relativeImport(project.config.runtimeConfig, generated) : null);
  if (!proposal) return log(`Aucun fournisseur reconnu dans ${layout} : ajoutez-les dans ${project.config.runtimeConfig} (voir README).`);
  const target = path.join(root, project.config.runtimeConfig);
  if (print || fs.existsSync(target)) {
    if (!print) log(`${project.config.runtimeConfig} existe déjà : proposition affichée, rien n'est écrit.`);
    console.log(proposal.code);
    return;
  }
  fs.writeFileSync(target, proposal.code);
  log(`${project.config.runtimeConfig} créé avec les fournisseurs de ${layout} : ${proposal.wrappers.join(', ')}.`);
  for (const t of proposal.todo) console.log(`  • ${t}`);
}

function examples() {
  const project = new Project(root);
  const result = project.writeGeneratedExamples();
  if (!result) return log("TypeScript introuvable dans le projet : pas de données d'exemple générées.");
  log(`${result.file} ${result.changed ? 'écrit' : 'déjà à jour'} : ${result.components.length} composant(s).`);
  const config = path.join(root, project.config.runtimeConfig);
  if (fs.existsSync(config) && !fs.readFileSync(config, 'utf8').includes('generatedExamples')) {
    log(`Pour les utiliser, dans ${project.config.runtimeConfig} : import { generatedExamples } from '${relativeImport(project.config.runtimeConfig, result.file)}';`);
    console.log('  puis examples: { ...generatedExamples, ...vosExemples } (les vôtres restent prioritaires).');
  }
}

function relativeImport(from: string, to: string): string {
  const rel = path.posix.relative(path.posix.dirname(from), to.replace(/\.tsx?$/, ''));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function providers() {
  writeProviders(new Project(root), flag('print') === true);
}

function generate() {
  const project = new Project(root);
  log(project.writeManifest() ? `Manifeste écrit : ${project.config.manifest}` : 'Manifeste déjà à jour.');
}

async function dev() {
  const project = new Project(root);
  const port = Number(flag('port') === true ? 7007 : (flag('port') ?? 7007));
  project.writeManifest();

  const server = await startServer(project, { port, editorDir: EDITOR_DIR });

  // Exemples générés (si le projet les utilise) : remis à jour en arrière-plan, pour les nouveaux composants.
  if (fs.existsSync(path.join(root, examplesFile(project.config.include)))) {
    setTimeout(() => {
      try {
        if (project.writeGeneratedExamples()?.changed) log("Données d'exemple des composants mises à jour.");
      } catch (error) {
        log(`Données d'exemple non mises à jour : ${(error as Error).message}`);
      }
    }, 2000);
  }

  // Nouvelles stories / config runtime : on régénère le manifeste et on prévient l'éditeur.
  const watched = [...project.config.include, path.dirname(project.config.runtimeConfig)];
  let timer: NodeJS.Timeout | undefined;
  for (const dir of new Set(watched)) {
    const abs = path.resolve(root, dir);
    if (!fs.existsSync(abs)) continue;
    fs.watch(abs, { recursive: dir !== '.' }, (_event, filename) => {
      const name = String(filename ?? '');
      if (!/\.canvas\.(tsx|ts|jsx|js)$/.test(name) && path.basename(name) !== path.basename(project.config.runtimeConfig)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        project.writeManifest();
        server.notify('stories');
      }, 100);
    });
  }

  let expo: ChildProcess | undefined;
  if (!flag('no-app') && !(await reachable(project.config.appUrl))) {
    const appPort = new URL(project.config.appUrl).port || '8081';
    log(`Démarrage d'Expo sur le port ${appPort}…`);
    // RN_CANVAS=1 : active les remplacements web de withRnCanvas (metro.config.js).
    expo = spawn('npx', ['expo', 'start', '--port', appPort], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, RN_CANVAS: '1' }, shell: process.platform === 'win32' });
    expo.on('exit', (code) => log(`Expo s'est arrêté (code ${code}).`));
  } else if (!flag('no-app')) {
    const status = await shimStatus(project.config.appUrl);
    if (status === 'off') log("\x1b[33mExpo tourne déjà, sans les remplacements web de rn-canvas.\x1b[0m Arrêtez-le puis relancez « npm run canvas » (ou démarrez Expo avec RN_CANVAS=1).");
    if (status === 'missing') log("\x1b[33mmetro.config.js n'utilise pas withRnCanvas : remplacements web désactivés.\x1b[0m Voir « npx rn-canvas doctor ».");
  }

  log(`Éditeur prêt : \x1b[1m${server.url}\x1b[0m (app : ${project.config.appUrl})`);

  const stop = async () => {
    expo?.kill('SIGINT');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

/** Expo tourne-t-il avec les remplacements web (marqueur exposé par withRnCanvas) ? */
async function shimStatus(appUrl: string): Promise<'on' | 'off' | 'missing'> {
  try {
    const res = await fetch(new URL('/__rn-canvas', appUrl), { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return 'missing';
    const body = (await res.json()) as { shims?: boolean };
    return body.shims ? 'on' : 'off';
  } catch {
    return 'missing';
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function init() {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error('Aucun package.json ici : lancez la commande à la racine du projet.');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const todo: string[] = [];

  // 1. Configuration
  const configPath = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    const theme = findThemeFile();
    const config: Record<string, unknown> = { appUrl: 'http://localhost:8081' };
    // Avec expo-router, tout fichier de app/ devient une route : les stories vont dans canvas/.
    // Composants (src/, components/) pour la bibliothèque, écrans du canevas dans canvas/.
    if (pkg.dependencies?.['expo-router']) config.include = [...['src', 'components'].filter((d) => fs.existsSync(path.join(root, d))), 'canvas'];
    if (theme) config.theme = theme;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    log(`${CONFIG_FILE} créé${theme ? ` (thème : ${theme.file})` : ''}.`);
  }

  // 2. Babel
  const babelPath = ['babel.config.js', 'babel.config.cjs', '.babelrc', '.babelrc.js'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!babelPath) {
    fs.writeFileSync(
      path.join(root, 'babel.config.js'),
      `module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Ne s'active que pour le bundle web de développement.
    plugins: ['rn-canvas/babel'],
  };
};
`,
    );
    log('babel.config.js créé.');
  } else if (!fs.readFileSync(babelPath, 'utf8').includes('rn-canvas/babel')) {
    const patched = addBabelPlugin(fs.readFileSync(babelPath, 'utf8'));
    if (patched) {
      fs.writeFileSync(babelPath, patched);
      log(`Plugin rn-canvas ajouté à ${path.basename(babelPath)}.`);
    } else {
      todo.push(`Ajoutez 'rn-canvas/babel' aux plugins de ${path.basename(babelPath)}.`);
    }
  }

  // 3. Point d'entrée
  const usesRouter = Boolean(pkg.dependencies?.['expo-router']);
  const layoutFile = ['app/_layout.tsx', 'app/_layout.jsx', 'app/_layout.js', 'src/app/_layout.tsx'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  const manifestOf = (from: string) => {
    let rel = path.relative(path.dirname(from), path.resolve(root, new Project(root).config.manifest)).split(path.sep).join('/').replace(/\.tsx?$/, '');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
  };

  if (usesRouter && layoutFile) {
    // expo-router : on enveloppe la mise en page racine (app/_layout.tsx).
    const code = fs.readFileSync(layoutFile, 'utf8');
    const match = /export default function (\w+)\(/.exec(code);
    if (code.includes('rn-canvas/runtime')) {
      // Déjà branché.
    } else if (match) {
      const name = match[1];
      const lastImport = [...code.matchAll(/^import [^;]+;$/gms)].pop();
      const at = lastImport ? lastImport.index! + lastImport[0].length : 0;
      const patched =
        `${code.slice(0, at)}\n${ENTRY_IMPORT}${code.slice(at)}`.replace(match[0], `function ${name}(`) +
        `\n// En développement web, rn-canvas peut afficher un écran isolé (?rnc-story=…) à la place de l'app.\n` +
        `export default __DEV__ ? withCanvas(${name}, () => require('${manifestOf(layoutFile)}').default) : ${name};\n`;
      fs.writeFileSync(layoutFile, patched);
      log(`${path.relative(root, layoutFile)} branché (expo-router).`);
    } else {
      todo.push(`Dans ${path.relative(root, layoutFile)} : enveloppez la mise en page racine avec withCanvas (voir README de rn-canvas).`);
    }
  } else {
    const entry = [pkg.main, 'index.ts', 'index.tsx', 'index.js'].filter(Boolean).map((f: string) => path.join(root, f)).find((f) => fs.existsSync(f));
    const entryCode = entry ? fs.readFileSync(entry, 'utf8') : '';
    if (entry && !entryCode.includes('rn-canvas/runtime') && /registerRootComponent\(App\);/.test(entryCode)) {
      const patched = entryCode
        .replace(/(import \{ registerRootComponent \} from 'expo';\n)/, `$1${ENTRY_IMPORT}\n`)
        .replace(
          'registerRootComponent(App);',
          `// En développement web, rn-canvas peut afficher un écran isolé (?rnc-story=…) à la place de l'app.\nregisterRootComponent(__DEV__ ? withCanvas(App, () => require('${manifestOf(entry)}').default) : App);`,
        );
      if (patched.includes(ENTRY_IMPORT)) {
        fs.writeFileSync(entry, patched);
        log(`${path.basename(entry)} branché.`);
      } else {
        todo.push(`Dans ${path.basename(entry)} : enveloppez App avec withCanvas (voir README de rn-canvas).`);
      }
    } else if (!entryCode.includes('rn-canvas/runtime')) {
      todo.push("Dans votre point d'entrée : enveloppez App avec withCanvas (voir README de rn-canvas).");
    }
  }

  // 3 bis. Metro : remplacements web des modules natifs
  const metroPath = ['metro.config.js', 'metro.config.cjs'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!metroPath) {
    fs.writeFileSync(
      path.join(root, 'metro.config.js'),
      `// withRnCanvas : dans le canevas uniquement, remplace les modules natifs sans version web.
const { getDefaultConfig } = require('expo/metro-config');
const { withRnCanvas } = require('rn-canvas/metro');

module.exports = withRnCanvas(getDefaultConfig(__dirname));
`,
    );
    log('metro.config.js créé (remplacements web).');
  } else if (!fs.readFileSync(metroPath, 'utf8').includes('rn-canvas/metro')) {
    todo.push(`Dans ${path.basename(metroPath)} : const { withRnCanvas } = require('rn-canvas/metro'); puis module.exports = withRnCanvas(config);`);
  }

  // 4. Script + dépendances web
  pkg.scripts ??= {};
  if (!pkg.scripts.canvas) {
    pkg.scripts.canvas = 'rn-canvas dev';
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    log('Script « npm run canvas » ajouté.');
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const missing = ['react-dom', 'react-native-web', '@expo/metro-runtime'].filter((d) => !deps[d]);
  if (missing.length) todo.push(`Installez le support web : ${installCommand(root, missing)}`);
  // Un babel.config.js explicite doit pouvoir résoudre le preset Expo depuis la racine.
  if (!deps['babel-preset-expo']) todo.push(`Installez le preset Babel : ${installCommand(root, ['babel-preset-expo'], true)}`);

  // 5. Fournisseurs du layout racine, puis un écran par route d'expo-router (rien n'est écrasé)
  const project = new Project(root);
  const generated = project.writeGeneratedExamples();
  if (generated?.components.length) log(`Données d'exemple tirées des types : ${generated.components.length} composant(s) dans ${generated.file}.`);
  if (!fs.existsSync(path.join(root, project.config.runtimeConfig))) writeProviders(project, false);
  if (project.config.routerRoot) {
    const { created } = project.generateRouteStories();
    if (created.length) log(`${created.length} écran(s) créé(s) depuis ${project.config.routerRoot}/ dans ${path.dirname(created[0])}/.`);
  }

  project.writeManifest();
  log('Manifeste des stories généré.');

  if (todo.length) {
    log('Il reste à faire :');
    for (const t of todo) console.log(`  • ${t}`);
  }
  log('Vérifiez le projet avec « npx rn-canvas doctor ».');
  log(
    pkg.dependencies?.['expo-router']
      ? 'Lancez « npm run canvas ». Les écrans sont dans canvas/ (pas dans app/ : ce seraient des routes).'
      : 'Créez un fichier *.canvas.tsx à côté d’un écran, puis lancez « npm run canvas ».',
  );
}

function findThemeFile(): { file: string; export: string } | null {
  const candidates = ['src/theme/colors.ts', 'src/shared/theme/colors.ts', 'src/presentation/theme/colors.ts', 'src/theme/index.ts', 'theme/colors.ts', 'constants/Colors.ts'];
  for (const file of candidates) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const match = /export const (\w+)\s*(?::[^=]+)?=\s*\{/.exec(fs.readFileSync(abs, 'utf8'));
    if (match) return { file, export: match[1] };
  }
  return null;
}

