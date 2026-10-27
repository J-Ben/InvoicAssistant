/**
 * Données d'exemple tirées des types TypeScript des props (`invoice: Invoice`, `items: BudgetItem[]`…).
 *
 * On utilise le compilateur TypeScript du projet (pas celui de rn-canvas) : les types sont ceux
 * que voit l'éditeur de code, alias du tsconfig compris. Les valeurs suivent le nom de chaque champ
 * (`amount` → un montant, `date` → une date récente, `visible` → true…) : plausibles, pas cohérentes
 * entre elles. Le fichier généré se retouche, ou sert de point de départ à des exemples écrits à la main.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as TS from 'typescript';

export interface GeneratedExamples {
  code: string;
  /** Composants qui ont reçu un exemple. */
  components: string[];
}

/** Valeur à écrire : code brut, objet, tableau ou instance de classe (`new Invoice({…})`). */
type Value =
  | { kind: 'raw'; code: string }
  | { kind: 'object'; entries: [string, Value][] }
  | { kind: 'array'; items: Value[] }
  | { kind: 'new'; name: string; args: Value[] };

const MAX_DEPTH = 4;
const VISIBLE = /^(visible|open|isOpen|isVisible|show|opened|presented)$/;

/**
 * Exemples des composants de `components` (fichier → noms exportés), ou null si le projet n'a pas
 * TypeScript. `specifier(file)` donne le chemin d'import d'un fichier depuis le fichier généré.
 */
export function generateExamples(root: string, components: { file: string; name: string }[], specifier: (file: string) => string): GeneratedExamples | null {
  let ts: typeof TS;
  try {
    ts = createRequire(path.join(root, 'package.json'))('typescript');
  } catch {
    return null;
  }
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  const parsed = configPath ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath)) : null;
  const files = [...new Set(components.map((c) => path.join(root, c.file)))];
  const program = ts.createProgram(files, { ...(parsed?.options ?? {}), noEmit: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const today = new Date();
  const isoDay = (offset: number) => new Date(today.getFullYear(), today.getMonth(), Math.max(1, today.getDate() - offset)).toISOString().slice(0, 10);

  const imports = new Map<string, Set<string>>();
  const entries: [string, Value][] = [];

  for (const { file, name } of components) {
    const source = program.getSourceFile(path.join(root, file));
    if (!source) continue;
    const fn = componentFunction(ts, source, name);
    const param = fn?.parameters[0];
    if (!param) continue;
    const propsType = checker.getTypeAtLocation(param);
    const props: [string, Value][] = [];
    for (const prop of checker.getPropertiesOfType(propsType)) {
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const type = checker.getTypeOfSymbolAtLocation(prop, param);
      if (optional && !(VISIBLE.test(prop.name) && isBoolean(ts, type))) continue;
      if (prop.name === 'children' || prop.name === 'style' || prop.name.endsWith('Style')) continue;
      const value = valueOf(type, prop.name, 0, 0, new Set());
      if (value) props.push([prop.name, value]);
    }
    if (props.length) entries.push([name, { kind: 'object', entries: [['props', { kind: 'object', entries: props }]] }]);
  }

  function valueOf(type: TS.Type, name: string, depth: number, n: number, seen: Set<TS.Type>, parent = ''): Value | null {
    const text = checker.typeToString(type);
    if (/ReactNode|ReactElement|JSX\.Element|StyleProp|Style$/.test(text)) return null;
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return null;

    if (type.isUnion()) {
      const options = type.types.filter((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
      if (options.length === 0) return { kind: 'raw', code: 'null' };
      if (options.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)) return { kind: 'raw', code: String(booleanFor(name)) };
      const literals = options.filter((t) => t.isStringLiteral()) as TS.StringLiteralType[];
      if (literals.length === options.length) return { kind: 'raw', code: quote(pickLiteral(literals.map((l) => l.value), name, n)) };
      const numbers = options.filter((t) => t.isNumberLiteral()) as TS.NumberLiteralType[];
      if (numbers.length === options.length) return { kind: 'raw', code: String(numbers[n % numbers.length].value) };
      return valueOf(options[0], name, depth, n, seen);
    }
    if (type.isStringLiteral()) return { kind: 'raw', code: quote(type.value) };
    if (type.isNumberLiteral()) return { kind: 'raw', code: String(type.value) };
    if (type.flags & ts.TypeFlags.BooleanLiteral) return { kind: 'raw', code: text };
    if (type.flags & ts.TypeFlags.StringLike) return { kind: 'raw', code: quote(stringFor(name, n, isoDay, parent)) };
    if (type.flags & ts.TypeFlags.NumberLike) return { kind: 'raw', code: String(numberFor(name, n, today)) };
    if (type.flags & ts.TypeFlags.BooleanLike) return { kind: 'raw', code: String(booleanFor(name)) };
    if (type.getCallSignatures().length > 0 && checker.getPropertiesOfType(type).length === 0) return { kind: 'raw', code: 'noop' };
    if (text === 'Date') return { kind: 'raw', code: `new Date(${quote(isoDay(n * 3))})` };
    if (depth >= MAX_DEPTH || seen.has(type)) return null;

    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      const element = checker.getTypeArguments(type as TS.TypeReference)[0];
      // Pas d'images d'exemple (adresses vides) : une liste vide s'affiche mieux.
      if (!element || /url|uri|image|photo|avatar/i.test(name)) return { kind: 'array', items: [] };
      const next = new Set(seen).add(type);
      const items = [0, 1].map((i) => valueOf(element, singular(name), depth + 1, n + i, next, parent)).filter((v): v is Value => v !== null);
      return { kind: 'array', items };
    }

    // Classe du projet : on l'instancie avec des valeurs pour son constructeur.
    const symbol = type.getSymbol();
    const declaration = symbol?.declarations?.find((d) => ts.isClassDeclaration(d)) as TS.ClassDeclaration | undefined;
    if (declaration && !declaration.getSourceFile().fileName.includes('node_modules') && declaration.name) {
      const ctor = declaration.members.find((m) => ts.isConstructorDeclaration(m)) as TS.ConstructorDeclaration | undefined;
      const exported = declaration.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) return null;
      const className = declaration.name.text;
      const file = path.relative(root, declaration.getSourceFile().fileName).split(path.sep).join('/');
      imports.set(file, (imports.get(file) ?? new Set()).add(className));
      const next = new Set(seen).add(type);
      const args = (ctor?.parameters ?? []).map((p) => valueOf(checker.getTypeAtLocation(p), p.name.getText(), depth + 1, n, next, name) ?? { kind: 'raw' as const, code: 'undefined' });
      return { kind: 'new', name: className, args };
    }

    if (type.flags & ts.TypeFlags.Object) {
      const next = new Set(seen).add(type);
      const entries: [string, Value][] = [];
      for (const prop of checker.getPropertiesOfType(type)) {
        if (prop.flags & ts.SymbolFlags.Optional || prop.flags & ts.SymbolFlags.Method) continue;
        const declarationNode = prop.valueDeclaration ?? prop.declarations?.[0];
        if (!declarationNode) continue;
        const value = valueOf(checker.getTypeOfSymbolAtLocation(prop, declarationNode), prop.name, depth + 1, n, next, name);
        if (value) entries.push([prop.name, value]);
      }
      return { kind: 'object', entries };
    }
    return null;
  }

  const importLines = [...imports]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, names]) => `import { ${[...names].sort().join(', ')} } from ${JSON.stringify(specifier(file)).replace(/^"|"$/g, "'")};`);
  const code = `/* eslint-disable */
// Généré par « npx rn-canvas examples » à partir des types TypeScript des props : valeurs plausibles,
// pas forcément cohérentes entre elles. Relancer la commande réécrit ce fichier : pour garder un
// exemple retouché, copiez-le dans \`examples\` de rn-canvas.config.tsx (prioritaire sur celui-ci).
${importLines.join('\n')}${importLines.length ? '\n' : ''}
const noop = () => {};

export const generatedExamples = ${print({ kind: 'object', entries }, 0)};
`;
  return { code, components: entries.map(([n]) => n) };
}

/** Fonction du composant `name` (déclaration, flèche, ou argument de memo/forwardRef). */
function componentFunction(ts: typeof TS, source: TS.SourceFile, name: string): TS.SignatureDeclaration | null {
  let found: TS.SignatureDeclaration | null = null;
  const fromExpression = (node: TS.Expression): TS.SignatureDeclaration | null => {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
    if (ts.isCallExpression(node) && node.arguments[0]) return fromExpression(node.arguments[0]);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return fromExpression(node.expression);
    return null;
  };
  source.forEachChild((node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) found = fromExpression(d.initializer);
      }
    }
  });
  return found;
}

function isBoolean(ts: typeof TS, type: TS.Type): boolean {
  if (type.flags & ts.TypeFlags.BooleanLike) return true;
  return type.isUnion() && type.types.every((t) => t.flags & (ts.TypeFlags.BooleanLiteral | ts.TypeFlags.Undefined | ts.TypeFlags.Null));
}

function singular(name: string): string {
  return name.replace(/ies$/, 'y').replace(/s$/, '');
}

const PEOPLE = /member|user|owner|author|person|profile|contact|createdBy|actor/i;

const SAMPLES: [RegExp, string[]][] = [
  [/vendor|merchant|store|shop/i, ['Carrefour', 'EDF', 'Pharmacie du Centre']],
  [/^(first)?name$|member|user|owner|author|createdBy/i, ['Camille', 'Alex', 'Sam']],
  [/title/i, ['Courses de la semaine', 'Électricité', 'Plein d’essence']],
  [/label/i, ['Loyer', 'Courses', 'Box internet']],
  [/description|notes?$|message|subtitle|text|comment|hint/i, ['Texte d’exemple', 'Autre texte d’exemple', 'Encore un texte']],
  [/category|type|kind/i, ['Divers', 'Maison', 'Loisirs']],
  [/city|place|location|address/i, ['Lyon', 'Nantes', 'Lille']],
];

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

/** `parent` : champ ou prop qui contient la valeur (`project` pour `project.name`). */
function stringFor(name: string, n: number, isoDay: (offset: number) => string, parent = ''): string {
  if (/^name$/i.test(name) && parent && !PEOPLE.test(parent)) return ['Vacances en Grèce', 'Rénovation de la cuisine', 'Fonds de secours'][n % 3];
  if (/(^id|Id)$/.test(name)) return `ex-${n + 1}`;
  if (/e?mail/i.test(name)) return `prenom${n + 1}@example.com`;
  if (/currency/i.test(name)) return 'EUR';
  if (/month/i.test(name)) return isoDay(0).slice(0, 7);
  if (/date|At$|day/i.test(name)) return isoDay(n * 3);
  if (/colou?r|Bg$|background|accent|tint/i.test(name)) return ['#7C5CFF', '#12B76A', '#F79009'][n % 3];
  if (/url|uri|image|photo|avatar|icon/i.test(name)) return '';
  if (/code/i.test(name)) return 'ABC123';
  for (const [pattern, values] of SAMPLES) if (pattern.test(name)) return values[n % values.length];
  return n ? `Exemple ${n + 1}` : 'Exemple';
}

function numberFor(name: string, n: number, today: Date): number {
  if (/progress|ratio/i.test(name)) return [0.6, 0.35, 0.9][n % 3];
  if (/percent|rate/i.test(name)) return [60, 35, 90][n % 3];
  if (/count|quantity|qty|length|^nb|number/i.test(name)) return [3, 5, 1][n % 3];
  if (/year/i.test(name)) return today.getFullYear();
  if (/month/i.test(name)) return today.getMonth() + 1;
  if (/day/i.test(name)) return [5, 12, 28][n % 3];
  if (/size|radius/i.test(name)) return 28;
  if (/width/i.test(name)) return 220;
  if (/height/i.test(name)) return 48;
  if (/index|position|order/i.test(name)) return n;
  if (/amount|total|price|cost|sum|balance|value|budget|prevu|reel|actual|delta|max|min|spent|target/i.test(name)) return [42.5, 18.9, 120][n % 3];
  return n + 1;
}

function booleanFor(name: string): boolean {
  return VISIBLE.test(name);
}

/** Pour une union de chaînes : une valeur parlante si le nom s'y prête (icônes), sinon dans l'ordre. */
function pickLiteral(values: string[], name: string, n: number): string {
  if (values.length > 50 && /icon/i.test(name)) return ['home-outline', 'star-outline', 'heart-outline', 'home', 'star'].find((v) => values.includes(v)) ?? values[0];
  return values[n % values.length];
}

function print(value: Value, depth: number): string {
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
  switch (value.kind) {
    case 'raw':
      return value.code;
    case 'array': {
      const items = value.items.map((v) => print(v, depth + 1));
      const inline = `[${items.join(', ')}]`;
      return inline.length <= 80 && !inline.includes('\n') ? inline : `[\n${items.map((i) => `${pad}${i},`).join('\n')}\n${end}]`;
    }
    case 'new': {
      const args = value.args.map((v) => print(v, depth));
      return `new ${value.name}(${args.join(', ')})`;
    }
    case 'object': {
      if (value.entries.length === 0) return '{}';
      const parts = value.entries.map(([k, v]) => `${key(k)}: ${print(v, depth + 1)}`);
      const inline = `{ ${parts.join(', ')} }`;
      return inline.length <= 80 && !inline.includes('\n') ? inline : `{\n${parts.map((p) => `${pad}${p},`).join('\n')}\n${end}}`;
    }
  }
}

export function examplesFile(include: string[]): string {
  return include.includes('canvas') ? 'canvas/examples.generated.ts' : 'rn-canvas.examples.ts';
}

export function writeIfChanged(file: string, code: string): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === code) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, code);
  return true;
}
