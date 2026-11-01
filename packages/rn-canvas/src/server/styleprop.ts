/**
 * Composant du projet qui n'accepte pas de prop `style` : un style posé sur une de ses instances
 * serait sans effet (et refusé par TypeScript). L'éditeur le signale, et peut ajouter la prop au
 * composant : type, paramètre, et style de l'élément racine, fusionné avec le sien.
 */
import { type AstNode, type Patch, type SourceFile, jsxName, programOf } from './ast.ts';
import { SourceError } from './inspect.ts';
import { ensureImport } from './structure.ts';

/** Déclaration des props (`interface XProps`, `type XProps = { … }`), si elle est simple. */
function propsDeclaration(program: AstNode, typeName: string): AstNode | null {
  for (const stmt of program.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;
    if (decl.type === 'TSInterfaceDeclaration' && decl.id.name === typeName) return decl;
    if (decl.type === 'TSTypeAliasDeclaration' && decl.id.name === typeName) return decl;
  }
  return null;
}

const membersOf = (decl: AstNode): AstNode[] | null =>
  decl.type === 'TSInterfaceDeclaration' ? decl.body.body : decl.typeAnnotation.type === 'TSTypeLiteral' ? decl.typeAnnotation.members : null;

/**
 * `true` : les props déclarent `style` ; `false` : props simples, sans `style` ; `null` : on ne sait
 * pas (props héritées d'un autre type, intersection, pas de type `XProps`), donc pas d'alerte.
 */
export function acceptsStyle(program: AstNode, typeName: string): boolean | null {
  const decl = propsDeclaration(program, typeName);
  if (!decl || (decl.type === 'TSInterfaceDeclaration' && decl.extends?.length)) return null;
  const members = membersOf(decl);
  if (!members) return null;
  return members.some((m) => m.type === 'TSPropertySignature' && m.key.type === 'Identifier' && m.key.name === 'style');
}

/** Fonction du composant : `const X = (…) => …`, `const X: React.FC = …`, `function X(…)`. */
function componentFunction(program: AstNode, name: string): AstNode | null {
  for (const stmt of program.body) {
    const decl = (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') && stmt.declaration ? stmt.declaration : stmt;
    if (decl.type === 'FunctionDeclaration' && decl.id?.name === name) return decl;
    if (decl.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      if (d.id.type === 'Identifier' && d.id.name === name && (d.init?.type === 'ArrowFunctionExpression' || d.init?.type === 'FunctionExpression')) return d.init;
    }
  }
  return null;
}

/** Élément JSX renvoyé par la fonction (corps en expression, ou `return` au premier niveau du bloc). */
function rootElement(fn: AstNode): AstNode | null {
  const unwrap = (n: AstNode | null | undefined): AstNode | null => (n?.type === 'ParenthesizedExpression' ? unwrap(n.expression) : (n ?? null));
  if (fn.body.type !== 'BlockStatement') return unwrap(fn.body);
  const ret = [...fn.body.body].reverse().find((s: AstNode) => s.type === 'ReturnStatement');
  return unwrap(ret?.argument);
}

const STYLE_TYPES: Record<string, string> = { Text: 'TextStyle', Image: 'ImageStyle', ImageBackground: 'ImageStyle' };

export function addStyleProp(src: SourceFile, name: string): Patch[] {
  const program = programOf(src.ast);
  const code = src.code;
  const fail = (why: string): never => {
    throw new SourceError(`Impossible d'ajouter la prop style à ${name} automatiquement (${why}) : ajoutez-la dans son fichier.`);
  };
  const decl = propsDeclaration(program, `${name}Props`) ?? fail(`type ${name}Props introuvable`);
  const members = membersOf(decl) ?? fail(`type ${name}Props trop complexe`);
  if (acceptsStyle(program, `${name}Props`)) throw new SourceError(`${name} accepte déjà une prop style.`);
  const fn = componentFunction(program, name) ?? fail('fonction du composant introuvable');
  const root = rootElement(fn);
  if (root?.type !== 'JSXElement') return fail("l'élément renvoyé n'est pas un élément JSX simple");
  const param = fn.params[0];
  if (param && param.type !== 'ObjectPattern' && param.type !== 'Identifier') fail('paramètres non reconnus');
  if (param?.type === 'ObjectPattern' && param.properties.some((p: AstNode) => p.type === 'RestElement')) fail('les props restantes sont déjà transmises');

  const patches: Patch[] = [];
  const styleType = STYLE_TYPES[jsxName(root.openingElement.name) ?? ''] ?? 'ViewStyle';

  // 1. Le type : `style?: StyleProp<ViewStyle>;` après le dernier membre, à la même indentation.
  const last = members[members.length - 1];
  if (last) {
    const before = code.slice(code.lastIndexOf('\n', last.start) + 1, last.start);
    // Le séparateur du dernier membre (`;` ou `,`), repris pour le nouveau ; ajouté s'il manque.
    const ending = code[last.end - 1];
    const sep = ending === ',' ? ',' : ';';
    const closed = ending === ';' || ending === ',' ? '' : sep;
    // Un membre par ligne : même indentation ; type sur une ligne (`{ label: string }`) : à la suite.
    const text = /^\s*$/.test(before) ? `${closed}\n${before}style?: StyleProp<${styleType}>${sep}` : `${closed} style?: StyleProp<${styleType}>${closed ? '' : sep}`;
    patches.push({ start: last.end, end: last.end, text });
  } else {
    const body = decl.type === 'TSInterfaceDeclaration' ? decl.body : decl.typeAnnotation;
    patches.push({ start: body.end - 1, end: body.end - 1, text: ` style?: StyleProp<${styleType}> ` });
  }

  // 2. Le paramètre : `{ label, onPress }` → `{ label, onPress, style }` ; `props` → `props.style`.
  let styleExpr = 'style';
  if (!param) return fail('le composant ne reçoit pas de props');
  if (param.type === 'ObjectPattern') {
    const lastProp = param.properties[param.properties.length - 1];
    if (lastProp) patches.push({ start: lastProp.end, end: lastProp.end, text: ', style' });
    else patches.push({ start: param.start + 1, end: param.start + 1, text: ' style ' });
  } else {
    styleExpr = `${param.name}.style`;
  }

  // 3. L'élément racine : son style d'abord, puis celui reçu (qui l'emporte).
  const attr = root.openingElement.attributes.find((a: AstNode) => a.type === 'JSXAttribute' && a.name.name === 'style');
  if (!attr) {
    const at = root.openingElement.name.end;
    patches.push({ start: at, end: at, text: ` style={${styleExpr}}` });
  } else if (attr.value?.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression;
    if (expr.type === 'ArrayExpression') {
      const at = expr.end - 1;
      patches.push({ start: at, end: at, text: `${expr.elements.length ? ', ' : ''}${styleExpr}` });
    } else {
      patches.push({ start: expr.start, end: expr.end, text: `[${code.slice(expr.start, expr.end)}, ${styleExpr}]` });
    }
  } else {
    fail("style de l'élément racine non reconnu");
  }

  // 4. Les types de React Native.
  return [...patches, ...ensureImport(src, 'StyleProp', 'react-native'), ...ensureImport(src, styleType, 'react-native')];
}
