/**
 * CLI rn-canvas.
 *
 *   rn-canvas init       branche le projet courant (config, Babel, point d'entrée, manifeste)
 *   rn-canvas dev        lance l'éditeur (+ le serveur Expo si besoin)
 *   rn-canvas generate   régénère le manifeste des stories
 *   rn-canvas mcp        serveur MCP (stdio) pour piloter les écrans depuis une IA
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/http.ts';
import { serveMcp } from '../server/mcp.ts';
import { CONFIG_FILE, Project } from '../server/project.ts';

const EDITOR_DIR = fileURLToPath(new URL('./editor', import.meta.url));
const ENTRY_IMPORT = "import { withCanvas } from 'rn-canvas/runtime';";

const [command = 'help', ...args] = process.argv.slice(2);
const root = process.cwd();

const commands: Record<string, () => Promise<void> | void> = { init, dev, generate, mcp, help };
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

function help() {
  console.log(`rn-canvas — éditeur visuel aller-retour pour React Native

  rn-canvas init                 Branche le projet courant
  rn-canvas dev [--port 7007]    Lance l'éditeur ; démarre Expo si l'app ne répond pas
              [--no-app]         … sans démarrer Expo
  rn-canvas generate             Régénère le manifeste des stories
  rn-canvas mcp                  Serveur MCP (stdio) : claude mcp add rn-canvas -- npx rn-canvas mcp`);
}

function mcp() {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  serveMcp(new Project(root), pkg.version);
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
    expo = spawn('npx', ['expo', 'start', '--port', appPort], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: process.env, shell: process.platform === 'win32' });
    expo.on('exit', (code) => log(`Expo s'est arrêté (code ${code}).`));
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
    todo.push(`Ajoutez 'rn-canvas/babel' aux plugins de ${path.basename(babelPath)}.`);
  }

  // 3. Point d'entrée
  const entry = [pkg.main, 'index.ts', 'index.tsx', 'index.js'].filter(Boolean).map((f: string) => path.join(root, f)).find((f) => fs.existsSync(f));
  const entryCode = entry ? fs.readFileSync(entry, 'utf8') : '';
  if (entry && !entryCode.includes('rn-canvas/runtime') && /registerRootComponent\(App\);/.test(entryCode)) {
    const manifest = `./${new Project(root).config.manifest.replace(/\.tsx?$/, '')}`;
    const patched = entryCode
      .replace(/(import \{ registerRootComponent \} from 'expo';\n)/, `$1${ENTRY_IMPORT}\n`)
      .replace(
        'registerRootComponent(App);',
        `// En développement web, rn-canvas peut afficher un écran isolé (?rnc-story=…) à la place de l'app.\nregisterRootComponent(__DEV__ ? withCanvas(App, () => require('${manifest}').default) : App);`,
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

  // 4. Script + dépendances web
  pkg.scripts ??= {};
  if (!pkg.scripts.canvas) {
    pkg.scripts.canvas = 'rn-canvas dev';
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    log('Script « npm run canvas » ajouté.');
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const missing = ['react-dom', 'react-native-web', '@expo/metro-runtime'].filter((d) => !deps[d]);
  if (missing.length) todo.push(`Installez le support web : npx expo install ${missing.join(' ')}`);
  // Un babel.config.js explicite doit pouvoir résoudre le preset Expo depuis la racine.
  if (!deps['babel-preset-expo']) todo.push('Installez le preset Babel : npx expo install babel-preset-expo -- --save-dev');

  new Project(root).writeManifest();
  log('Manifeste des stories généré.');

  if (todo.length) {
    log('Il reste à faire :');
    for (const t of todo) console.log(`  • ${t}`);
  }
  log('Créez un fichier *.canvas.tsx à côté d’un écran, puis lancez « npm run canvas ».');
}

function findThemeFile(): { file: string; export: string } | null {
  const candidates = ['src/theme/colors.ts', 'src/presentation/theme/colors.ts', 'src/theme/index.ts', 'theme/colors.ts', 'constants/Colors.ts'];
  for (const file of candidates) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const match = /export const (\w+)\s*(?::[^=]+)?=\s*\{/.exec(fs.readFileSync(abs, 'utf8'));
    if (match) return { file, export: match[1] };
  }
  return null;
}
