/**
 * Préparation d'un projet existant : fournisseurs repris de la mise en page racine.
 *
 * On lit le JSX renvoyé par `app/_layout.tsx` (ou `App.tsx`) et on garde la chaîne d'éléments
 * qui enveloppent la navigation (thème, stores, gestes…), sans la navigation elle-même ni les
 * éléments posés à côté (barre d'état, splash, verrouillage). Les props calculées dans le layout
 * ne peuvent pas être reprises telles quelles : elles sont signalées.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type AstNode, codeOf, freeNames, jsxName, parse, programOf, type SourceFile, unwrap, walk } from './ast.ts';
import { analyzeEntry } from './setup.ts';

/** Éléments où la chaîne s'arrête : la navigation, qui affiche les écrans. */
const NAVIGATION = new Set(['Stack', 'Slot', 'Tabs', 'Drawer', 'NavigationContainer', 'Navigator', 'JsStack', 'ExpoRoot']);
/** Éléments sans enfants utiles posés à côté de l'app, laissés de côté. */
const SIDE = new Set(['StatusBar', 'SystemBars', 'LogBox']);
/** Éléments posés à côté de la navigation dont les écrans ont besoin (portails, toasts) : gardés, sauf pilotés par une ref. */
const HOST = /(Host|Toaster|Toast|Snackbar|FlashMessage|Portal)$/;
/**
 * Fournisseurs à effets de bord (télémétrie, mises à jour OTA, notifications, analytics) : écartés,
 * le canevas ne doit ni envoyer d'événements ni télécharger de mise à jour.
 */
const SIDE_EFFECTS = /^(Sentry|PostHog|CodePush|OneSignal|Matomo|Amplitude|Mixpanel|Segment|Datadog|Bugsnag|AppsFlyer|Branch|Firebase|Crashlytics|Intercom)|(Analytics|Telemetry|Tracking|Updates?)(Provider)?$/i;
/** Fournisseurs remplacés par un équivalent sans persistance ni nouvel essai réseau. */
const REPLACED: Record<string, { name: string; attributes: string[]; imports: string[]; declarations: string[]; note: string }> = {
  PersistQueryClientProvider: {
    name: 'QueryClientProvider',
    attributes: ['client={canvasQueryClient}'],
    imports: ["import { QueryClient, QueryClientProvider } from '@tanstack/react-query';"],
    declarations: ['// Client neuf pour le canevas : ni le cache persistant de l’app, ni nouvelles tentatives.\nconst canvasQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });'],
    note: '<PersistQueryClientProvider> remplacé par un QueryClientProvider sur un client neuf (pas de cache persistant, retry: false).',
  },
};

export interface ProvidersProposal {
  /** Contenu proposé pour rn-canvas.config.tsx. */
  code: string;
  /** Fournisseurs repris, de l'extérieur vers l'intérieur. */
  wrappers: string[];
  /** Ce qui n'a pas pu être repris (à compléter à la main). */
  todo: string[];
  /** Fichier lu. */
  source: string;
}

/**
 * Composant racine de l'app : mise en page d'expo-router, sinon le composant enregistré par le point
 * d'entrée (registerRootComponent / AppRegistry, en suivant son import), sinon App.tsx.
 */
export function rootComponentFile(root: string, routerRoot: string | null): { file: string; exportName: string } | null {
  const layout = routerRoot ? ['tsx', 'jsx', 'js'].map((ext) => `${routerRoot}/_layout.${ext}`).find((f) => fs.existsSync(path.join(root, f))) : null;
  if (layout) return { file: layout, exportName: 'default' };
  const entry = analyzeEntry(root);
  if (entry?.componentFile) return { file: entry.componentFile, exportName: entry.componentExport ?? 'default' };
  const app = ['App.tsx', 'App.jsx', 'App.js', 'src/App.tsx', 'src/App.jsx'].find((f) => fs.existsSync(path.join(root, f)));
  return app ? { file: app, exportName: 'default' } : null;
}

export function rootLayoutFile(root: string, routerRoot: string | null): string | null {
  return rootComponentFile(root, routerRoot)?.file ?? null;
}

/** Configuration minimale quand rien n'a pu être repris : à compléter, avec la raison. */
export function skeletonConfig(reason: string, examplesImport: string | null): string {
  return `import React from 'react';
import type { CanvasRuntimeConfig } from 'rn-canvas/runtime';${examplesImport ? `\nimport { generatedExamples } from '${examplesImport}';` : ''}

/**
 * Fournisseurs communs aux écrans affichés dans rn-canvas (thème, stores, i18n, gestes…).
 *
 * À compléter :
 * - ${reason}
 * - Reprenez ici les fournisseurs de votre composant racine (ceux qui enveloppent la navigation),
 *   sans la navigation elle-même ni la télémétrie (Sentry, analytics) ou les mises à jour OTA.
 */
function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
${examplesImport ? `\n/** Données d'exemple des composants (aperçus). Les vôtres, ajoutées après, remplacent celles générées. */\nconst examples: CanvasRuntimeConfig['examples'] = {\n  ...generatedExamples,\n};\n\nconst config: CanvasRuntimeConfig = { wrapper: Providers, examples };` : '\nconst config: CanvasRuntimeConfig = { wrapper: Providers };'}

export default config;
`;
}

/** Fournisseurs de la mise en page racine, sous forme de fichier de configuration prêt à écrire. */
/** `examplesImport` : chemin du fichier d'exemples générés (rn-canvas examples), branché dans la configuration. */
export function proposeProviders(root: string, layoutFile: string, configFile = 'rn-canvas.config.tsx', examplesImport: string | null = null, exportName = 'default'): ProvidersProposal | null {
  const code = fs.readFileSync(path.join(root, layoutFile), 'utf8');
  const src = parse(code, layoutFile);
  const program = programOf(src.ast);
  const fn = rootComponent(program, exportName);
  if (!fn || fn.body.type !== 'BlockStatement') return null;

  const body: AstNode[] = fn.body.body;
  const finalReturn = [...body].reverse().find((s) => s.type === 'ReturnStatement' && s.argument && isJsx(unwrap(s.argument)));
  if (!finalReturn) return null;

  const localComponents = new Set<string>(program.body.flatMap((s: AstNode) => declaredFunctions(s)));
  const skipped: string[] = [];
  const wrappers = chain(unwrap(finalReturn.argument), localComponents, skipped);
  if (wrappers.length === 0) return null;

  const module = moduleNames(program);
  const todo: string[] = skipped.map((n) => `<${n}> écarté : effets de bord (télémétrie, mise à jour OTA, notifications ou analytics).`);
  const extraImports: string[] = [];
  const extraDeclarations: string[] = [];
  const needed = new Set<string>();
  const copied: AstNode[] = [];
  const copy = (name: string) => {
    const decl = module.declarations.get(name);
    if (decl && !copied.includes(decl)) {
      copied.push(decl);
      for (const n of freeNames(decl)) if (module.imports.has(n)) needed.add(n);
    }
  };
  const finalIndex = body.indexOf(finalReturn);
  // Variables du corps du layout (avant son return) : `const scheme = useColorScheme()`… Ses hooks
  // s'exécutent déjà au-dessus de ses fournisseurs : les reprendre dans Providers ne change rien.
  const locals = new Map<string, AstNode>();
  for (const stmt of body.slice(0, finalIndex)) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const d of stmt.declarations) walk(d.id, (n) => void (n.type === 'Identifier' && locals.set(n.name, stmt)));
  }
  const kept = new Set<AstNode>();
  const keep = (stmt: AstNode) => {
    if (kept.has(stmt)) return;
    kept.add(stmt);
    for (const n of freeNames(stmt)) use(n);
  };
  const use = (n: string) => {
    if (module.imports.has(n)) needed.add(n);
    else if (locals.has(n)) keep(locals.get(n)!);
    else if (module.declarations.has(n)) copy(n);
  };
  const available = (name: string) => module.imports.has(name) || module.declarations.has(name) || locals.has(name);

  // Attributs : repris avec ce dont ils dépendent (imports, constantes du fichier, variables du layout).
  const elements = wrappers.map(({ node: el, hosts }) => {
    const original = jsxName(el.openingElement.name)!;
    // Éléments gardés à côté de l'enfant (portails, toasts), avec ce dont ils dépendent.
    const after: string[] = [];
    for (const host of hosts) {
      const hostName = jsxName(host.openingElement.name)!;
      if (host.openingElement.attributes.some((a: AstNode) => a.type === 'JSXAttribute' && a.name.name === 'ref')) {
        todo.push(`<${hostName}> écarté : piloté par une ref de ${layoutFile}.`);
        continue;
      }
      const names = [...jsxNames(host), ...freeNames(host)];
      const missing = names.filter((n) => !available(n));
      if (missing.length) {
        todo.push(`<${hostName}> non repris : dépend de ${missing.join(', ')}.`);
        continue;
      }
      for (const n of names) use(n);
      after.push(codeOf(src, host).replace(/\s*\n\s*/g, ' '));
    }
    const replacement = REPLACED[original];
    if (replacement) {
      extraImports.push(...replacement.imports);
      extraDeclarations.push(...replacement.declarations);
      todo.push(replacement.note);
      return { name: replacement.name, attributes: replacement.attributes, after };
    }
    const name = original;
    needed.add(name.split('.')[0]);
    const attributes: string[] = [];
    for (const attr of el.openingElement.attributes) {
      if (attr.type === 'JSXSpreadAttribute') {
        todo.push(`<${name}> : {...${codeOf(src, attr.argument)}} n'a pas été repris.`);
        continue;
      }
      const names = attr.value ? freeNames(attr.value) : [];
      const missing = names.filter((n) => !available(n));
      if (missing.length) {
        todo.push(`<${name}> : la prop « ${attr.name.name} » dépend de ${missing.join(', ')}, introuvable${missing.length > 1 ? 's' : ''} dans ${layoutFile}.`);
        continue;
      }
      for (const n of names) use(n);
      attributes.push(codeOf(src, attr));
    }
    return { name, attributes, after };
  });

  // Conditions d'attente (`if (!fontsLoaded) return null;`) qui ne dépendent que de hooks de paquets :
  // une condition propre à l'app (session, verrouillage) masquerait les écrans.
  for (const stmt of body.slice(0, finalIndex)) {
    if (stmt.type !== 'IfStatement' || !returnsOnly(stmt.consequent) || stmt.alternate) continue;
    const names = freeNames(stmt.test);
    const decls = names.map((n) => hookDeclaration(body, n));
    const hooks = decls.map((d) => d && hookCallee(d));
    if (decls.some((d) => !d) || hooks.some((h) => !h || !module.imports.has(h) || !isPackage(root, module.imports.get(h)!.source.value))) {
      todo.push(`Condition « ${codeOf(src, stmt.test)} » du layout non reprise (elle dépend de l'app).`);
      continue;
    }
    for (const decl of decls) keep(decl!);
    kept.add(stmt);
  }

  // Code copié : réindenté pour le corps de Providers, chemins relatifs recalculés depuis la configuration.
  const relocate = (text: string) =>
    text.replace(/\b(require|import)\((['"])(\.{1,2}\/[^'"]+)\2\)/g, (_m, fn: string, q: string, rel: string) => {
      let next = path.relative(path.resolve(root, path.dirname(configFile)), path.resolve(root, path.dirname(layoutFile), rel)).split(path.sep).join('/');
      if (!next.startsWith('.')) next = `./${next}`;
      return `${fn}(${q}${next}${q})`;
    });
  const block = (node: AstNode) => {
    const shift = node.loc.start.column - 2;
    return relocate(
      codeOf(src, node)
        .split('\n')
        .map((line, i) => (i === 0 || shift === 0 ? line : shift > 0 ? line.replace(new RegExp(`^ {0,${shift}}`), '') : ' '.repeat(-shift) + line))
        .join('\n'),
    );
  };
  const gates = body.filter((stmt) => kept.has(stmt)).map(block);

  const imports = [...new Set([...importLines(src, module, needed, root, layoutFile, configFile), ...extraImports])];
  const indent = (depth: number) => '  '.repeat(depth);
  const open = elements.map((e, i) => `${indent(i + 2)}<${e.name}${e.attributes.length ? ` ${e.attributes.join(' ')}` : ''}>`);
  // Fermeture de chaque niveau, précédée des éléments gardés à côté de son enfant.
  const close = elements
    .map((e, i) => [...e.after.map((code) => `${indent(i + 3)}${code}`), `${indent(i + 2)}</${e.name}>`].join('\n'))
    .reverse();

  const output = `import React from 'react';
${imports.join('\n')}
import type { CanvasRuntimeConfig } from 'rn-canvas/runtime';${examplesImport ? `\nimport { generatedExamples } from '${examplesImport}';` : ''}
${copied.length || extraDeclarations.length ? `\n${[...copied.map((d) => relocate(codeOf(src, d))), ...extraDeclarations].join('\n\n')}\n` : ''}
/**
 * Fournisseurs communs aux écrans affichés dans rn-canvas, repris de ${layoutFile}
 * (sans la navigation ni ce qui s'affiche à côté : splash, verrouillage, barre d'état…).${todo.length ? `\n *\n * À compléter :\n${todo.map((t) => ` * - ${t}`).join('\n')}` : ''}
 */
function Providers({ children }: { children: React.ReactNode }) {
${gates.map((g) => `  ${g}`).join('\n')}${gates.length ? '\n\n' : ''}  return (
${open.join('\n')}
${indent(elements.length + 2)}{children}
${close.join('\n')}
  );
}

${
    examplesImport
      ? `/** Données d'exemple des composants (aperçus). Les vôtres, ajoutées après, remplacent celles générées. */
const examples: CanvasRuntimeConfig['examples'] = {
  ...generatedExamples,
};

const config: CanvasRuntimeConfig = { wrapper: Providers, examples };`
      : 'const config: CanvasRuntimeConfig = { wrapper: Providers };'
  }

export default config;
`;
  return { code: output, wrappers: elements.map((e) => e.name), todo, source: layoutFile };
}

function isJsx(node: AstNode): boolean {
  return node.type === 'JSXElement' || node.type === 'JSXFragment';
}

function declaredFunctions(stmt: AstNode): string[] {
  const decl = (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') && stmt.declaration ? stmt.declaration : stmt;
  if (decl.type === 'FunctionDeclaration' && decl.id) return [decl.id.name];
  if (decl.type === 'VariableDeclaration') {
    return decl.declarations
      .filter((d: AstNode) => d.id.type === 'Identifier' && d.init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrap(d.init).type))
      .map((d: AstNode) => d.id.name);
  }
  return [];
}

/** Fonction d'une déclaration : directe, ou argument d'un enrobage (`observer(() => …)`, `memo(function App…)`). */
function functionOf(init: AstNode | null | undefined): AstNode | null {
  const node = init && unwrap(init);
  if (!node) return null;
  if (['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) return node;
  if (node.type === 'CallExpression') {
    for (const arg of node.arguments) {
      const fn = functionOf(arg);
      if (fn) return fn;
    }
  }
  return null;
}

/**
 * Fonction du composant racine : l'export nommé `exportName`, sinon l'export par défaut, déballé
 * de ses enrobages (`Sentry.wrap(codePush(opts)(withObserve(App)))`, `withCanvas(X, …)`…).
 */
function rootComponent(program: AstNode, exportName = 'default'): AstNode | null {
  const functions = new Map<string, AstNode>();
  for (const stmt of program.body) {
    const decl = (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') && stmt.declaration ? stmt.declaration : stmt;
    if ((decl.type === 'FunctionDeclaration' || decl.type === 'FunctionExpression') && decl.id) functions.set(decl.id.name, decl);
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        const fn = functionOf(d.init);
        if (d.id.type === 'Identifier' && fn) functions.set(d.id.name, fn);
      }
    }
  }
  if (exportName !== 'default') return functions.get(exportName) ?? null;
  const def = program.body.find((s: AstNode) => s.type === 'ExportDefaultDeclaration');
  if (!def) return null;
  const declaration = def.declaration;
  if (['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression'].includes(declaration.type)) return declaration;
  const wrapped = functionOf(declaration);
  if (wrapped) return wrapped;
  // `export default X`, `Sentry.wrap(codePush(opts)(X))`… : la première fonction du fichier citée.
  let found: AstNode | null = null;
  walk(declaration, (n) => {
    if (found) return false;
    if (n.type === 'Identifier' && functions.has(n.name)) found = functions.get(n.name)!;
  });
  return found;
}

/** Noms des composants utilisés dans un JSX (`<Portal.Host>` → Portal). */
function jsxNames(node: AstNode): string[] {
  const out = new Set<string>();
  walk(node, (n) => {
    if (n.type === 'JSXOpeningElement') {
      const name = jsxName(n.name);
      if (name && /^[A-Z]/.test(name)) out.add(name.split('.')[0]);
    }
  });
  return [...out];
}

const nameOf = (node: AstNode) => (node.type === 'JSXElement' ? (jsxName(node.openingElement.name) ?? '') : '');

/**
 * Chaîne des éléments qui enveloppent la navigation, de l'extérieur vers l'intérieur, avec pour
 * chacun les éléments à garder à côté de l'enfant suivant (portails, toasts). Les fournisseurs à
 * effets de bord sont sautés (leur nom va dans `skipped`) mais on descend dans leur contenu.
 */
function chain(node: AstNode, localComponents: Set<string>, skipped: string[]): { node: AstNode; hosts: AstNode[] }[] {
  if (node.type === 'JSXFragment') {
    const next = pickChild(node.children, localComponents);
    return next ? chain(next, localComponents, skipped) : [];
  }
  if (node.type !== 'JSXElement') return [];
  const name = nameOf(node);
  if (!name) return [];
  const base = name.split('.')[0];
  const last = name.split('.').pop()!;
  if (NAVIGATION.has(base) || NAVIGATION.has(last) || SIDE.has(base) || HOST.test(name) || localComponents.has(base)) return [];
  const next = pickChild(node.children, localComponents);
  if (!next) return [];
  if (SIDE_EFFECTS.test(base) || SIDE_EFFECTS.test(name)) {
    skipped.push(name);
    return chain(next, localComponents, skipped);
  }
  const hosts = node.children.filter((c: AstNode) => c !== next && c.type === 'JSXElement' && HOST.test(nameOf(c)));
  return [{ node, hosts }, ...chain(next, localComponents, skipped)];
}

/** Enfant direct qui mène à l'app : celui qui contient la navigation (ou un composant du fichier). */
function pickChild(children: AstNode[], localComponents: Set<string>): AstNode | null {
  const candidates = children.filter((c) => isJsx(c) && !(c.type === 'JSXElement' && (SIDE.has(nameOf(c).split('.')[0]) || HOST.test(nameOf(c)))));
  if (candidates.length <= 1) return candidates[0] ?? null;
  return (
    candidates.find((c) => {
      let leads = false;
      walk(c, (n) => {
        if (leads) return false;
        if (n.type === 'JSXOpeningElement') {
          const parts = (jsxName(n.name) ?? '').split('.');
          if (NAVIGATION.has(parts[0]) || NAVIGATION.has(parts[parts.length - 1]) || localComponents.has(parts[0])) leads = true;
        }
      });
      return leads;
    }) ?? candidates[0]
  );
}

interface ModuleNames {
  imports: Map<string, AstNode>;
  /** Déclaration (instruction complète) de chaque constante du module. */
  declarations: Map<string, AstNode>;
}

function moduleNames(program: AstNode): ModuleNames {
  const imports = new Map<string, AstNode>();
  const declarations = new Map<string, AstNode>();
  for (const stmt of program.body) {
    if (stmt.type === 'ImportDeclaration' && stmt.importKind !== 'type') {
      for (const s of stmt.specifiers) if (s.importKind !== 'type') imports.set(s.local.name, stmt);
    }
    const decl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) if (d.id.type === 'Identifier') declarations.set(d.id.name, decl);
    }
  }
  return { imports, declarations };
}

function returnsOnly(node: AstNode): boolean {
  if (node.type === 'ReturnStatement') return true;
  return node.type === 'BlockStatement' && node.body.length === 1 && node.body[0].type === 'ReturnStatement';
}

/** Déclaration `const [x] = useHook(…)` du corps du composant qui définit `name`. */
function hookDeclaration(body: AstNode[], name: string): AstNode | null {
  for (const stmt of body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const d of stmt.declarations) {
      const names = new Set<string>();
      walk(d.id, (n) => {
        if (n.type === 'Identifier') names.add(n.name);
      });
      if (names.has(name) && stmt.declarations.length === 1) return stmt;
    }
  }
  return null;
}

function hookCallee(stmt: AstNode): string | null {
  const init = stmt.declarations[0].init && unwrap(stmt.declarations[0].init);
  if (init?.type !== 'CallExpression' || init.callee.type !== 'Identifier' || !/^use[A-Z]/.test(init.callee.name)) return null;
  return init.callee.name;
}

/** Module installé dans node_modules (pas un alias du projet comme `@shared/theme`). */
function isPackage(root: string, source: string): boolean {
  if (source.startsWith('.') || source.startsWith('/')) return false;
  const parts = source.split('/');
  const name = source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return fs.existsSync(path.join(root, 'node_modules', name, 'package.json'));
}

/** Imports des noms utilisés, chemins relatifs recalculés depuis le fichier de configuration. */
function importLines(src: SourceFile, module: ModuleNames, needed: Set<string>, root: string, layoutFile: string, configFile: string): string[] {
  const bySource = new Map<AstNode, AstNode[]>();
  for (const name of needed) {
    const decl = module.imports.get(name);
    if (!decl) continue;
    const spec = decl.specifiers.find((s: AstNode) => s.local.name === name);
    bySource.set(decl, [...(bySource.get(decl) ?? []), spec]);
  }
  const lines: string[] = [];
  for (const [decl, found] of bySource) {
    const specs = [...found].sort((a, b) => a.start - b.start);
    let source: string = decl.source.value;
    if (source.startsWith('.')) {
      const abs = path.resolve(root, path.dirname(layoutFile), source);
      source = path.relative(path.resolve(root, path.dirname(configFile)), abs).split(path.sep).join('/');
      if (!source.startsWith('.')) source = `./${source}`;
    }
    const def = specs.find((s) => s.type === 'ImportDefaultSpecifier');
    const ns = specs.find((s) => s.type === 'ImportNamespaceSpecifier');
    const named = specs
      .filter((s) => s.type === 'ImportSpecifier')
      .map((s) => {
        const imported = s.imported.type === 'Identifier' ? s.imported.name : JSON.stringify(s.imported.value);
        return imported === s.local.name ? imported : `${imported} as ${s.local.name}`;
      });
    const parts = [def?.local.name, ns ? `* as ${ns.local.name}` : null, named.length ? (named.length > 3 ? `{\n  ${named.join(',\n  ')},\n}` : `{ ${named.join(', ')} }`) : null].filter(Boolean);
    lines.push(`import ${parts.join(', ')} from ${JSON.stringify(source).replace(/^"|"$/g, src.quote)};`);
  }
  return lines;
}
