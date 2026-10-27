/**
 * Branchement d'un projet existant (`rn-canvas init`) : point d'entrée, Metro, Babel.
 *
 * Tout ce qui est écrit reste inoffensif sans le paquet (un collègue qui ne l'a pas installé, la CI,
 * le build natif) : les `require` de rn-canvas sont protégés, et le canevas n'existe qu'en
 * développement sur le web.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type AstNode, codeOf, memberPath, parse, programOf, unwrap, walk } from './ast.ts';

const SOURCE = ['.tsx', '.ts', '.jsx', '.js'];

export interface EntryInfo {
  /** Fichier d'entrée (relatif au projet). */
  file: string;
  kind: 'registerRootComponent' | 'AppRegistry' | 'expo-router' | 'unknown';
  /** Composant racine passé à l'enregistrement (`App`). */
  component: string | null;
  /** Fichier qui définit ce composant, s'il est importé par un chemin relatif. */
  componentFile: string | null;
  /** Nom exporté dans `componentFile` (`default` pour un import par défaut). */
  componentExport: string | null;
  /** Déjà branché sur rn-canvas. */
  patched: boolean;
}

/** Point d'entrée résolu comme Metro : `main` du package.json, sinon index.{ts,tsx,js,jsx}. */
export function entryFile(root: string): string | null {
  const pkg = readJson(path.join(root, 'package.json')) as { main?: string } | null;
  const main = pkg?.main && !pkg.main.startsWith('expo-router') ? pkg.main : null;
  const candidates = [...(main ? [main, ...SOURCE.map((ext) => main + ext)] : []), ...SOURCE.map((ext) => `index${ext}`)];
  return candidates.find((f) => isFile(path.join(root, f))) ?? null;
}

/** Ce que fait le point d'entrée : quel composant il enregistre, et d'où il vient. */
export function analyzeEntry(root: string): EntryInfo | null {
  const file = entryFile(root);
  if (!file) return null;
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  const program = programOf(parse(code, file).ast);
  const call = registration(program);
  const component = call ? (wrappedComponent(program, call.component) ?? call.component) : null;
  let componentFile: string | null = null;
  let componentExport: string | null = null;
  if (component) {
    const from = importOf(program, component);
    if (from) {
      componentFile = resolveRelative(root, file, from.source);
      componentExport = from.imported;
    } else if (localFunction(program, component)) {
      componentFile = file;
      componentExport = component;
    }
  }
  return { file, kind: call?.kind ?? 'unknown', component, componentFile, componentExport, patched: code.includes('rn-canvas/runtime') };
}

/** `registerRootComponent(App)` ou `AppRegistry.registerComponent(name, () => App)`. */
function registration(program: AstNode): { kind: EntryInfo['kind']; node: AstNode; component: string } | null {
  // Déjà branché : withRnCanvas(App) → App.
  const strip = (node: AstNode) => (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'withRnCanvas' && node.arguments[0] ? unwrap(node.arguments[0]) : node);
  let found: { kind: EntryInfo['kind']; node: AstNode; component: string } | null = null;
  walk(program, (n) => {
    if (found || n.type !== 'CallExpression') return;
    const callee = memberPath(n.callee);
    if ((callee === 'registerRootComponent' || callee?.endsWith('.registerRootComponent')) && n.arguments[0]) {
      const arg = strip(unwrap(n.arguments[0]));
      if (arg.type === 'Identifier') found = { kind: 'registerRootComponent', node: arg, component: arg.name };
    } else if (callee?.endsWith('AppRegistry.registerComponent') && n.arguments[1]) {
      const fn = unwrap(n.arguments[1]);
      const body = fn.type === 'ArrowFunctionExpression' ? strip(unwrap(fn.body.type === 'BlockStatement' ? returned(fn.body) ?? fn.body : fn.body)) : null;
      if (body?.type === 'Identifier') found = { kind: 'AppRegistry', node: body, component: body.name };
    }
  });
  return found;
}

/** `const RnCanvasApp = withRnCanvas(App)` → `App`. */
function wrappedComponent(program: AstNode, name: string): string | null {
  for (const stmt of program.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const d of stmt.declarations) {
      const init = d.init && unwrap(d.init);
      if (d.id.name === name && init?.type === 'CallExpression' && init.callee.name === 'withRnCanvas' && init.arguments[0]?.type === 'Identifier') return init.arguments[0].name;
    }
  }
  return null;
}

function returned(block: AstNode): AstNode | null {
  const stmt = block.body.find((s: AstNode) => s.type === 'ReturnStatement');
  return stmt?.argument ?? null;
}

function importOf(program: AstNode, name: string): { source: string; imported: string } | null {
  for (const stmt of program.body) {
    if (stmt.type === 'ImportDeclaration') {
      for (const s of stmt.specifiers) {
        if (s.local.name !== name) continue;
        return { source: stmt.source.value, imported: s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value) : 'default' };
      }
    }
    // const App = require('./app/app').default
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        if (d.id.type !== 'Identifier' || d.id.name !== name || !d.init) continue;
        let init = unwrap(d.init);
        let imported = 'default';
        if (init.type === 'MemberExpression' && init.property.type === 'Identifier') {
          imported = init.property.name;
          init = unwrap(init.object);
        }
        if (init.type === 'CallExpression' && init.callee.type === 'Identifier' && init.callee.name === 'require' && init.arguments[0]?.type === 'StringLiteral') {
          return { source: init.arguments[0].value, imported };
        }
      }
    }
  }
  return null;
}

function localFunction(program: AstNode, name: string): boolean {
  return program.body.some((s: AstNode) => {
    const decl = s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration' ? (s.declaration ?? s) : s;
    if (decl.type === 'FunctionDeclaration') return decl.id?.name === name;
    return decl.type === 'VariableDeclaration' && decl.declarations.some((d: AstNode) => d.id.type === 'Identifier' && d.id.name === name);
  });
}

/** Fichier importé par un chemin relatif (`./app/app` → app/app.tsx), extensions et index compris. */
export function resolveRelative(root: string, fromFile: string, source: string): string | null {
  if (!source.startsWith('.')) return null;
  const base = path.resolve(root, path.dirname(fromFile), source);
  for (const candidate of [base, ...SOURCE.map((ext) => base + ext), ...SOURCE.map((ext) => path.join(base, `index${ext}`))]) {
    if (isFile(candidate)) return path.relative(root, candidate).split(path.sep).join('/');
  }
  return null;
}

/**
 * Fonction ajoutée au fichier branché : affiche un écran du canevas (`?rnc-story=…`) en
 * développement web, l'app sinon. Sans le paquet rn-canvas installé, l'app reste telle quelle.
 */
function helper(manifest: string, typed: boolean): string {
  const signature = typed ? 'function withRnCanvas<T>(App: T): T' : 'function withRnCanvas(App)';
  return `
// rn-canvas (éditeur visuel, développement web uniquement) : affiche un écran isolé (?rnc-story=…) à
// la place de l'app. Sans le paquet installé, l'app reste telle quelle.
${signature} {
  if (!__DEV__) return App;
  try {
    return require('rn-canvas/runtime').withCanvas(App, () => require('${manifest}').default);
  } catch {
    return App;
  }
}
`;
}

/** Chemin d'import du manifeste depuis `fromFile`. */
export function manifestSpecifier(root: string, fromFile: string, manifest: string): string {
  let rel = path.relative(path.dirname(path.resolve(root, fromFile)), path.resolve(root, manifest)).split(path.sep).join('/').replace(/\.tsx?$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/** Après le dernier import (ou en tête) : là où ajouter la fonction de branchement. */
function afterImports(program: AstNode): number {
  let at = 0;
  for (const stmt of program.body) if (stmt.type === 'ImportDeclaration') at = stmt.end;
  return at;
}

/** Composant enveloppé déclaré par le branchement d'un point d'entrée AppRegistry. */
const WRAPPED = 'RnCanvasApp';

/** Branche le point d'entrée : `registerRootComponent(withRnCanvas(App))`, ou le composant renvoyé à AppRegistry. */
export function patchEntry(code: string, file: string, manifest: string): string | null {
  if (code.includes('rn-canvas/runtime')) return null;
  const program = programOf(parse(code, file).ast);
  const call = registration(program);
  if (!call) return null;
  const at = afterImports(program);
  const typed = /\.tsx?$/.test(file);
  const head = `${code.slice(0, at)}\n${helper(manifest, typed)}`;
  if (call.kind === 'AppRegistry') {
    // Le fournisseur `() => App` n'est appelé qu'au lancement de l'app, qu'Expo ne fait pas sur le
    // web pour AppRegistry : l'enveloppe est créée avant, pour que le canevas puisse se lancer seul.
    const stmt = program.body.find((s: AstNode) => s.start <= call.node.start && call.node.end <= s.end)!;
    return `${head}${code.slice(at, stmt.start).replace(/^\n+/, '\n')}const ${WRAPPED} = withRnCanvas(${call.component});\n${code.slice(stmt.start, call.node.start)}${WRAPPED}${code.slice(call.node.end)}`;
  }
  return `${head}${code.slice(at, call.node.start).replace(/^\n+/, '\n')}withRnCanvas(${call.component})${code.slice(call.node.end)}`;
}

/** Branche la mise en page racine d'expo-router : `export default withRnCanvas(RootLayout)`. */
export function patchLayout(code: string, file: string, manifest: string): string | null {
  if (code.includes('rn-canvas/runtime')) return null;
  const program = programOf(parse(code, file).ast);
  const def = program.body.find((s: AstNode) => s.type === 'ExportDefaultDeclaration');
  if (!def) return null;
  const typed = /\.tsx?$/.test(file);
  const decl = def.declaration;
  let body: string;
  if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
    // export default function RootLayout() {…} → function RootLayout() {…} … export default withRnCanvas(RootLayout);
    body = `${code.slice(0, def.start)}${codeOf({ code, ast: program, quote: "'" }, decl)}${code.slice(def.end)}\n\nexport default withRnCanvas(${decl.id.name});\n`;
  } else if (decl.type === 'Identifier') {
    body = `${code.slice(0, def.start)}export default withRnCanvas(${decl.name});${code.slice(def.end)}`;
  } else {
    body = `${code.slice(0, decl.start)}withRnCanvas(${code.slice(decl.start, decl.end)})${code.slice(decl.end)}`;
  }
  const next = programOf(parse(body, file).ast);
  const at = afterImports(next);
  return `${body.slice(0, at)}\n${helper(manifest, typed)}${body.slice(at)}`;
}

/** metro.config.js créé par init. */
export const METRO_TEMPLATE = `// withRnCanvas : dans le canevas uniquement (RN_CANVAS=1), remplace les modules natifs sans version web.
// Sans le paquet rn-canvas installé, la configuration reste celle d'Expo.
const { getDefaultConfig } = require('expo/metro-config');

let withRnCanvas = (config) => config;
try {
  ({ withRnCanvas } = require('rn-canvas/metro'));
} catch {}

module.exports = withRnCanvas(getDefaultConfig(__dirname));
`;

/**
 * Enveloppe l'export d'un metro.config.js existant (`module.exports = <expr>;`) avec withRnCanvas,
 * importé de façon tolérante. null si la forme n'est pas reconnue.
 */
export function patchMetro(code: string): string | null {
  if (code.includes('rn-canvas/metro')) return null;
  const program = programOf(parse(code, 'metro.config.js').ast);
  const exported = program.body.find(
    (s: AstNode) => s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' && memberPath(s.expression.left) === 'module.exports',
  );
  if (!exported) return null;
  const value = exported.expression.right;
  const header = `\n// rn-canvas : dans le canevas uniquement (RN_CANVAS=1), remplace les modules natifs sans version web.\nlet withRnCanvas = (config) => config;\ntry {\n  ({ withRnCanvas } = require('rn-canvas/metro'));\n} catch {}\n`;
  return `${code.slice(0, exported.start)}${header.trimStart()}\n${code.slice(exported.start, value.start)}withRnCanvas(${code.slice(value.start, value.end)})${code.slice(value.end)}`;
}

/** Entrée de plugin Babel tolérante : rn-canvas/babel s'il est installé, rien sinon. */
export const BABEL_PLUGIN_ENTRY = "...(() => { try { return [require.resolve('rn-canvas/babel')]; } catch { return []; } })()";

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
