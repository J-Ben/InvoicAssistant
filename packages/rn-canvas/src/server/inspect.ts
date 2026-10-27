/**
 * Analyse statique d'un élément JSX : texte, props et styles, avec l'origine de chaque valeur.
 */
import * as babelParser from '@babel/parser';
import type { GradientDirection, GradientInfo, InspectResult, SourceValue, StyleSource, ValueOrigin } from '../shared/protocol.ts';
import { type AstNode, type SourceFile, codeOf, findProperty, jsxElements, jsxName, memberPath, moduleDeclarators, propertyKey, scopeAt, unwrap, walk, type Binding, bindingsAt, freeNames } from './ast.ts';

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

  const result: InspectResult = {
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
    scope: scopeAt(src.ast, element),
    source: codeOf(src, element),
    gradient: gradientOf(src, file, element),
  };
  annotateOrigins(result, bindingsAt(src.ast, element, src.code));
  return result;
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

/** Ajoute à chaque expression (styles, props) l'origine des noms qu'elle utilise. */
function annotateOrigins(result: InspectResult, bindings: Map<string, Binding>): void {
  const explain = (code: string): ValueOrigin[] | undefined => {
    let expression: AstNode;
    try {
      expression = babelParser.parseExpression(code, { plugins: ['typescript', 'jsx'] }) as unknown as AstNode;
    } catch {
      return undefined;
    }
    const origins = freeNames(expression).map((name): ValueOrigin => {
      const b = bindings.get(name);
      return b ? { name, ...b } : { name, kind: 'unknown', detail: 'origine inconnue (global ?)', line: null };
    });
    return origins.length ? origins : undefined;
  };
  const annotate = (value: SourceValue | null) => {
    if (value?.kind === 'expression' && !value.code.startsWith('...')) value.origins = explain(value.code);
  };
  for (const source of result.style.sources) {
    if (source.kind === 'unknown') source.origins = explain(source.ref);
    for (const p of source.properties) annotate(p.value);
  }
  for (const p of result.props) annotate(p.value);
}

// ---- Dégradés (expo-linear-gradient, react-native-linear-gradient) ----

const GRADIENT = /(^|\.)LinearGradient$/;

function jsxAttr(element: AstNode, prop: string): AstNode | undefined {
  return element.openingElement.attributes.find((a: AstNode) => a.type === 'JSXAttribute' && a.name?.name === prop);
}

function isGradient(element: AstNode): boolean {
  return GRADIENT.test(jsxName(element.openingElement.name) ?? '') && Boolean(jsxAttr(element, 'colors'));
}

/** `{ x: 0, y: 1 }` → [0, 1] ; null si ce n'est pas un objet littéral numérique. */
function point(src: SourceFile, element: AstNode, prop: string): [number, number] | null | undefined {
  const attr = jsxAttr(element, prop);
  if (!attr) return undefined;
  const expr = attr.value?.type === 'JSXExpressionContainer' ? unwrap(attr.value.expression) : null;
  if (expr?.type !== 'ObjectExpression') return null;
  const value = (key: string) => {
    const p = expr.properties.find((q: AstNode) => q.type === 'ObjectProperty' && (q.key.name ?? q.key.value) === key);
    const v = p ? sourceValue(src, p.value) : null;
    return v?.kind === 'number' ? Number(v.value) : null;
  };
  const x = value('x');
  const y = value('y');
  return x === null || y === null ? null : [x, y];
}

function directionOf(src: SourceFile, element: AstNode): GradientDirection {
  const start = point(src, element, 'start');
  const end = point(src, element, 'end');
  // Par défaut : de haut en bas.
  if (start === undefined && end === undefined) return 'vertical';
  const key = `${(start ?? [0.5, 0]).join(',')}>${(end ?? [0.5, 1]).join(',')}`;
  const known: Record<string, GradientDirection> = {
    '0,0>0,1': 'vertical',
    '0.5,0>0.5,1': 'vertical',
    '0,0>1,0': 'horizontal',
    '0,0.5>1,0.5': 'horizontal',
    '0,0>1,1': 'diagonal',
    '0,1>1,0': 'diagonal-up',
  };
  return known[key] ?? 'custom';
}

/** Calque qui recouvre son parent (`StyleSheet.absoluteFill`, `position: 'absolute'`) : un fond. */
function fillsParent(src: SourceFile, element: AstNode): boolean {
  const style = jsxAttr(element, 'style');
  return Boolean(style?.value) && /absoluteFill|position:\s*['"]absolute['"]/.test(codeOf(src, style!.value));
}

/** `<X />`, `{cond && <X />}` ou `{cond ? <X /> : …}` → l'élément X. */
function conditionalElement(child: AstNode): AstNode | null {
  if (child.type === 'JSXElement') return child;
  if (child.type !== 'JSXExpressionContainer') return null;
  const expr = unwrap(child.expression);
  if (expr.type === 'LogicalExpression' && unwrap(expr.right).type === 'JSXElement') return unwrap(expr.right);
  if (expr.type === 'ConditionalExpression' && unwrap(expr.consequent).type === 'JSXElement') return unwrap(expr.consequent);
  return null;
}

/** Dégradé de l'élément, ou de son calque de fond (enfant direct `LinearGradient`). */
export function gradientOf(src: SourceFile, file: string, element: AstNode): GradientInfo | null {
  const own = isGradient(element);
  const target = own ? element : meaningfulChildren(element).map(conditionalElement).find((c) => c !== null && isGradient(c) && fillsParent(src, c));
  if (!target) return null;
  const colors = jsxAttr(target, 'colors')!;
  const expr = colors.value?.type === 'JSXExpressionContainer' ? unwrap(colors.value.expression) : null;
  const stops = expr?.type === 'ArrayExpression' && expr.elements.every((e: AstNode | null) => e && e.type !== 'SpreadElement') ? expr.elements.map((e: AstNode) => sourceValue(src, e)) : null;
  return {
    loc: `${file}:${target.loc.start.line}:${target.loc.start.column}`,
    name: jsxName(target.openingElement.name) ?? 'LinearGradient',
    own,
    stops,
    colorsCode: colors.value ? codeOf(src, colors.value.type === 'JSXExpressionContainer' ? colors.value.expression : colors.value) : '',
    direction: directionOf(src, target),
  };
}
