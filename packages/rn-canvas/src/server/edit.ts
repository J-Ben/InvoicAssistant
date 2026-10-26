/**
 * Modifications chirurgicales du code. Chaque opération retourne des patchs texte
 * qui touchent le plus petit morceau de code possible, en respectant le style du fichier.
 */
import type { EditValue, StyleTarget } from '../shared/protocol.ts';
import { type AstNode, type Patch, type SourceFile, codeOf, findProperty, indentAt, jsxName, moduleDeclarators, moduleScope, quoteJs, unwrap } from './ast.ts';
import { SourceError, meaningfulChildren, styleAttribute, stylesheetEntry } from './inspect.ts';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const MEMBER_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

/** Code d'une valeur. Les expressions sont limitées aux jetons (`colors.primary`) déjà en portée. */
export function valueCode(src: SourceFile, value: EditValue): string {
  if (value.kind === 'remove') throw new SourceError('Valeur manquante.');
  if (value.kind === 'expression') {
    const code = value.code.trim();
    if (!MEMBER_PATH.test(code)) throw new SourceError(`Expression non autorisée : « ${code} ». Seuls les jetons (ex. colors.primary) sont acceptés.`);
    const root = code.split('.')[0];
    if (!moduleScope(src.ast).includes(root)) throw new SourceError(`« ${root} » n'est pas importé dans ce fichier.`);
    return code;
  }
  const v = value.value;
  if (typeof v === 'string') return quoteJs(v, src.quote);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  throw new SourceError('Valeur invalide.');
}

function keyCode(src: SourceFile, key: string): string {
  return IDENTIFIER.test(key) ? key : quoteJs(key, src.quote);
}

function insert(at: number, text: string): Patch {
  return { start: at, end: at, text };
}

/** Affecte (ou retire) `key` dans un objet littéral existant. */
function setObjectKey(src: SourceFile, object: AstNode, key: string, value: EditValue): Patch[] {
  const props: AstNode[] = object.properties;
  const existing = findProperty(object, key);

  if (value.kind === 'remove') {
    if (!existing) return [];
    const i = props.indexOf(existing);
    if (i < props.length - 1) return [{ start: existing.start, end: props[i + 1].start, text: '' }];
    if (i > 0) return [{ start: props[i - 1].end, end: existing.end, text: '' }];
    return [{ start: object.start, end: object.end, text: '{}' }];
  }

  const code = valueCode(src, value);
  if (existing) {
    const target = existing.shorthand ? existing : existing.value;
    const text = existing.shorthand ? `${keyCode(src, key)}: ${code}` : code;
    return [{ start: target.start, end: target.end, text }];
  }

  const entry = `${keyCode(src, key)}: ${code}`;
  if (props.length === 0) return [{ start: object.start, end: object.end, text: `{ ${entry} }` }];

  const last = props[props.length - 1];
  const tail = src.code.slice(last.end, object.end - 1);
  const comma = tail.indexOf(',');
  const multiline = last.loc.start.line !== object.loc.start.line;
  if (multiline) {
    const indent = indentAt(src.code, last.start);
    return comma === -1 ? [insert(last.end, `,\n${indent}${entry}`)] : [insert(last.end + comma + 1, `\n${indent}${entry},`)];
  }
  return comma === -1 ? [insert(last.end, `, ${entry}`)] : [insert(last.end + comma + 1, ` ${entry}`)];
}

/** Retire un attribut JSX avec l'espace qui le précède. */
function removeAttribute(src: SourceFile, opening: AstNode, attr: AstNode): Patch {
  const attrs: AstNode[] = opening.attributes;
  const i = attrs.indexOf(attr);
  const prevEnd = i > 0 ? attrs[i - 1].end : opening.name.end;
  const between = src.code.slice(prevEnd, attr.start);
  return { start: /^\s*$/.test(between) ? prevEnd : attr.start, end: attr.end, text: '' };
}

/** Ajoute un attribut JSX à la suite des autres, sur une nouvelle ligne si l'élément est déjà multi-ligne. */
function addAttribute(src: SourceFile, opening: AstNode, text: string): Patch {
  const attrs: AstNode[] = opening.attributes;
  const last = attrs[attrs.length - 1];
  if (last && last.loc.start.line !== opening.name.loc.start.line) {
    return insert(last.end, `\n${indentAt(src.code, last.start)}${text}`);
  }
  return insert(last ? last.end : opening.name.end, ` ${text}`);
}

export function setStyle(src: SourceFile, element: AstNode, key: string, value: EditValue, target: StyleTarget): Patch[] {
  if (!key || !/^[A-Za-z][\w-]*$/.test(key)) throw new SourceError('Propriété de style invalide.');

  if (target.kind === 'stylesheet') {
    const entry = stylesheetEntry(src.ast, target.ref);
    if (!entry) throw new SourceError(`Style « ${target.ref} » introuvable dans ce fichier.`);
    return setObjectKey(src, entry, key, value);
  }

  const opening = element.openingElement;
  const attr = styleAttribute(element);
  const newObject = () => `{ ${keyCode(src, key)}: ${valueCode(src, value)} }`;

  if (!attr) return value.kind === 'remove' ? [] : [addAttribute(src, opening, `style={${newObject()}}`)];
  if (attr.value?.type !== 'JSXExpressionContainer') throw new SourceError("Le style de cet élément n'est pas modifiable.");

  const expr = unwrap(attr.value.expression);
  const removesLastKey = (object: AstNode) => value.kind === 'remove' && object.properties.length === 1 && findProperty(object, key) !== undefined;

  if (expr.type === 'ObjectExpression') {
    if (removesLastKey(expr)) return [removeAttribute(src, opening, attr)];
    return setObjectKey(src, expr, key, value);
  }

  if (expr.type === 'ArrayExpression') {
    const elements: AstNode[] = expr.elements.filter(Boolean);
    const last = elements[elements.length - 1];
    if (last && unwrap(last).type === 'ObjectExpression') {
      const object = unwrap(last);
      if (!removesLastKey(object)) return setObjectKey(src, object, key, value);
      if (elements.length === 2) return [{ start: expr.start, end: expr.end, text: codeOf(src, elements[0]) }];
      if (elements.length === 1) return [removeAttribute(src, opening, attr)];
      return [{ start: elements[elements.length - 2].end, end: last.end, text: '' }];
    }
    if (value.kind === 'remove') return [];
    return last ? [insert(last.end, `, ${newObject()}`)] : [{ start: expr.start, end: expr.end, text: `[${newObject()}]` }];
  }

  // Référence (styles.card, props.style…) : on surcharge sans toucher à l'original.
  if (value.kind === 'remove') return [];
  return [{ start: expr.start, end: expr.end, text: `[${codeOf(src, expr)}, ${newObject()}]` }];
}

export function setText(src: SourceFile, element: AstNode, text: string): Patch[] {
  const opening = element.openingElement;
  const children = meaningfulChildren(element);
  const needsContainer = /[{}<>]/.test(text) || /^\s|\s$/.test(text) || /[\r\n]/.test(text);
  const jsx = needsContainer ? `{${quoteJs(text, src.quote)}}` : text;

  if (children.length === 1 && children[0].type === 'JSXText') {
    // On ne remplace que le texte lui-même : l'indentation autour reste en place.
    const child = children[0];
    const raw: string = child.value;
    const leading = /^\s*/.exec(raw)![0].length;
    const trailing = /\s*$/.exec(raw)![0].length;
    return [{ start: child.start + leading, end: child.end - trailing, text: jsx }];
  }
  if (children.length === 1 && children[0].type === 'JSXExpressionContainer' && unwrap(children[0].expression).type === 'StringLiteral') {
    const literal = unwrap(children[0].expression);
    return [{ start: literal.start, end: literal.end, text: quoteJs(text, src.quote) }];
  }
  if (children.length > 0) throw new SourceError('Ce texte est dynamique : modifiez-le dans le code.');
  if (text === '') return [];

  if (opening.selfClosing) {
    // `<Text … />` → `<Text …>texte</Text>`
    const slash = src.code.lastIndexOf('/', opening.end - 1);
    let start = slash;
    while (start > 0 && /\s/.test(src.code[start - 1])) start--;
    return [{ start, end: opening.end, text: `>${jsx}</${jsxName(opening.name)}>` }];
  }
  return [{ start: opening.end, end: element.closingElement.start, text: jsx }];
}

export function setProp(src: SourceFile, element: AstNode, prop: string, value: EditValue): Patch[] {
  if (!IDENTIFIER.test(prop) || prop === 'style' || prop === '__rnc' || prop === 'children' || prop === 'key') {
    throw new SourceError(`La prop « ${prop} » ne peut pas être modifiée ici.`);
  }
  const opening = element.openingElement;
  const existing = opening.attributes.find((a: AstNode) => a.type === 'JSXAttribute' && a.name.name === prop);

  if (value.kind === 'remove') return existing ? [removeAttribute(src, opening, existing)] : [];

  const attrValue =
    value.kind === 'literal' && typeof value.value === 'string' && !/["\r\n\\]/.test(value.value) ? `"${value.value}"` : `{${valueCode(src, value)}}`;

  if (!existing) return [addAttribute(src, opening, `${prop}=${attrValue}`)];
  if (existing.value == null) return [insert(existing.end, `=${attrValue}`)];
  return [{ start: existing.value.start, end: existing.value.end, text: attrValue }];
}

/** `export const colors = { primary: '#…' }` → modifie `colors.primary`. */
export function setToken(src: SourceFile, tokenPath: string, value: EditValue): Patch[] {
  if (value.kind !== 'literal') throw new SourceError('Un jeton du thème doit avoir une valeur littérale.');
  const [exportName, ...keys] = tokenPath.split('.');
  let object = themeObject(src.ast, exportName);
  for (const key of keys.slice(0, -1)) {
    const prop = object ? findProperty(object, key) : undefined;
    object = prop ? unwrap(prop.value) : undefined;
    if (object?.type !== 'ObjectExpression') object = undefined;
  }
  const last = keys[keys.length - 1];
  if (!object || !last || !findProperty(object, last)) throw new SourceError(`Jeton « ${tokenPath} » introuvable.`);
  return setObjectKey(src, object, last, value);
}

export function themeObject(ast: AstNode, exportName: string): AstNode | undefined {
  for (const d of moduleDeclarators(ast)) {
    if (d.id.type === 'Identifier' && d.id.name === exportName && d.init) {
      const init = unwrap(d.init);
      if (init.type === 'ObjectExpression') return init;
    }
  }
  return undefined;
}
