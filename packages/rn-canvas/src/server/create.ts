/**
 * Création d'un composant ou d'un écran depuis l'éditeur : les vrais fichiers, aux conventions du
 * projet (conventions.ts), et le fichier canvas qui l'affiche. Vide (avec ses props), ou copie d'un
 * composant existant (fichiers renommés, imports relatifs recalculés).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Conventions, CreatePropKind, CreatePropSpec, CreateRequest } from '../shared/protocol.ts';
import { SourceError } from './inspect.ts';
import { resolveRelative } from './setup.ts';

export type PropKind = CreatePropKind;
export type PropSpec = CreatePropSpec;
export type { CreateRequest };

export interface CreatePlan {
  name: string;
  /** Fichier principal du composant (celui qu'affiche le canvas). */
  main: string;
  files: { path: string; content: string }[];
  story: { file: string; id: string };
  /** Spécificateur d'import du composant (alias ou relatif), pour l'aperçu. */
  importFrom: string;
}

/** `bouton principal`, `carte-facture récente`, `monBouton` → `BoutonPrincipal`, `CarteFactureRecente`, `MonBouton`. */
export function componentName(input: string): string {
  const words = input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (!name) throw new SourceError('Donnez un nom au composant.');
  if (/^\d/.test(name)) throw new SourceError(`« ${input} » : un nom de composant ne peut pas commencer par un chiffre.`);
  return name;
}

/** Nom de prop : `Libellé du bouton` → `libelleDuBouton`. */
export function propName(input: string): string {
  const pascal = componentName(input);
  return pascal[0].toLowerCase() + pascal.slice(1);
}

const RESERVED = new Set(['View', 'Text', 'Image', 'ScrollView', 'FlatList', 'TextInput', 'Pressable', 'Modal', 'Switch', 'React', 'Fragment', 'StyleSheet']);

export function planCreate(root: string, conventions: Conventions, canvasDir: string, request: CreateRequest): CreatePlan {
  const name = componentName(request.name);
  if (RESERVED.has(name)) throw new SourceError(`« ${name} » est déjà un composant de React Native : choisissez un autre nom.`);
  const { layout, code } = conventions;
  const q = code.quote;
  const brace = (inner: string) => (code.bracketSpacing ? `{ ${inner} }` : `{${inner}}`);
  const semi = code.semicolons ? ';' : '';

  // Dossier de destination.
  let base: string;
  let alias: string | null = null;
  if (request.kind === 'component') {
    const level = conventions.levels.find((l) => l.name === request.level);
    if (!level) throw new SourceError(conventions.componentsRoot ? `Niveau « ${request.level} » inconnu.` : 'Aucun dossier de composants (atoms, molecules…) trouvé : indiquez-le dans rn-canvas.json, create.componentsRoot.');
    if (request.group && !level.groups.includes(request.group)) throw new SourceError(`Sous-dossier « ${request.group} » inconnu dans ${level.dir}.`);
    base = request.group ? `${level.dir}/${request.group}` : level.dir;
    alias = level.alias && !request.group ? level.alias : null;
    // Même nom ailleurs dans les composants : ambigu à l'import et dans la bibliothèque.
    for (const l of conventions.levels) {
      for (const dir of [l.dir, ...l.groups.map((g) => `${l.dir}/${g}`)]) {
        if (fs.existsSync(path.join(root, dir, name)) || fs.existsSync(path.join(root, dir, `${name}.tsx`))) throw new SourceError(`Un composant « ${name} » existe déjà : ${dir}/${name}.`);
      }
    }
  } else {
    const dir = (request.dir ?? conventions.screenDirs[0] ?? 'src').replace(/^\/+|\/+$/g, '');
    if (dir.split('/').includes('..') || path.isAbsolute(dir)) throw new SourceError('Le dossier doit être dans le projet.');
    base = dir;
  }
  const folder = layout.folder ? `${base}/${name}` : base;
  const main = `${folder}/${name}.tsx`;
  if (fs.existsSync(path.join(root, main)) || (layout.folder && fs.existsSync(path.join(root, folder)))) throw new SourceError(`${layout.folder ? folder : main} existe déjà.`);

  // Les gabarits sont écrits avec deux espaces : ramenés à l'indentation du projet (4 espaces, tabulation…).
  const reindent = (content: string) => (code.indent === '  ' ? content : content.replace(/^((?: {2})+)/gm, (lead: string) => code.indent.repeat(lead.length / 2)));
  const files = request.from
    ? copyFiles(root, request.from, name, folder)
    : blankFiles(name, request, conventions, { q, brace, semi }).map((f) => ({ path: `${folder}/${f.path}`, content: reindent(f.content) }));
  const importFrom = alias ? `${alias}/${name}` : layout.folder && files.some((f) => /\/index\.(ts|tsx|js)$/.test(f.path)) ? folder : main.replace(/\.tsx$/, '');

  // Fichier canvas : le composant affiché seul (avec ses valeurs d'exemple), ou l'écran.
  const storyDir = request.kind === 'component' ? `${canvasDir}/components` : canvasDir;
  const storyFile = `${storyDir}/${name}.canvas.tsx`;
  if (fs.existsSync(path.join(root, storyFile))) throw new SourceError(`${storyFile} existe déjà.`);
  const exportName = request.kind === 'component' ? 'Exemple' : 'Actuel';
  // Import du composant dans le canvas : par l'alias du niveau s'il y en a un, sinon relatif (dossier
  // s'il a un index, sinon le fichier).
  const hasIndex = files.some((f) => /\/index\.(ts|tsx|js)$/.test(f.path));
  const target = layout.folder && hasIndex ? folder : main.replace(/\.tsx$/, '');
  let specifier = alias ?? path.posix.relative(storyDir, target);
  if (alias) specifier = `${alias}/${name}`;
  else if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  const isDefault = request.from ? fromIsDefault(root, request.from) : layout.exportDefault;
  const exampleProps = request.from ? [] : (request.props ?? []).filter((p) => !p.optional || p.default).map((p) => `${propName(p.name)}: ${valueCode(p, q)}`);
  files.push({
    path: storyFile,
    content: `import type ${brace('CanvasMeta, CanvasStory')} from ${q}rn-canvas/runtime${q}${semi}
import ${isDefault ? name : brace(name)} from ${q}${specifier}${q}${semi}

export default ${brace(`title: ${q}${name}${q}, component: ${name}${exampleProps.length ? `, props: ${brace(exampleProps.join(', '))}` : ''}`)} satisfies CanvasMeta${semi}

export const ${exportName}: CanvasStory = {}${semi}
`,
  });
  return { name, main, files, story: { file: storyFile, id: `${storyFile}#${exportName}` }, importFrom };
}

export function writePlan(root: string, plan: CreatePlan): void {
  for (const file of plan.files) {
    const abs = path.join(root, file.path);
    if (fs.existsSync(abs)) throw new SourceError(`${file.path} existe déjà : rien n'a été écrit.`);
  }
  for (const file of plan.files) {
    fs.mkdirSync(path.dirname(path.join(root, file.path)), { recursive: true });
    fs.writeFileSync(path.join(root, file.path), file.content);
  }
}

// ---- Composant vide ----

const TS_TYPES: Record<PropKind, string> = { string: 'string', number: 'number', boolean: 'boolean', color: 'string', function: '() => void', node: 'ReactNode' };

function valueCode(p: PropSpec, q: string): string {
  const v = p.default?.trim();
  switch (p.type) {
    case 'number':
      return v && !Number.isNaN(Number(v)) ? v : '0';
    case 'boolean':
      return v === 'true' ? 'true' : 'false';
    case 'function':
      return '() => {}';
    case 'node':
      return 'null';
    case 'color':
      return `${q}${v || '#1D1D22'}${q}`;
    default:
      return `${q}${(v ?? p.name).replace(new RegExp(q, 'g'), `\\${q}`)}${q}`;
  }
}

function blankFiles(name: string, request: CreateRequest, conventions: Conventions, fmt: { q: string; brace: (s: string) => string; semi: string }): { path: string; content: string }[] {
  const { q, brace, semi } = fmt;
  const { layout } = conventions;
  const screen = request.kind === 'screen';
  const props = screen ? [] : (request.props ?? []).map((p) => ({ ...p, name: propName(p.name) }));
  const seen = new Set<string>();
  for (const p of props) {
    if (seen.has(p.name)) throw new SourceError(`Prop « ${p.name} » en double.`);
    seen.add(p.name);
  }
  const skeleton = Boolean(request.skeleton && conventions.skeleton && !screen);
  const textProp = props.find((p) => p.type === 'string');
  const colorProp = props.find((p) => p.type === 'color');
  const pressProp = props.find((p) => p.type === 'function' && /^on[A-Z]/.test(p.name));
  const childrenProp = props.find((p) => p.type === 'node');
  const propsName = `${name}Props`;

  // Interface exportée si le projet le fait (ou si elle vit dans son propre fichier), sinon locale.
  const propsInterface = `${conventions.code.exportProps || layout.propsFile ? 'export ' : ''}interface ${propsName} {
${[...props.map((p) => `  ${p.name}${p.optional ? '?' : ''}: ${TS_TYPES[p.type]}${semi}`), `  testID?: string${semi}`].join('\n')}
}`;
  const usesNode = props.some((p) => p.type === 'node');

  // Bloc sur plusieurs lignes : pas d'espaces d'accolades autour (seulement pour les objets sur une ligne).
  const stylesBody = `StyleSheet.create({
  container: ${screen ? brace('flex: 1, padding: 16') : brace('padding: 12, borderRadius: 8')},${textProp || screen ? `
  text: ${brace('fontSize: 16')},` : ''}
})`;

  // Le corps : la forme (pressable si une prop onXxx existe), le texte, les enfants.
  const container = pressProp ? 'Pressable' : skeleton ? 'SkeletonBox' : 'View';
  const containerStyle = colorProp ? `style={[styles.container, ${brace(`backgroundColor: ${colorProp.name}`)}]}` : 'style={styles.container}';
  const containerProps = [
    // Un écran n'a pas de props : pas de testID à transmettre.
    !screen && (!skeleton || pressProp) ? `testID={testID}` : null,
    containerStyle,
    pressProp ? `onPress={${pressProp.name}}` : null,
  ].filter(Boolean);
  const inner = [
    screen ? `<Text style={styles.text}>${name}</Text>` : textProp ? `<Text style={styles.text}>{${textProp.name}}</Text>` : null,
    childrenProp ? `{${childrenProp.name}}` : null,
  ].filter(Boolean) as string[];
  const defaults = props.filter((p) => p.optional && p.default).map((p) => `${p.name} = ${valueCode(p, q)}`);
  const params = screen ? '' : brace([...props.filter((p) => !(p.optional && p.default)).map((p) => p.name), ...defaults, 'testID'].join(', '));
  let jsx = `<${container} ${containerProps.join(' ')}>
      ${inner.join('\n      ') || '{null}'}
    </${container}>`;
  // Pressable + skeleton : la forme reste un SkeletonBox, le Pressable dedans.
  if (pressProp && skeleton) jsx = `<SkeletonBox ${containerStyle}>
      <Pressable testID={testID} onPress={${pressProp.name}}>
        ${inner.join('\n        ') || '{null}'}
      </Pressable>
    </SkeletonBox>`;

  const rnImports = [...new Set([pressProp ? 'Pressable' : null, inner.some((l) => l.startsWith('<Text')) ? 'Text' : null, !pressProp && !skeleton ? 'View' : null, !layout.stylesFile ? 'StyleSheet' : null].filter(Boolean) as string[])].sort();
  const header = [
    `import React from ${q}react${q}${semi}`,
    usesNode && !layout.propsFile ? `import type ${brace('ReactNode')} from ${q}react${q}${semi}` : null,
    rnImports.length ? `import ${brace(rnImports.join(', '))} from ${q}react-native${q}${semi}` : null,
    skeleton ? `import ${brace('SkeletonBox, withSkeleton')} from ${q}react-zero-skeleton${q}${semi}` : null,
    !screen && layout.propsFile ? `import ${brace(propsName)} from ${q}./${name}.props${q}${semi}` : null,
    layout.stylesFile ? `import ${brace('styles')} from ${q}./${name}.styles${q}${semi}` : null,
  ].filter(Boolean);

  const signature = screen ? `const ${name} = () => {` : `const ${name}: React.FC<${propsName}> = (${params}) => {`;
  const mock = textProp ? `, ${brace(`mockProps: ${brace(`${textProp.name}: ${q}${textProp.default || 'Lorem ipsum'}${q}`)}`)}` : '';
  const exported = skeleton ? `withSkeleton(${name}${mock})` : name;
  const body = `${signature}
  return (
    ${jsx}
  )${semi}
}${semi}`;

  const mainCode = `${header.join('\n')}
${!screen && !layout.propsFile ? `\n${propsInterface}\n` : ''}
${layout.exportDefault ? body : body.replace(`const ${name}`, `export const ${name}`)}
${!layout.stylesFile ? `\nconst styles = ${stylesBody}${semi}\n` : ''}${layout.exportDefault ? `\nexport default ${exported}${semi}\n` : skeleton ? `\n// Avec skeleton : importez plutôt ${name}Skeleton.\nexport const ${name}Skeleton = ${exported}${semi}\n` : ''}`;

  // Fichiers relatifs au dossier du composant.
  const out: { path: string; content: string }[] = [{ path: `${name}.tsx`, content: mainCode.replace(/\n{3,}/g, '\n\n') }];
  if (!screen && layout.propsFile) out.push({ path: `${name}.props.ts`, content: `${usesNode ? `import type ${brace('ReactNode')} from ${q}react${q}${semi}\n\n` : ''}${propsInterface}\n` });
  if (layout.stylesFile) out.push({ path: `${name}.styles.ts`, content: `import ${brace('StyleSheet')} from ${q}react-native${q}${semi}\n\nexport const styles = ${stylesBody}${semi}\n` });
  if (layout.folder && layout.index) {
    out.push({
      path: 'index.ts',
      content: layout.exportDefault
        ? `import ${name} from ${q}./${name}${q}${semi}\n${!screen && layout.propsFile ? `export type ${brace(propsName)} from ${q}./${name}.props${q}${semi}\n` : ''}export default ${name}${semi}\n`
        : `export ${brace(name)} from ${q}./${name}${q}${semi}\n${!screen && layout.propsFile ? `export type ${brace(propsName)} from ${q}./${name}.props${q}${semi}\n` : ''}`,
    });
  }
  return out;
}

// ---- Copie d'un composant existant ----

/** Le composant source est-il exporté par défaut ? */
function fromIsDefault(root: string, from: { file: string; name: string }): boolean {
  const code = fs.readFileSync(path.join(root, from.file), 'utf8');
  return new RegExp(`export\\s+default\\s+(function\\s+)?(\\w+\\()*${from.name}\\b`).test(code);
}

/**
 * Fichiers du composant copié : son dossier entier s'il en a un à son nom (fichiers `Nom.*` et index),
 * sinon son seul fichier. Le nom est remplacé partout (`Nom`, `NomProps`, `Nom.styles`…), et les
 * imports relatifs vers ce qui n'est pas copié pointent toujours vers l'original.
 */
function copyFiles(root: string, from: { file: string; name: string }, name: string, folder: string): { path: string; content: string }[] {
  const srcAbs = path.join(root, from.file);
  if (!fs.existsSync(srcAbs)) throw new SourceError(`${from.file} introuvable.`);
  const srcDir = path.posix.dirname(from.file);
  const own = path.posix.basename(srcDir) === from.name || path.posix.basename(from.file).replace(/\.(tsx|jsx)$/, '') === from.name;
  const sources = own && path.posix.basename(srcDir) === from.name
    ? fs.readdirSync(path.join(root, srcDir)).filter((f) => f.startsWith(`${from.name}.`) || /^index\.(ts|tsx|js)$/.test(f)).filter((f) => !/\.(test|spec)\./.test(f)).map((f) => `${srcDir}/${f}`)
    : [from.file];
  const rename = (text: string) => text.replace(new RegExp(`\\b${from.name}(?=(Props|Styles|Style)?\\b)`, 'g'), name);
  const targetOf = (file: string) => {
    const base = path.posix.basename(file);
    const renamed = base.startsWith(`${from.name}.`) ? rename(base) : sources.length === 1 ? `${name}${path.posix.extname(base)}` : base;
    return `${folder}/${renamed}`;
  };
  const copied = new Map(sources.map((f) => [f, targetOf(f)]));
  return sources.map((file) => {
    const target = copied.get(file)!;
    let code = fs.readFileSync(path.join(root, file), 'utf8');
    // Imports relatifs : vers la copie si le fichier est copié, sinon vers l'original.
    code = code.replace(/((?:from|import|require)\s*\(?\s*)(['"])(\.{1,2}\/[^'"]*)\2/g, (whole, lead: string, quote: string, spec: string) => {
      const resolved = resolveRelative(root, file, spec);
      const dest = resolved && copied.has(resolved) ? copied.get(resolved)! : resolved;
      if (!dest) {
        // Fichier non résolu (asset…) : chemin recalculé tel quel depuis le nouvel emplacement.
        const abs = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
        let rel = path.posix.relative(path.posix.dirname(target), abs);
        if (!rel.startsWith('.')) rel = `./${rel}`;
        return `${lead}${quote}${rel}${quote}`;
      }
      // Import avec extension (asset, `.json`) : gardée ; sinon, chemin sans extension ni `/index`.
      const keepExt = /\.(png|jpe?g|gif|webp|svg|json|ttf|otf|mp4|mp3|lottie)$/i.test(spec);
      let rel = path.posix.relative(path.posix.dirname(target), keepExt ? dest : dest.replace(/\.(tsx?|jsx?)$/, '').replace(/\/index$/, ''));
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${lead}${quote}${rel}${quote}`;
    });
    return { path: target, content: rename(code) };
  });
}
