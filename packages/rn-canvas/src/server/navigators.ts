/**
 * Écrans déclarés à React Navigation (sans expo-router) : `<Stack.Screen name="Detail" component={DetailScreen} />`,
 * `getComponent={() => require('./Detail').default}`, ou la configuration statique
 * `createNativeStackNavigator({ screens: { Detail: DetailScreen } })`.
 *
 * Chaque écran est suivi jusqu'au fichier qui le définit (imports relatifs, réexports), et ses
 * paramètres de route viennent des types `…ParamList`, sinon des `route.params.x` lus par l'écran.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type AstNode, findProperty, memberPath, parse, programOf, propertyKey, unwrap, walk } from './ast.ts';
import { resolveRelative } from './setup.ts';

export interface NavigationScreen {
  /** Nom de la route (`Detail`). */
  route: string;
  /** Fichier qui définit le composant de l'écran. */
  file: string;
  /** Export de ce fichier (`default` ou un nom). */
  exportName: string;
  /** Paramètres de route requis, avec une valeur d'exemple tirée de leur type. */
  params: { name: string; example: string }[];
  /** Paramètres facultatifs (listés en commentaire dans le fichier généré). */
  optional: string[];
}

interface Declared {
  route: string;
  file: string;
  exportName: string;
}

export interface NavigationReading {
  screens: NavigationScreen[];
  /** Écrans dont le nom n'est connu qu'à l'exécution (`name={key}` dans un `.map`) : `fichier:ligne`. */
  skipped: string[];
  /** Piles imbriquées, lues comme navigateurs et pas comme écrans : `Route (fichier)`. */
  navigators: string[];
}

type ParamTypes = Map<string, { name: string; optional: boolean; type: string }[] | null>;

export function navigationScreens(root: string, files: string[]): NavigationReading {
  const declared: Declared[] = [];
  const skipped: string[] = [];
  const navigators = new Set<string>();
  const paramTypes: ParamTypes = new Map();
  for (const file of files) {
    const program = programAt(root, file);
    if (!program) continue;
    collectParamLists(program, paramTypes);
    for (const d of screenDeclarations(program)) {
      const route = d.route ?? staticString(root, file, program, d.nameNode!);
      if (!route) {
        skipped.push(`${file}:${d.line ?? '?'}`);
        continue;
      }
      const target = componentSource(root, file, program, d.component);
      if (!target) continue;
      // Une pile imbriquée (le composant déclare son propre <X.Navigator>) n'est pas un écran :
      // ses écrans sont lus dans son fichier, qui fait partie des fichiers parcourus.
      if (isNavigatorFile(root, target.file)) {
        navigators.add(`${route} (${target.file})`);
        continue;
      }
      declared.push({ route, ...target });
    }
  }
  const seen = new Set<string>();
  const out: NavigationScreen[] = [];
  for (const d of declared) {
    const key = `${d.file}#${d.exportName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const typed = paramTypes.get(d.route);
    let params: NavigationScreen['params'];
    let optional: string[];
    if (typed !== undefined) {
      params = (typed ?? []).filter((p) => !p.optional).map((p) => ({ name: p.name, example: exampleFor(p.type) }));
      optional = (typed ?? []).filter((p) => p.optional).map((p) => p.name);
    } else {
      params = readParams(root, d.file).map((name) => ({ name, example: "'1'" }));
      optional = [];
    }
    out.push({ ...d, params, optional });
  }
  return { screens: out, skipped, navigators: [...navigators] };
}

/**
 * Le fichier déclare un navigateur (`<Stack.Navigator>` ou `createXNavigator({ screens })`), ou n'est
 * qu'un aiguillage vers des navigateurs (`flag ? <NewStack /> : <LegacyStack />`).
 */
function isNavigatorFile(root: string, file: string, depth = 0): boolean {
  const program = programAt(root, file);
  if (!program) return false;
  let found = false;
  const rendered = new Set<string>();
  walk(program, (n) => {
    if (found) return false;
    if (n.type === 'JSXOpeningElement' && n.name.type === 'JSXMemberExpression' && n.name.property.name === 'Navigator') found = true;
    if (n.type === 'JSXOpeningElement' && n.name.type === 'JSXIdentifier') rendered.add(n.name.name);
    if (n.type === 'CallExpression' && /^create\w*Navigator$/.test(memberPath(n.callee)?.split('.').pop() ?? '') && n.arguments[0]?.type === 'ObjectExpression' && findProperty(n.arguments[0], 'screens')) found = true;
  });
  if (found || depth >= 2 || rendered.size === 0) return found;
  // Aiguillage : tout ce que le fichier rend est un composant importé qui est lui-même un navigateur.
  return [...rendered].every((name) => {
    const target = componentSource(root, file, program, { type: 'Identifier', name } as unknown as AstNode);
    return Boolean(target) && target!.file !== file && isNavigatorFile(root, target!.file, depth + 1);
  });
}

/**
 * Valeur d'une expression connue à la lecture du code : chaîne, gabarit sans variable, ou chemin
 * dans un objet constant (`SCREENS.ORDERS.DETAIL`), déclaré dans le fichier ou importé.
 */
function staticString(root: string, file: string, program: AstNode, node: AstNode): string | null {
  const expr = unwrap(node);
  if (expr.type === 'StringLiteral') return expr.value;
  if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) return expr.quasis[0].value.cooked;
  const member = memberPath(expr);
  if (!member || !member.includes('.')) return null;
  const [name, ...keys] = member.split('.');
  let value = constValue(root, file, program, name, 0);
  for (const key of keys) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : null;
}

/** Valeur d'une constante du module (`const X = {…}`), ou importée (en suivant les réexports). */
function constValue(root: string, file: string, program: AstNode, name: string, depth: number): unknown {
  if (depth > 4) return undefined;
  for (const stmt of program.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type !== 'VariableDeclaration' || decl.kind !== 'const') continue;
    for (const v of decl.declarations) if (v.id.type === 'Identifier' && v.id.name === name && v.init) return literalValue(v.init);
  }
  for (const stmt of program.body) {
    if (stmt.type !== 'ImportDeclaration' || stmt.importKind === 'type') continue;
    const spec = stmt.specifiers.find((sp: AstNode) => sp.local.name === name);
    if (!spec || spec.type === 'ImportNamespaceSpecifier') continue;
    const target = resolveRelative(root, file, stmt.source.value);
    if (!target) return undefined;
    const imported = spec.type === 'ImportDefaultSpecifier' ? 'default' : (spec.imported.name ?? spec.imported.value);
    const found = followExport(root, target, imported, 0);
    const next = programAt(root, found.file);
    if (!next) return undefined;
    if (found.exportName === 'default') {
      const d = next.body.find((st: AstNode) => st.type === 'ExportDefaultDeclaration')?.declaration;
      if (!d) return undefined;
      return d.type === 'Identifier' ? constValue(root, found.file, next, d.name, depth + 1) : literalValue(d);
    }
    return constValue(root, found.file, next, found.exportName, depth + 1);
  }
  return undefined;
}

/** Objet, chaîne ou nombre écrit en dur (`as const` compris) ; le reste vaut undefined. */
function literalValue(node: AstNode): unknown {
  const n = unwrap(node);
  if (n.type === 'StringLiteral' || n.type === 'NumericLiteral' || n.type === 'BooleanLiteral') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
  if (n.type === 'ObjectExpression') {
    const out: Record<string, unknown> = {};
    for (const p of n.properties) {
      const key = propertyKey(p);
      if (key !== null) out[key] = literalValue(p.value);
    }
    return out;
  }
  return undefined;
}

function programAt(root: string, file: string): AstNode | null {
  try {
    return programOf(parse(fs.readFileSync(path.join(root, file), 'utf8'), file).ast);
  } catch {
    return null;
  }
}

/** `<X.Screen name="…" component={…} />`, `getComponent`, et `screens: { Nom: Composant }`. */
interface ScreenDeclaration {
  /** Nom écrit en clair, sinon null : il est alors calculé depuis `nameNode` (constante…). */
  route: string | null;
  nameNode?: AstNode;
  component: AstNode;
  line?: number;
}

function screenDeclarations(program: AstNode): ScreenDeclaration[] {
  const out: ScreenDeclaration[] = [];
  walk(program, (n) => {
    if (n.type === 'JSXOpeningElement' && n.name.type === 'JSXMemberExpression' && n.name.property.name === 'Screen') {
      const attr = (key: string) => n.attributes.find((a: AstNode) => a.type === 'JSXAttribute' && a.name.name === key);
      const name = attr('name')?.value;
      const nameNode = name?.type === 'JSXExpressionContainer' ? name.expression : name;
      const component = attr('component')?.value?.expression ?? getComponent(attr('getComponent')?.value?.expression);
      if (nameNode && component) out.push({ route: null, nameNode, component, line: n.loc?.start.line });
    }
    // API statique (v7) : createXNavigator({ screens: { Detail: DetailScreen, Edit: { screen: EditScreen } } })
    if (n.type === 'CallExpression' && /^create\w*Navigator$/.test(memberPath(n.callee)?.split('.').pop() ?? '') && n.arguments[0]?.type === 'ObjectExpression') {
      const screens = n.arguments[0].properties.find((p: AstNode) => propertyKey(p) === 'screens')?.value;
      for (const p of screens?.type === 'ObjectExpression' ? screens.properties : []) {
        const route = propertyKey(p);
        if (!route) continue;
        const value = unwrap(p.value);
        const component = value.type === 'ObjectExpression' ? value.properties.find((q: AstNode) => propertyKey(q) === 'screen')?.value : value;
        if (component) out.push({ route, component });
      }
    }
  });
  return out;
}

/** `() => require('./Detail').default` → l'expression `require(...)…`. */
function getComponent(fn: AstNode | undefined): AstNode | null {
  if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return null;
  if (fn.body.type !== 'BlockStatement') return fn.body;
  return fn.body.body.find((s: AstNode) => s.type === 'ReturnStatement')?.argument ?? null;
}

/** Fichier et export qui définissent le composant (`DetailScreen` importé, `require('./x').default`…). */
function componentSource(root: string, file: string, program: AstNode, node: AstNode): { file: string; exportName: string } | null {
  const expr = unwrap(node);
  const required = requireOf(expr);
  if (required) {
    const target = resolveRelative(root, file, required.source);
    return target ? followExport(root, target, required.imported, 0) : null;
  }
  if (expr.type !== 'Identifier') return null;
  for (const stmt of program.body) {
    if (stmt.type !== 'ImportDeclaration' || stmt.importKind === 'type') continue;
    const spec = stmt.specifiers.find((s: AstNode) => s.local.name === expr.name);
    if (!spec || spec.type === 'ImportNamespaceSpecifier') continue;
    const target = resolveRelative(root, file, stmt.source.value);
    if (!target) return null;
    return followExport(root, target, spec.type === 'ImportDefaultSpecifier' ? 'default' : (spec.imported.name ?? spec.imported.value), 0);
  }
  // Défini dans le même fichier : seulement s'il est exporté (sinon, impossible à importer).
  return exportedHere(program, expr.name) ? { file, exportName: exportedHere(program, expr.name)! } : null;
}

function requireOf(expr: AstNode): { source: string; imported: string } | null {
  let node = expr;
  let imported = 'default';
  if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
    imported = node.property.name;
    node = unwrap(node.object);
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]?.type === 'StringLiteral') {
    return { source: node.arguments[0].value, imported };
  }
  return null;
}

/** Nom sous lequel `local` est exporté par ce module, s'il l'est. */
function exportedHere(program: AstNode, local: string): string | null {
  for (const stmt of program.body) {
    if (stmt.type === 'ExportDefaultDeclaration') {
      const d = stmt.declaration;
      if ((d.type === 'Identifier' && d.name === local) || d.id?.name === local) return 'default';
    }
    if (stmt.type === 'ExportNamedDeclaration' && !stmt.source) {
      const d = stmt.declaration;
      if (d?.id?.name === local) return local;
      if (d?.type === 'VariableDeclaration' && d.declarations.some((v: AstNode) => v.id.name === local)) return local;
      for (const s of stmt.specifiers ?? []) if (s.local.name === local) return s.exported.name ?? s.exported.value;
    }
  }
  return null;
}

/** Suit les réexports (`export { default as Detail } from './Detail'`, `export * from`) jusqu'à la définition. */
function followExport(root: string, file: string, name: string, depth: number): { file: string; exportName: string } {
  const program = depth < 4 ? programAt(root, file) : null;
  if (!program) return { file, exportName: name };
  for (const stmt of program.body) {
    if (stmt.type === 'ExportNamedDeclaration' && stmt.source) {
      for (const s of stmt.specifiers) {
        if ((s.exported.name ?? s.exported.value) !== name) continue;
        const next = resolveRelative(root, file, stmt.source.value);
        const from = s.type === 'ExportDefaultSpecifier' ? 'default' : (s.local.name ?? s.local.value);
        return next ? followExport(root, next, from, depth + 1) : { file, exportName: name };
      }
    }
  }
  if (name !== 'default' && !definesExport(program, name)) {
    for (const stmt of program.body) {
      if (stmt.type !== 'ExportAllDeclaration') continue;
      const next = resolveRelative(root, file, stmt.source.value);
      const nextProgram = next ? programAt(root, next) : null;
      if (nextProgram && definesExport(nextProgram, name)) return followExport(root, next!, name, depth + 1);
    }
  }
  return { file, exportName: name };
}

function definesExport(program: AstNode, name: string): boolean {
  return program.body.some((s: AstNode) => {
    if (s.type !== 'ExportNamedDeclaration') return false;
    if (s.declaration?.id?.name === name) return true;
    if (s.declaration?.type === 'VariableDeclaration' && s.declaration.declarations.some((v: AstNode) => v.id.name === name)) return true;
    return (s.specifiers ?? []).some((sp: AstNode) => (sp.exported.name ?? sp.exported.value) === name);
  });
}

/** `type RootStackParamList = { Detail: { id: string }; Home: undefined }` (type ou interface). */
function collectParamLists(program: AstNode, out: ParamTypes) {
  walk(program, (n) => {
    let members: AstNode[] | null = null;
    if (n.type === 'TSTypeAliasDeclaration' && /ParamList$/.test(n.id.name) && n.typeAnnotation.type === 'TSTypeLiteral') members = n.typeAnnotation.members;
    if (n.type === 'TSInterfaceDeclaration' && /ParamList$/.test(n.id.name)) members = n.body.body;
    for (const m of members ?? []) {
      if (m.type !== 'TSPropertySignature') continue;
      const route = m.key.type === 'Identifier' ? m.key.name : m.key.type === 'StringLiteral' ? m.key.value : null;
      if (!route || out.get(route)) continue;
      let type = m.typeAnnotation?.typeAnnotation;
      // Detail: { id: string } | undefined → les paramètres deviennent facultatifs.
      let allOptional = false;
      if (type?.type === 'TSUnionType') {
        allOptional = type.types.some((t: AstNode) => t.type === 'TSUndefinedKeyword');
        type = type.types.find((t: AstNode) => t.type === 'TSTypeLiteral');
      }
      if (type?.type !== 'TSTypeLiteral') {
        out.set(route, null);
        continue;
      }
      out.set(
        route,
        type.members
          .filter((p: AstNode) => p.type === 'TSPropertySignature' && p.key.type === 'Identifier')
          .map((p: AstNode) => ({ name: p.key.name, optional: allOptional || Boolean(p.optional), type: p.typeAnnotation?.typeAnnotation?.type ?? '' })),
      );
    }
  });
}

function exampleFor(type: string): string {
  if (type === 'TSNumberKeyword') return '1';
  if (type === 'TSBooleanKeyword') return 'false';
  if (type === 'TSTypeLiteral') return '{}';
  if (type === 'TSArrayType' || type === 'TSTupleType') return '[]';
  return "'1'";
}

/** Paramètres lus par l'écran : `route.params.id`, `route.params?.id`, `const { id } = route.params`. */
function readParams(root: string, file: string): string[] {
  const program = programAt(root, file);
  if (!program) return [];
  const names = new Set<string>();
  const isParams = (node: AstNode) => {
    const n = unwrap(node);
    if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && !n.computed && n.property.name === 'params') {
      const object = unwrap(n.object);
      // route.params, props.route.params, useRoute().params
      return (object.type === 'Identifier' && object.name === 'route') || ((object.type === 'MemberExpression' || object.type === 'OptionalMemberExpression') && object.property.name === 'route') || (object.type === 'CallExpression' && object.callee.name === 'useRoute');
    }
    return false;
  };
  walk(program, (n) => {
    if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && !n.computed && n.property.type === 'Identifier' && isParams(n.object)) names.add(n.property.name);
    if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' && n.init && isParams(n.init)) {
      for (const p of n.id.properties) if (p.type === 'ObjectProperty' && p.key.type === 'Identifier') names.add(p.key.name);
    }
  });
  return [...names];
}
