/**
 * Modifications de structure : supprimer, dupliquer, déplacer, insérer des éléments JSX.
 *
 * Comme pour les styles, tout passe par des patchs texte : le code déplacé est réindenté
 * à sa nouvelle place, le reste du fichier n'est pas touché.
 */
import type { InsertPosition } from '../shared/protocol.ts';
import { type AstNode, type Patch, type SourceFile, codeOf, indentAt, jsxName, moduleScope, programOf, quoteJs, walk } from './ast.ts';
import { SourceError, meaningfulChildren } from './inspect.ts';

/** Un patch d'insertion, avec la position du nouvel élément à l'intérieur de `text`. */
export interface Insertion extends Patch {
  offset: number;
}

export function parentOf(ast: AstNode, node: AstNode): AstNode | null {
  let parent: AstNode | null = null;
  walk(ast, (n, parents) => {
    if (parent) return false;
    if (n === node) {
      parent = parents[parents.length - 1] ?? null;
      return false;
    }
    // Inutile de descendre dans un nœud qui ne contient pas la cible.
    if (n.start > node.start || n.end < node.end) return false;
  });
  return parent;
}

/** L'élément, ou le bloc `{…}` qui le contient, enfant direct d'un élément JSX. */
function siblingAnchor(ast: AstNode, element: AstNode): AstNode {
  let node = element;
  for (;;) {
    const parent = parentOf(ast, node);
    if (!parent) return element;
    if (parent.type === 'JSXElement' || parent.type === 'JSXFragment') return node;
    // Racine d'un composant (return, flèche…) : pas de frère possible, l'erreur sera expliquée plus loin.
    if (/Function|ReturnStatement|VariableDeclarator|Program/.test(parent.type)) return element;
    node = parent;
  }
}

/** Un élément n'est déplaçable/supprimable que s'il est l'enfant direct d'un autre élément JSX. */
function assertJsxChild(ast: AstNode, element: AstNode, action: string): AstNode {
  const parent = parentOf(ast, element);
  if (parent?.type !== 'JSXElement' && parent?.type !== 'JSXFragment') {
    throw new SourceError(`Impossible de ${action} cet élément ici : il n'est pas l'enfant direct d'un autre élément (racine d'un composant, condition, liste…).`);
  }
  return parent;
}

function lineStart(code: string, offset: number): number {
  return code.lastIndexOf('\n', offset - 1) + 1;
}

/** L'élément occupe-t-il seul sa ligne ? */
function ownsLine(code: string, node: AstNode): boolean {
  const before = code.slice(lineStart(code, node.start), node.start);
  const nl = code.indexOf('\n', node.end);
  const after = code.slice(node.end, nl === -1 ? code.length : nl);
  return /^\s*$/.test(before) && /^\s*$/.test(after);
}

/** Plage à retirer pour supprimer un élément : la ligne entière s'il est seul dessus. */
function removalRange(code: string, node: AstNode): Patch {
  if (!ownsLine(code, node)) return { start: node.start, end: node.end, text: '' };
  const nl = code.indexOf('\n', node.end);
  return { start: lineStart(code, node.start), end: nl === -1 ? code.length : nl + 1, text: '' };
}

/** Unité d'indentation du fichier (2 espaces, 4 espaces ou tabulation). */
export function indentUnit(code: string): string {
  if (/^\t/m.test(code)) return '\t';
  let min = Infinity;
  // Les lignes de commentaire de bloc (` * …`) ne disent rien du pas d'indentation.
  for (const m of code.matchAll(/^( +)([^\s*])/gm)) min = Math.min(min, m[1].length);
  return ' '.repeat(Number.isFinite(min) && min <= 8 ? min : 2);
}

/** Réindente un bloc multi-ligne (la première ligne est placée par l'appelant). */
function reindent(text: string, from: string, to: string): string {
  return text
    .split('\n')
    .map((line, i) => (i > 0 && line.startsWith(from) ? to + line.slice(from.length) : line))
    .join('\n');
}

/**
 * Patch qui place `block` (code JSX dont les lignes suivantes sont indentées par `blockIndent`)
 * avant, après ou à l'intérieur de `target`.
 */
export function insertion(src: SourceFile, target: AstNode, position: InsertPosition, block: string, blockIndent: string): Insertion {
  const { code } = src;
  const unit = indentUnit(code);

  if (position === 'before' || position === 'after') {
    // Élément dans une condition ou une liste (`{cond && <X />}`, `{items.map(…)}`) : à côté du bloc
    // entier, sinon le JSX serait invalide (deux éléments adjacents sans parent).
    target = siblingAnchor(src.ast, target);
    if (!ownsLine(code, target)) {
      return position === 'before' ? { start: target.start, end: target.start, text: block, offset: 0 } : { start: target.end, end: target.end, text: block, offset: 0 };
    }
    const ind = indentAt(code, target.start);
    const body = reindent(block, blockIndent, ind);
    return position === 'before'
      ? { start: lineStart(code, target.start), end: lineStart(code, target.start), text: `${ind}${body}\n`, offset: ind.length }
      : { start: target.end, end: target.end, text: `\n${ind}${body}`, offset: 1 + ind.length };
  }

  if (target.type !== 'JSXElement') throw new SourceError("On ne peut insérer qu'à l'intérieur d'un élément JSX.");
  const opening = target.openingElement;
  const ind = indentAt(code, target.start);
  const childInd = ind + unit;

  if (opening.selfClosing) {
    // `<View … />` → `<View …>\n  bloc\n</View>`
    let start = code.lastIndexOf('/', opening.end - 1);
    while (start > 0 && /\s/.test(code[start - 1])) start--;
    const head = `>\n${childInd}`;
    return { start, end: opening.end, text: `${head}${reindent(block, blockIndent, childInd)}\n${ind}</${jsxName(opening.name)}>`, offset: head.length };
  }

  const children = meaningfulChildren(target);
  const last = children[children.length - 1];
  if (!last) {
    const head = `\n${childInd}`;
    return { start: opening.end, end: target.closingElement.start, text: `${head}${reindent(block, blockIndent, childInd)}\n${ind}`, offset: head.length };
  }
  if (!ownsLine(code, last)) return { start: last.end, end: last.end, text: block, offset: 0 };
  const lastInd = indentAt(code, last.start);
  return { start: last.end, end: last.end, text: `\n${lastInd}${reindent(block, blockIndent, lastInd)}`, offset: 1 + lastInd.length };
}

/** Position finale d'une insertion une fois tous les patchs appliqués. */
export function finalOffset(ins: Insertion, patches: Patch[]): number {
  let shift = 0;
  for (const p of patches) {
    if (p === ins) continue;
    if (p.end <= ins.start) shift += p.text.length - (p.end - p.start);
  }
  return ins.start + shift + ins.offset;
}

// ---- Opérations ----

export function removeElement(src: SourceFile, element: AstNode): Patch[] {
  assertJsxChild(src.ast, element, 'supprimer');
  return [removalRange(src.code, element)];
}

export function duplicateElement(src: SourceFile, element: AstNode): { patches: Patch[]; inserted: Insertion } {
  assertJsxChild(src.ast, element, 'dupliquer');
  const inserted = insertion(src, element, 'after', codeOf(src, element), indentAt(src.code, element.start));
  return { patches: [inserted], inserted };
}

export function moveElement(src: SourceFile, element: AstNode, target: AstNode, position: InsertPosition): { patches: Patch[]; inserted: Insertion } {
  if (element === target) throw new SourceError('Un élément ne peut pas être déplacé sur lui-même.');
  if (target.start >= element.start && target.end <= element.end) {
    throw new SourceError('Impossible de déplacer un élément à l’intérieur de lui-même.');
  }
  assertJsxChild(src.ast, element, 'déplacer');
  if (position !== 'inside') assertJsxChild(src.ast, target, 'déplacer à côté de');

  const removal = removalRange(src.code, element);
  const inserted = insertion(src, target, position, codeOf(src, element), indentAt(src.code, element.start));
  if (inserted.start > removal.start && inserted.start < removal.end) throw new SourceError('Déplacement impossible à cet endroit.');
  return { patches: [removal, inserted], inserted };
}

export interface ComponentProp {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'function' | 'array' | 'unknown';
}

/** Code JSX d'un nouvel élément, avec des valeurs d'exemple pour les props obligatoires. */
export function componentJsx(name: string, props: ComponentProp[]): string {
  if (name === 'Text') return '<Text>Nouveau texte</Text>';
  if (name === 'TextInput') return '<TextInput placeholder="Saisir…" />';
  const attrs = props
    .filter((p) => p.name !== 'children')
    .map((p) => {
      switch (p.type) {
        case 'string':
          return `${p.name}="${p.name.charAt(0).toUpperCase()}${p.name.slice(1)}"`;
        case 'number':
          return `${p.name}={0}`;
        case 'boolean':
          return `${p.name}={false}`;
        case 'function':
          return `${p.name}={() => {}}`;
        case 'array':
          return `${p.name}={[]}`;
        default:
          return null;
      }
    })
    .filter(Boolean);
  const open = `${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
  // Composant de texte du projet (AppText, Typography…) : un texte d'exemple, sinon il serait invisible.
  if (/(Text|Typography|Title|Heading)$/.test(name)) return `<${open}>Nouveau texte</${name}>`;
  // Autre composant à enfants obligatoires : un emplacement vide, valide pour ReactNode.
  if (props.some((p) => p.name === 'children')) return `<${open}>{null}</${name}>`;
  return `<${open} />`;
}

/** Ajoute l'import d'un composant s'il n'est pas déjà en portée. `from` = spécificateur de module. */
export function ensureImport(src: SourceFile, name: string, from: string): Patch[] {
  const program = programOf(src.ast);
  const imports: AstNode[] = program.body.filter((s: AstNode) => s.type === 'ImportDeclaration');
  const existing = imports.find((d) => d.importKind !== 'type' && d.source.value === from);
  if (existing?.specifiers.some((s: AstNode) => s.type === 'ImportSpecifier' && s.local.name === name)) return [];
  // Déjà importé sous un autre chemin vers le même module (alias `@presentation/…` au lieu d'un chemin relatif).
  const moduleName = (source: string) => source.replace(/\/index$/, '').split('/').pop();
  const sameModule = imports.some(
    (d) => d.importKind !== 'type' && moduleName(d.source.value) === moduleName(from) && d.specifiers.some((s: AstNode) => s.local.name === name),
  );
  if (sameModule) return [];
  if (moduleScope(src.ast).includes(name)) throw new SourceError(`« ${name} » est déjà défini dans ce fichier par autre chose.`);

  const named: AstNode[] = existing?.specifiers.filter((s: AstNode) => s.type === 'ImportSpecifier') ?? [];
  if (existing && named.length > 0) {
    const last = named[named.length - 1];
    const multiline = last.loc.start.line !== existing.loc.start.line;
    const tail = src.code.slice(last.end, existing.source.start);
    const comma = tail.indexOf(',');
    const close = tail.indexOf('}');
    const hasTrailing = comma !== -1 && comma < close;
    if (multiline) {
      const ind = indentAt(src.code, last.start);
      return hasTrailing ? [{ start: last.end + comma + 1, end: last.end + comma + 1, text: `\n${ind}${name},` }] : [{ start: last.end, end: last.end, text: `,\n${ind}${name}` }];
    }
    return [{ start: last.end, end: last.end, text: `, ${name}` }];
  }

  const line = `import { ${name} } from ${quoteJs(from, src.quote)};`;
  const anchor = imports[imports.length - 1];
  if (anchor) return [{ start: anchor.end, end: anchor.end, text: `\n${line}` }];
  return [{ start: program.start, end: program.start, text: `${line}\n` }];
}
