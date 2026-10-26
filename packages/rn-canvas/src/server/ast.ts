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
