/**
 * Lecture du code source et application de modifications par remplacements de texte.
 *
 * On ne réimprime jamais l'AST : chaque modification est un `Patch` (plage de caractères
 * remplacée), le reste du fichier — indentation, commentaires, guillemets — est intact.
 */
import * as babelParser from '@babel/parser';

// Les nœuds viennent de @babel/parser : on les manipule de façon structurelle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AstNode = { type: string; start: number; end: number; loc: { start: { line: number; column: number }; end: { line: number; column: number } }; [key: string]: any };

export interface SourceFile {
  ast: AstNode;
  code: string;
  /** Guillemets dominants du fichier pour les chaînes JavaScript. */
  quote: "'" | '"';
}

export interface Patch {
  start: number;
  end: number;
  text: string;
}

export function parse(code: string, filename: string): SourceFile {
  const isPlainTs = /\.(ts|mts|cts)$/.test(filename);
  const plugins: babelParser.ParserPlugin[] = [];
  if (/\.(ts|tsx|mts|cts)$/.test(filename)) plugins.push('typescript');
  if (!isPlainTs) plugins.push('jsx');

  const ast = babelParser.parse(code, { sourceType: 'module', allowReturnOutsideFunction: true, plugins }) as unknown as AstNode;
  return { ast, code, quote: detectQuote(ast) };
}

/** Applique des patchs disjoints (dans n'importe quel ordre). */
export function applyPatches(code: string, patches: Patch[]): string {
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].end > sorted[i - 1].start) throw new Error('Modifications qui se chevauchent.');
  }
  let out = code;
  for (const p of sorted) out = out.slice(0, p.start) + p.text + out.slice(p.end);
  return out;
}

export function codeOf(src: SourceFile, node: AstNode): string {
  return src.code.slice(node.start, node.end);
}

/** Indentation de la ligne qui contient `offset`. */
export function indentAt(code: string, offset: number): string {
  const lineStart = code.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(code.slice(lineStart))![0];
}

export function quoteJs(value: string, quote: "'" | '"'): string {
  const json = JSON.stringify(value);
  if (quote === '"') return json;
  return `'${json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens', 'range']);

/** Parcours en profondeur, ordre du code source. `visit` peut retourner `false` pour ne pas descendre. */
export function walk(node: AstNode, visit: (node: AstNode, parents: AstNode[]) => boolean | void, parents: AstNode[] = []): void {
  if (visit(node, parents) === false) return;
  const nextParents = [...parents, node];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, visit, nextParents);
    } else if (isNode(value)) {
      walk(value, visit, nextParents);
    }
  }
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

/** Tous les `JSXElement` du fichier, dans l'ordre du code. */
export function jsxElements(ast: AstNode): AstNode[] {
  const out: AstNode[] = [];
  walk(ast, (node) => {
    if (node.type === 'JSXElement') out.push(node);
  });
  return out;
}

export function jsxName(name: AstNode): string | null {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') {
    const object = jsxName(name.object);
    return object ? `${object}.${name.property.name}` : null;
  }
  return null;
}

export function programOf(ast: AstNode): AstNode {
  return ast.type === 'File' ? ast.program : ast;
}

/** Déclarations de variables du module, y compris `export const`. */
export function* moduleDeclarators(ast: AstNode): Generator<AstNode> {
  for (const stmt of programOf(ast).body) {
    const decl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;
    if (decl.type === 'VariableDeclaration') yield* decl.declarations;
  }
}

/** Noms disponibles au niveau du module (imports + déclarations), utilisables comme jetons. */
export function moduleScope(ast: AstNode): string[] {
  const names = new Set<string>();
  for (const stmt of programOf(ast).body) {
    const decl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;
    if (decl.type === 'ImportDeclaration') {
      if (decl.importKind === 'type') continue;
      for (const s of decl.specifiers) if (s.importKind !== 'type') names.add(s.local.name);
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) if (d.id.type === 'Identifier') names.add(d.id.name);
    } else if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
      names.add(decl.id.name);
    }
  }
  return [...names].sort();
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod']);

/** Noms liés par un motif (`x`, `{ a, b: c }`, `[d, ...e]`, `f = 1`). */
function patternNames(pattern: AstNode | null | undefined, out: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      out.add(pattern.name);
      break;
    case 'ObjectPattern':
      for (const p of pattern.properties) patternNames(p.type === 'RestElement' ? p.argument : p.value, out);
      break;
    case 'ArrayPattern':
      for (const e of pattern.elements) patternNames(e, out);
      break;
    case 'AssignmentPattern':
      patternNames(pattern.left, out);
      break;
    case 'RestElement':
      patternNames(pattern.argument, out);
      break;
    case 'TSParameterProperty':
      patternNames(pattern.parameter, out);
      break;
  }
}

export interface Binding {
  kind: 'prop' | 'hook' | 'import' | 'module' | 'local' | 'param';
  detail: string;
  line: number | null;
}

/**
 * Noms accessibles à l'endroit de `node` : ceux du module, plus les paramètres et variables des
 * fonctions et blocs qui l'entourent (ex. `const { colors, spacing } = useTheme()`).
 */
export function scopeAt(ast: AstNode, node: AstNode): string[] {
  return [...bindingsAt(ast, node).keys()].sort();
}

function snippet(code: string, max = 48): string {
  const one = code.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Comme scopeAt, avec l'origine de chaque nom (le plus proche l'emporte). */
export function bindingsAt(ast: AstNode, node: AstNode, code = ''): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  const set = (names: Set<string>, binding: Binding) => {
    for (const n of names) bindings.set(n, binding);
  };

  for (const stmt of programOf(ast).body) {
    const decl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;
    if (decl.type === 'ImportDeclaration' && decl.importKind !== 'type') {
      for (const s of decl.specifiers) if (s.importKind !== 'type') bindings.set(s.local.name, { kind: 'import', detail: `import de '${decl.source.value}'`, line: decl.loc.start.line });
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        const names = new Set<string>();
        patternNames(d.id, names);
        set(names, { kind: 'module', detail: d.init && code ? snippet(code.slice(d.init.start, d.init.end)) : 'constante du fichier', line: d.loc.start.line });
      }
    } else if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
      bindings.set(decl.id.name, { kind: 'module', detail: decl.type === 'ClassDeclaration' ? 'classe du fichier' : 'fonction du fichier', line: decl.loc.start.line });
    }
  }

  let chain: AstNode[] = [];
  walk(ast, (n, parents) => {
    if (chain.length) return false;
    if (n === node) {
      chain = parents;
      return false;
    }
    if (n.start > node.start || n.end < node.end) return false;
  });
  // La première fonction englobante est le composant : ses paramètres sont des props.
  let component: string | null = null;
  let first = true;
  for (let i = 0; i < chain.length; i++) {
    const parent = chain[i];
    if (FUNCTIONS.has(parent.type)) {
      if (first) component = functionName(parent, chain[i - 1]);
      for (const param of parent.params) {
        const names = new Set<string>();
        patternNames(param, names);
        set(names, first ? { kind: 'prop', detail: `prop de ${component ?? 'ce composant'}`, line: param.loc.start.line } : { kind: 'param', detail: 'paramètre de fonction', line: param.loc.start.line });
      }
      first = false;
    }
    if (parent.type === 'BlockStatement') {
      for (const stmt of parent.body) {
        if (stmt.type === 'VariableDeclaration') {
          for (const d of stmt.declarations) {
            const names = new Set<string>();
            patternNames(d.id, names);
            const init = d.init ? unwrap(d.init) : null;
            const callee = init?.type === 'CallExpression' ? memberPath(init.callee) : null;
            const hook = callee && /(^|\.)use[A-Z]\w*$/.test(callee);
            set(names, {
              kind: hook ? 'hook' : 'local',
              detail: hook ? `${callee}()` : init && code ? snippet(code.slice(init.start, init.end)) : 'variable locale',
              line: d.loc.start.line,
            });
          }
        }
        if ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && stmt.id) {
          bindings.set(stmt.id.name, { kind: 'local', detail: 'fonction locale', line: stmt.loc.start.line });
        }
      }
    }
  }
  return bindings;
}

function functionName(fn: AstNode, parent: AstNode | undefined): string | null {
  if (fn.id?.name) return fn.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  return null;
}

/** Noms (identifiants libres) utilisés par une expression : `color ?? colors.text` → color, colors. */
export function freeNames(expression: AstNode): string[] {
  const names = new Set<string>();
  walk(expression, (n, parents) => {
    const parent = parents[parents.length - 1];
    if (n.type !== 'Identifier') return;
    if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
    if (parent?.type === 'ObjectProperty' && parent.key === n && !parent.computed) return;
    names.add(n.name);
  });
  return [...names];
}

/** Retire les enveloppes TypeScript (`as const`, `satisfies`, `!`, parenthèses). */
export function unwrap(node: AstNode): AstNode {
  let current = node;
  while (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'TSTypeAssertion'].includes(current.type)) {
    current = current.expression;
  }
  return current;
}

export function propertyKey(prop: AstNode): string | null {
  if (prop.type !== 'ObjectProperty') return null;
  if (prop.computed) return prop.key.type === 'StringLiteral' ? prop.key.value : null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'StringLiteral' || prop.key.type === 'NumericLiteral') return String(prop.key.value);
  return null;
}

export function findProperty(object: AstNode, key: string): AstNode | undefined {
  return object.properties.find((p: AstNode) => propertyKey(p) === key);
}

export function memberPath(node: AstNode): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const object = memberPath(node.object);
    return object ? `${object}.${node.property.name}` : null;
  }
  return null;
}

function detectQuote(ast: AstNode): "'" | '"' {
  let single = 0;
  let double = 0;
  walk(ast, (node, parents) => {
    // Les attributs JSX (`label="…"`) suivent leur propre convention : on ne les compte pas.
    if (node.type === 'StringLiteral' && node.extra?.raw && parents[parents.length - 1]?.type !== 'JSXAttribute') {
      if (node.extra.raw.startsWith("'")) single++;
      else if (node.extra.raw.startsWith('"')) double++;
    }
  });
  return double > single ? '"' : "'";
}
