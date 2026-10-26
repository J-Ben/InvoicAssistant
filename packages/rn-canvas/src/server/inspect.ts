/**
 * Analyse statique d'un élément JSX : texte, props et styles, avec l'origine de chaque valeur.
 */
import type { InspectResult, SourceValue, StyleSource } from '../shared/protocol.ts';
import { type AstNode, type SourceFile, codeOf, findProperty, jsxElements, jsxName, memberPath, moduleDeclarators, moduleScope, propertyKey, unwrap, walk } from './ast.ts';

export class SourceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ElementMatch {
  element: AstNode;
  index: number;
}

/** Retrouve l'élément à `ligne:colonne` et vérifie son nom pour détecter un emplacement périmé. */
export function findElement(ast: AstNode, line: number, column: number, expectedName?: string): ElementMatch {
  const elements = jsxElements(ast);
  const index = elements.findIndex((el) => el.loc.start.line === line && el.loc.start.column === column);
  if (index === -1) {
    throw new SourceError(`Aucun élément JSX à ${line}:${column} : le fichier a changé, rechargez l'écran.`, 409);
  }
  const element = elements[index];
  const name = jsxName(element.openingElement.name);
  if (expectedName && name !== expectedName) {
    throw new SourceError(`L'élément à ${line}:${column} est <${name}>, pas <${expectedName}> : le fichier a changé.`, 409);
  }
  return { element, index };
}

export function locOfIndex(ast: AstNode, file: string, index: number): string | null {
  const el = jsxElements(ast)[index];
  return el ? `${file}:${el.loc.start.line}:${el.loc.start.column}` : null;
}

export function sourceValue(src: SourceFile, node: AstNode): SourceValue {
  const n = unwrap(node);
  const code = codeOf(src, node);
  switch (n.type) {
    case 'StringLiteral':
      return { kind: 'string', value: n.value, code };
    case 'NumericLiteral':
      return { kind: 'number', value: n.value, code };
    case 'BooleanLiteral':
      return { kind: 'boolean', value: n.value, code };
    case 'NullLiteral':
      return { kind: 'null', value: null, code };
    case 'UnaryExpression':
      if (n.operator === '-' && n.argument.type === 'NumericLiteral') return { kind: 'number', value: -n.argument.value, code };
      break;
    case 'TemplateLiteral':
      if (n.expressions.length === 0) return { kind: 'string', value: n.quasis[0].value.cooked, code };
      break;
  }
  return { kind: 'expression', code };
}

/** `const styles = StyleSheet.create({...})` au niveau du module → { styles: ObjectExpression }. */
export function stylesheets(ast: AstNode): Map<string, AstNode> {
  const sheets = new Map<string, AstNode>();
  for (const d of moduleDeclarators(ast)) {
    if (d.id.type !== 'Identifier' || !d.init) continue;
    const init = unwrap(d.init);
    if (init.type === 'CallExpression' && memberPath(init.callee) === 'StyleSheet.create' && init.arguments[0]?.type === 'ObjectExpression') {
      sheets.set(d.id.name, init.arguments[0]);
    }
  }
  return sheets;
}

/** L'objet d'une entrée `styles.card`, s'il existe. */
export function stylesheetEntry(ast: AstNode, ref: string): AstNode | undefined {
  const [sheetName, key, ...rest] = ref.split('.');
  const sheet = stylesheets(ast).get(sheetName);
  const prop = sheet && key && rest.length === 0 ? findProperty(sheet, key) : undefined;
  const value = prop ? unwrap(prop.value) : undefined;
  return value?.type === 'ObjectExpression' ? value : undefined;
}

export function countUsages(ast: AstNode, ref: string): number {
  let count = 0;
  walk(ast, (node) => {
    if (node.type === 'MemberExpression' && memberPath(node) === ref) count++;
  });
  return count;
}

export function styleAttribute(element: AstNode): AstNode | undefined {
  return element.openingElement.attributes.find((a: AstNode) => a.type === 'JSXAttribute' && a.name.name === 'style');
}

/** Résout l'expression d'un `style={…}` en une liste ordonnée de sources (la dernière l'emporte). */
export function resolveStyle(src: SourceFile, expr: AstNode, conditional = false): StyleSource[] {
  const node = unwrap(expr);
  switch (node.type) {
    case 'ObjectExpression':
      return [{ kind: 'inline', ref: 'inline', usages: 1, conditional, properties: objectProperties(src, node) }];
    case 'ArrayExpression':
      return node.elements.filter(Boolean).flatMap((el: AstNode) => resolveStyle(src, el, conditional));
    case 'LogicalExpression':
      if (node.operator === '&&') return resolveStyle(src, node.right, true);
      return [...resolveStyle(src, node.left, true), ...resolveStyle(src, node.right, true)];
    case 'ConditionalExpression':
      return [...resolveStyle(src, node.consequent, true), ...resolveStyle(src, node.alternate, true)];
    case 'NullLiteral':
    case 'BooleanLiteral':
      return [];
    case 'Identifier':
      if (node.name === 'undefined') return [];
      break;
    case 'MemberExpression': {
      const ref = memberPath(node);
      const entry = ref ? stylesheetEntry(src.ast, ref) : undefined;
      if (ref && entry) {
        return [{ kind: 'stylesheet', ref, usages: countUsages(src.ast, ref), conditional, properties: objectProperties(src, entry) }];
      }
      break;
    }
  }
  return [{ kind: 'unknown', ref: codeOf(src, node), usages: 1, conditional, properties: [] }];
}

function objectProperties(src: SourceFile, object: AstNode): StyleSource['properties'] {
  const out: StyleSource['properties'] = [];
  for (const prop of object.properties) {
    if (prop.type === 'SpreadElement') {
      out.push({ key: `...${codeOf(src, prop.argument)}`, value: { kind: 'expression', code: codeOf(src, prop) } });
      continue;
    }
    const key = propertyKey(prop);
    if (key !== null) out.push({ key, value: sourceValue(src, prop.value) });
  }
  return out;
}

/** Enfants significatifs (on ignore le texte qui n'est que de l'indentation). */
export function meaningfulChildren(element: AstNode): AstNode[] {
  return element.children.filter((c: AstNode) => !(c.type === 'JSXText' && c.value.trim() === ''));
}

export function inspectElement(src: SourceFile, file: string, element: AstNode): InspectResult {
  const opening = element.openingElement;
  const name = jsxName(opening.name) ?? '?';
  const { line, column } = element.loc.start;

  const props: InspectResult['props'] = [];
  for (const attr of opening.attributes) {
    if (attr.type === 'JSXSpreadAttribute') {
      props.push({ name: `...${codeOf(src, attr.argument)}`, value: { kind: 'expression', code: codeOf(src, attr) } });
      continue;
    }
    const propName = typeof attr.name.name === 'string' ? attr.name.name : null;
    if (!propName || propName === 'style' || propName === '__rnc') continue;
    props.push({ name: propName, value: attrValue(src, attr) });
  }

  const styleAttr = styleAttribute(element);
  const styleExpr = styleAttr?.value?.type === 'JSXExpressionContainer' ? styleAttr.value.expression : null;

  return {
    loc: `${file}:${line}:${column}`,
    file,
    name,
    text: inspectText(src, element, name),
    props,
    style: {
      sources: styleExpr ? resolveStyle(src, styleExpr) : [],
      editable: !styleAttr || Boolean(styleExpr),
      code: styleExpr ? codeOf(src, styleExpr) : null,
    },
    scope: moduleScope(src.ast),
  };
}

function attrValue(src: SourceFile, attr: AstNode): SourceValue | null {
  if (attr.value == null) return { kind: 'boolean', value: true, code: 'true' };
  if (attr.value.type === 'StringLiteral') return { kind: 'string', value: attr.value.value, code: codeOf(src, attr.value) };
  if (attr.value.type === 'JSXExpressionContainer') {
    if (attr.value.expression.type === 'JSXEmptyExpression') return null;
    return sourceValue(src, attr.value.expression);
  }
  return { kind: 'expression', code: codeOf(src, attr.value) };
}

function inspectText(src: SourceFile, element: AstNode, name: string): InspectResult['text'] {
  const children = meaningfulChildren(element);
  if (children.length === 0) {
    return /Text$/.test(name) ? { editable: true, value: '', code: null } : null;
  }
  if (children.length === 1) {
    const child = children[0];
    if (child.type === 'JSXText') return { editable: true, value: normalizeJsxText(child.value), code: null };
    if (child.type === 'JSXExpressionContainer') {
      const v = sourceValue(src, child.expression);
      if (v.kind === 'string') return { editable: true, value: String(v.value), code: null };
      return { editable: false, value: null, code: v.code };
    }
  }
  if (children.some((c) => c.type === 'JSXElement' || c.type === 'JSXFragment')) return null;
  return { editable: false, value: null, code: children.map((c) => codeOf(src, c)).join('') };
}

/** Reproduit la normalisation des espaces de JSX (sauts de ligne + indentation fusionnés). */
export function normalizeJsxText(raw: string): string {
  return raw
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}
