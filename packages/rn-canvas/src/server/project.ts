/**
 * Le projet hôte : configuration, découverte des stories, lecture et écriture des fichiers.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Board, ComponentEntry, EditRequest, FlowLink, EditResult, HistoryState, InspectResult, ProjectInfo, StoryGroup, ThemeInfo, ThemeToken } from '../shared/protocol.ts';
import { emptyBoard, normalizeBoard, parseLoc } from '../shared/protocol.ts';
import { type AstNode, type Patch, type SourceFile, applyPatches, findProperty, jsxName, moduleDeclarators, parse, programOf, propertyKey, unwrap, walk } from './ast.ts';
import { setProp, setStyle, setText, setToken, themeObject } from './edit.ts';
import { examplesFile, generateExamples, writeIfChanged } from './examples.ts';
import { matchRoute, navigationLinks, relativeImports, resolveImport, routesOf } from './flows.ts';
import { SourceError, findElement, inspectElement, locOfIndex, meaningfulChildren, normalizeJsxText, sourceValue } from './inspect.ts';
import { PRIMITIVES, componentsOf } from './library.ts';
import { type Insertion, componentJsx, duplicateElement, ensureImport, finalOffset, insertion, moveElement, removeElement } from './structure.ts';

export interface CanvasConfig {
  /** URL de l'app en version web (serveur de dev Expo). */
  appUrl: string;
  /**
   * Sert chaque écran depuis son propre sous-domaine (`accueil-x1y2.localhost`) : chacun a ainsi
   * son stockage (localStorage, IndexedDB, OPFS…), sans conflit entre écrans affichés en parallèle.
   * Activé par défaut quand l'app tourne sur localhost.
   */
  isolateStories: boolean;
  /** Dossiers où chercher les fichiers `*.canvas.tsx`. */
  include: string[];
  /** Objet de thème exporté dont les valeurs deviennent des jetons. */
  /**
   * Objet de thème exporté dont les valeurs deviennent des jetons. `alias` : nom sous lequel les
   * composants y accèdent, s'il diffère de l'export (ex. `colors`, renvoyé par useTheme()).
   */
  theme?: { file: string; export: string; alias?: string };
  /** Fichier de configuration runtime optionnel (wrapper, appareils). */
  runtimeConfig: string;
  /** Fichier généré qui référence toutes les stories pour le bundler. */
  manifest: string;
  /** Dossier des routes expo-router (`app`), pour le mode Flux ; null sans expo-router. */
  routerRoot: string | null;
  /** Pages, parcours, groupes et notes du canevas (fichier versionné avec le projet). */
  board: string;
  /** Routes sans interface (redirections…) à ne pas proposer comme écrans. */
  ignoreRoutes: string[];
}

export interface ElementOutline {
  loc: string;
  name: string;
  text?: string;
  children: ElementOutline[];
}

interface HistoryEntry {
  label: string;
  file: string;
  before: string;
  after: string;
  /** Élément à resélectionner après annulation / rétablissement. */
  locBefore: string | null;
  locAfter: string | null;
}

const HISTORY_LIMIT = 100;

export const CONFIG_FILE = 'rn-canvas.json';
const CANVAS_FILE = /\.canvas\.(tsx|ts|jsx|js)$/;
const IGNORED_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'build', 'ios', 'android']);

export class Project {
  readonly root: string;
  readonly config: CanvasConfig;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.config = loadConfig(this.root);
  }

  /** Résout un chemin relatif au projet en refusant tout ce qui sort du projet ou de son code. */
  resolve(file: string): string {
    const abs = path.resolve(this.root, file);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('node_modules')) {
      throw new SourceError(`Fichier hors du projet : ${file}`, 403);
    }
    return abs;
  }

  relative(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  info(): ProjectInfo {
    const pkg = readJson(path.join(this.root, 'package.json')) as { name?: string } | null;
    return {
      name: pkg?.name ?? path.basename(this.root),
      root: this.root,
      appUrl: this.config.appUrl,
      isolateStories: this.config.isolateStories,
      theme: this.theme(),
      stories: this.stories(),
      components: this.components(),
    };
  }

  // ---- Pages et parcours ----

  /** Plan du canevas ; vue d'ensemble seule si le fichier n'existe pas encore. */
  board(): Board {
    const file = this.resolve(this.config.board);
    return fs.existsSync(file) ? normalizeBoard(readJson(file)) : emptyBoard();
  }

  saveBoard(input: unknown): Board {
    const board = normalizeBoard(input);
    const file = this.resolve(this.config.board);
    const text = `${JSON.stringify(board, null, 2)}\n`;
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    return board;
  }

  // ---- Stories ----

  canvasFiles(): string[] {
    return this.sourceFiles((name) => CANVAS_FILE.test(name));
  }

  /** Fichiers des dossiers `include` dont le nom satisfait `accept`, triés. */
  sourceFiles(accept: (name: string) => boolean, dirs: string[] = this.config.include): string[] {
    const out: string[] = [];
    const visit = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) visit(path.join(dir, entry.name));
        } else if (accept(entry.name)) {
          out.push(this.relative(path.join(dir, entry.name)));
        }
      }
    };
    for (const dir of dirs) visit(path.resolve(this.root, dir));
    return [...new Set(out)].sort();
  }

  stories(): StoryGroup[] {
    return this.canvasFiles().map((file) => {
      const fallbackTitle = path.basename(file).replace(CANVAS_FILE, '');
      try {
        const { ast } = parse(fs.readFileSync(this.resolve(file), 'utf8'), file);
        const { title, exports } = storyExports(ast);
        const groupTitle = title ?? fallbackTitle;
        return {
          file,
          title: groupTitle,
          stories: exports.map((exportName) => ({ id: `${file}#${exportName}`, file, exportName, title: humanize(exportName) })),
        };
      } catch (error) {
        return { file, title: `${fallbackTitle} (erreur : ${(error as Error).message})`, stories: [] };
      }
    });
  }

  /** Écrit le manifeste lu par le runtime. N'écrit que si le contenu change (évite les rechargements en boucle). */
  writeManifest(): boolean {
    const target = path.resolve(this.root, this.config.manifest);
    const dir = path.dirname(target);
    const importPath = (file: string) => {
      let rel = path.relative(dir, path.resolve(this.root, file)).split(path.sep).join('/');
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return rel;
    };
    const runtimeConfig = fs.existsSync(path.resolve(this.root, this.config.runtimeConfig))
      ? `require(${JSON.stringify(importPath(this.config.runtimeConfig))}).default`
      : 'undefined';
    const pkg = readJson(path.join(this.root, 'package.json')) as { dependencies?: Record<string, string> } | null;
    // Contexte interne d'expo-router (paramètres de route) : facultatif, absent si son chemin change.
    const router = pkg?.dependencies?.['expo-router']
      ? `\n  router: require('expo-router').router,\n  routeParams: (() => {\n    try {\n      return require('expo-router/build/Route').LocalRouteParamsContext;\n    } catch {\n      return undefined;\n    }\n  })(),`
      : '';
    const entries = this.canvasFiles()
      .map((file) => `    ${JSON.stringify(file)}: () => require(${JSON.stringify(importPath(file))}),`)
      .join('\n');
    // Composants de la bibliothèque, chargés à la demande pour leurs aperçus.
    const components = this.components()
      .filter((c) => c.file)
      .map((c) => `    ${JSON.stringify(`${c.file}#${c.name}`)}: () => require(${JSON.stringify(importPath(c.file!))}).${c.name},`)
      .join('\n');

    const content = `/* eslint-disable */
// Fichier généré par rn-canvas : ne pas modifier à la main (\`npx rn-canvas generate\`).
import type { CanvasManifest } from 'rn-canvas/runtime';

const manifest: CanvasManifest = {
  config: ${runtimeConfig},${router}
  files: {
${entries}
  },
  components: {
${components}
  },
};

export default manifest;
`;
    const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (previous === content) return false;
    fs.writeFileSync(target, content);
    return true;
  }

  // ---- Données d'exemple tirées des types ----

  /** Écrit le fichier d'exemples généré (`generatedExamples`) ; null si le projet n'a pas TypeScript. */
  writeGeneratedExamples(): { file: string; components: string[]; changed: boolean } | null {
    const file = examplesFile(this.config.include);
    // Composants de l'app seulement (pas les enveloppes du canevas, comme canvas/seed.tsx).
    const canvasDir = path.posix.dirname(file);
    const components = this.components().filter((c): c is ComponentEntry & { file: string } => c.file !== null && !(canvasDir !== '.' && c.file.startsWith(`${canvasDir}/`)));
    const result = generateExamples(this.root, components, (target) => this.moduleSpecifier(file, target));
    if (!result) return null;
    return { file, components: result.components, changed: writeIfChanged(this.resolve(file), result.code) };
  }

  // ---- Écrans générés depuis les routes ----

  /** Fichier de route (parmi `routeFiles`) affiché par chaque fichier canvas → ses stories. */
  private screensOfStories(routeFiles: string[]): Map<string, string[]> {
    const known = new Set(routeFiles);
    const out = new Map<string, string[]>();
    for (const group of this.stories()) {
      try {
        const src = parse(fs.readFileSync(this.resolve(group.file), 'utf8'), group.file);
        const screen = relativeImports(src)
          .map((source) => resolveImport(this.root, group.file, source))
          .find((file) => file && known.has(file));
        if (screen) out.set(screen, [...(out.get(screen) ?? []), ...group.stories.map((s) => s.id)]);
      } catch {
        // Fichier canvas illisible : signalé ailleurs (liste des écrans).
      }
    }
    return out;
  }

  /** Routes d'expo-router qui n'ont pas encore d'écran dans le canevas. */
  missingRoutes(): { file: string; name: string; title: string; params: string[] }[] {
    const routerRoot = this.config.routerRoot;
    if (!routerRoot) return [];
    const routes = routesOf(this.root, routerRoot);
    const covered = this.screensOfStories(routes.map((r) => r.file));
    return routes
      .filter((r) => !covered.has(r.file) && !this.config.ignoreRoutes.includes(r.file))
      .map((r) => {
        const parts = r.file
          .slice(routerRoot.length + 1)
          .replace(/\.(tsx|ts|jsx|js)$/, '')
          .split('/')
          .filter((s) => !/^\(.+\)$/.test(s));
        if (parts[parts.length - 1] === 'index') parts.pop();
        const words = parts.map((s) => s.replace(/^\[(\.\.\.)?(.+)\]$/, '$2'));
        const pascal = words.map((w) => w.replace(/(^|[-_\s])(\w)/g, (_m, _s, c: string) => c.toUpperCase())).join('') || 'Accueil';
        return {
          file: r.file,
          name: pascal,
          title: parts.length ? parts.join(' / ') : 'Accueil',
          params: parts.filter((s) => /^\[.+\]$/.test(s)).map((s) => s.replace(/^\[(\.\.\.)?(.+)\]$/, '$2')),
        };
      });
  }

  /**
   * Un fichier canvas par route sans écran (toutes, ou celles de `files`). Les routes à paramètre
   * (`[id]`) reçoivent une valeur d'exemple à remplacer. Rien n'est écrasé.
   */
  generateRouteStories(files?: string[]): { created: string[] } {
    const dir = this.config.include.includes('canvas') ? 'canvas' : `${this.config.include[0] ?? 'src'}/canvas`;
    const created: string[] = [];
    for (const route of this.missingRoutes()) {
      if (files && !files.includes(route.file)) continue;
      let target = `${dir}/${route.name}.canvas.tsx`;
      for (let n = 2; fs.existsSync(this.resolve(target)); n++) target = `${dir}/${route.name}${n}.canvas.tsx`;
      let spec = path.posix.relative(dir, route.file.replace(/\.(tsx|jsx|ts|js)$/, ''));
      if (!spec.startsWith('.')) spec = `./${spec}`;
      const params = route.params.length ? `, params: { ${route.params.map((p) => `${/^[A-Za-z_$][\w$]*$/.test(p) ? p : JSON.stringify(p)}: '1'`).join(', ')} }` : '';
      const code = `import type { CanvasMeta, CanvasStory } from 'rn-canvas/runtime';
import Screen from ${JSON.stringify(spec)};

// Écran généré depuis ${route.file}.${route.params.length ? ` Paramètre${route.params.length > 1 ? 's' : ''} de route (${route.params.join(', ')}) : valeur d'exemple, à remplacer par un identifiant existant.` : ''}
export default { title: ${JSON.stringify(route.title.replace(/^\w/, (c) => c.toUpperCase()))}, component: Screen${params} } satisfies CanvasMeta;

// Chaque écran a son propre stockage (vide au départ, conservé entre les sessions) :
// remplissez-le en mode Interaction puis capturez une variante.
export const Actuel: CanvasStory = {};
`;
      const abs = this.resolve(target);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, code);
      created.push(target);
    }
    if (created.length) this.writeManifest();
    return { created };
  }

  // ---- Flux (liens de navigation) ----

  flows(): FlowLink[] {
    const routerRoot = this.config.routerRoot;
    if (!routerRoot) return [];
    const routes = routesOf(this.root, routerRoot);
    const groups = this.stories();

    const storiesByScreen = this.screensOfStories(routes.map((r) => r.file));

    const code = this.sourceFiles((name) => /\.(tsx|jsx|ts|js)$/.test(name) && !CANVAS_FILE.test(name) && !/\.(test|spec|d)\./.test(name), [...this.config.include, routerRoot]);
    const links: FlowLink[] = [];
    for (const file of code) {
      let src;
      try {
        src = parse(fs.readFileSync(this.resolve(file), 'utf8'), file);
      } catch {
        continue;
      }
      for (const link of navigationLinks(src, file)) {
        const route = matchRoute(link.href, routes);
        links.push({
          ...link,
          route: route?.file ?? null,
          targets: route ? storiesByScreen.get(route.file) ?? [] : [],
          sources: link.loc ? [] : storiesByScreen.get(file) ?? [],
        });
      }
    }
    return links;
  }

  // ---- Thème ----

  theme(): ThemeInfo | null {
    const theme = this.config.theme;
    if (!theme) return null;
    try {
      const src = parse(fs.readFileSync(this.resolve(theme.file), 'utf8'), theme.file);
      const object = themeObject(src.ast, theme.export);
      if (!object) return null;
      const tokens: ThemeToken[] = [];
      flattenTokens(src, object, theme.export, tokens);
      return { file: theme.file, exportName: theme.export, alias: theme.alias ?? null, tokens };
    } catch {
      return null;
    }
  }

  // ---- Bibliothèque de composants ----

  private libraryCache = new Map<string, { mtime: number; entries: ComponentEntry[] }>();

  components(): ComponentEntry[] {
    const files = this.sourceFiles((name) => /\.(tsx|jsx)$/.test(name) && !CANVAS_FILE.test(name) && !/\.(test|spec)\./.test(name));
    const entries = files.flatMap((file) => {
      const abs = this.resolve(file);
      const mtime = fs.statSync(abs).mtimeMs;
      const cached = this.libraryCache.get(file);
      if (cached?.mtime === mtime) return cached.entries;
      let found: ComponentEntry[] = [];
      try {
        found = componentsOf(file, parse(fs.readFileSync(abs, 'utf8'), file));
      } catch {
        // Fichier en cours d'écriture ou invalide : il réapparaîtra au prochain appel.
      }
      this.libraryCache.set(file, { mtime, entries: found });
      return found;
    });
    return [...PRIMITIVES, ...entries];
  }

  /** Arbre des éléments JSX d'un fichier (pour les outils qui n'ont pas l'app sous les yeux). */
  elements(file: string): ElementOutline[] {
    const src = this.read(file);
    const roots: ElementOutline[] = [];
    const visit = (node: AstNode, into: ElementOutline[]) => {
      walk(node, (child) => {
        if (child === node || child.type !== 'JSXElement') return;
        const outline: ElementOutline = { loc: `${file}:${child.loc.start.line}:${child.loc.start.column}`, name: jsxName(child.openingElement.name) ?? '?', children: [] };
        const text = meaningfulChildren(child);
        if (text.length === 1 && text[0].type === 'JSXText') outline.text = normalizeJsxText(text[0].value);
        into.push(outline);
        visit(child, outline.children);
        return false;
      });
    };
    visit(src.ast, roots);
    return roots;
  }

  // ---- Inspection / édition ----

  inspect(loc: string, name?: string): InspectResult {
    const parsed = parseLoc(loc);
    if (!parsed) throw new SourceError(`Emplacement invalide : ${loc}`);
    const src = this.read(parsed.file);
    const { element } = findElement(src.ast, parsed.line, parsed.column, name);
    return inspectElement(src, parsed.file, element);
  }

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** Modification en cours d'enregistrement dans l'historique (une par appel à edit). */
  private recording: HistoryEntry | null = null;

  history(): HistoryState {
    return { undo: this.undoStack.at(-1)?.label ?? null, redo: this.redoStack.at(-1)?.label ?? null };
  }

  undo(): EditResult {
    return this.replay(this.undoStack, this.redoStack, 'before');
  }

  redo(): EditResult {
    return this.replay(this.redoStack, this.undoStack, 'after');
  }

  private replay(from: HistoryEntry[], to: HistoryEntry[], restore: 'before' | 'after'): EditResult {
    const entry = from.at(-1);
    if (!entry) throw new SourceError(restore === 'before' ? 'Rien à annuler.' : 'Rien à rétablir.', 409);
    const abs = this.resolve(entry.file);
    const expected = restore === 'before' ? entry.after : entry.before;
    if (fs.readFileSync(abs, 'utf8') !== expected) {
      // Le fichier a été modifié ailleurs (éditeur de code…) : on n'écrase jamais ce travail.
      from.length = 0;
      throw new SourceError(`${entry.file} a été modifié en dehors de l'éditeur depuis : impossible de ${restore === 'before' ? 'l’annuler' : 'le rétablir'} sans écraser ce changement.`, 409);
    }
    fs.writeFileSync(abs, entry[restore]);
    from.pop();
    to.push(entry);
    return { ok: true, file: entry.file, loc: restore === 'before' ? entry.locBefore : entry.locAfter, history: this.history() };
  }

  edit(request: EditRequest): EditResult {
    this.recording = { label: describe(request), file: '', before: '', after: '', locBefore: 'loc' in request ? request.loc : null, locAfter: null };
    try {
      const result = this.applyEdit(request);
      const entry = this.recording;
      if (entry.file) {
        entry.locAfter = result.loc;
        this.undoStack.push(entry);
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
        this.redoStack = [];
      }
      return { ...result, history: this.history() };
    } finally {
      this.recording = null;
    }
  }

  private applyEdit(request: EditRequest): Omit<EditResult, 'history'> {
    if (request.op === 'addStory') return this.addStory(request.file, request.base, request.exportName, request.storage);
    if (request.op === 'setToken') {
      const theme = this.config.theme;
      if (!theme) throw new SourceError('Aucun thème configuré dans rn-canvas.json.');
      const src = this.read(theme.file);
      this.write(theme.file, src, setToken(src, request.path, request.value));
      return { ok: true, file: theme.file, loc: null };
    }

    const parsed = parseLoc(request.loc);
    if (!parsed) throw new SourceError(`Emplacement invalide : ${request.loc}`);
    const src = this.read(parsed.file);
    const { element, index } = findElement(src.ast, parsed.line, parsed.column, request.name);

    let patches: Patch[];
    // Pour les opérations qui créent ou déplacent un élément : où le retrouver après écriture.
    let inserted: Insertion | null = null;
    switch (request.op) {
      case 'setStyle':
        patches = setStyle(src, element, request.key, request.value, request.target);
        break;
      case 'setStyles': {
        // Chaque propriété s'écrit sur le code produit par la précédente, puis le tout en une fois.
        let current = src;
        for (const { key, value } of request.entries) {
          const { element: el } = findElement(current.ast, parsed.line, parsed.column, request.name);
          const next = applyPatches(current.code, setStyle(current, el, key, value, request.target));
          current = parse(next, parsed.file);
        }
        patches = current.code === src.code ? [] : [{ start: 0, end: src.code.length, text: current.code }];
        break;
      }
      case 'setText':
        patches = setText(src, element, request.value);
        break;
      case 'setProp':
        patches = setProp(src, element, request.prop, request.value);
        break;
      case 'remove': {
        this.write(parsed.file, src, removeElement(src, element));
        return { ok: true, file: parsed.file, loc: null };
      }
      case 'duplicate':
        ({ patches, inserted } = duplicateElement(src, element));
        break;
      case 'move': {
        const target = parseLoc(request.target);
        if (!target) throw new SourceError(`Emplacement invalide : ${request.target}`);
        if (target.file !== parsed.file) throw new SourceError('Le déplacement entre fichiers différents n’est pas encore pris en charge.');
        const { element: targetElement } = findElement(src.ast, target.line, target.column, request.targetName);
        ({ patches, inserted } = moveElement(src, element, targetElement, request.position));
        break;
      }
      case 'insert': {
        const entry = this.components().find((c) => c.name === request.component.name && c.file === request.component.file);
        if (!entry) throw new SourceError(`Composant « ${request.component.name} » introuvable dans la bibliothèque.`);
        const jsx = componentJsx(entry.name, entry.props);
        inserted = insertion(src, element, request.position, jsx, '');
        const from = this.importPath(parsed.file, entry, src);
        patches = [inserted, ...(from ? ensureImport(src, entry.name, from) : [])];
        break;
      }
      default:
        throw new SourceError('Opération inconnue.');
    }

    const next = this.write(parsed.file, src, patches);
    if (inserted) {
      const start = finalOffset(inserted, patches);
      const created = jsxElementAt(next.ast, start);
      return { ok: true, file: parsed.file, loc: created ? `${parsed.file}:${created.loc.start.line}:${created.loc.start.column}` : null };
    }
    // Les éditions de valeurs n'ajoutent ni ne retirent d'éléments : le n-ième élément reste le même.
    return { ok: true, file: parsed.file, loc: locOfIndex(next.ast, parsed.file, index) };
  }

  /** Ajoute `export const <exportName> = { ...<base>, storage: {…} }` à la fin d'un fichier canvas. */
  private addStory(file: string, base: string, exportName: string, storage: Record<string, string>): Omit<EditResult, 'history'> {
    if (!CANVAS_FILE.test(file)) throw new SourceError(`${file} n'est pas un fichier *.canvas.tsx.`);
    if (!/^[A-Za-z_$][\w$]*$/.test(exportName)) throw new SourceError(`Nom de variante invalide : « ${exportName} » (lettres, chiffres, _ ; sans espace).`);
    const json = JSON.stringify(storage, null, 2);
    if (json.length > 256 * 1024) throw new SourceError('Stockage trop volumineux pour être enregistré dans une variante (> 256 Ko).', 413);

    const src = this.read(file);
    const { exports } = storyExports(src.ast);
    if (exports.includes(exportName)) throw new SourceError(`Une variante « ${exportName} » existe déjà dans ${file}.`, 409);
    const baseDecl = [...moduleDeclarators(src.ast)].find((d) => d.id.type === 'Identifier' && d.id.name === base);
    if (!baseDecl?.init || unwrap(baseDecl.init).type !== 'ObjectExpression') {
      throw new SourceError(`La variante « ${base} » doit être un objet ({ props, setup… }) pour servir de base.`);
    }
    const typed = programOf(src.ast).body.some(
      (s: AstNode) => s.type === 'ImportDeclaration' && s.specifiers.some((sp: AstNode) => sp.local?.name === 'CanvasStory'),
    );
    const body = json.split('\n').map((line, i) => (i === 0 ? line : `  ${line}`)).join('\n');
    const text =
      `${src.code.endsWith('\n') ? '' : '\n'}\n// Variante enregistrée depuis l'éditeur rn-canvas : « ${base} » avec le stockage capturé de l'écran.\n` +
      `export const ${exportName}${typed ? ': CanvasStory' : ''} = {\n  ...${base},\n  storage: ${body},\n};\n`;
    this.write(file, src, [{ start: src.code.length, end: src.code.length, text }]);
    this.writeManifest();
    return { ok: true, file, loc: null };
  }

  /** Spécificateur d'import d'un composant depuis `file` (chemin relatif, sans extension). */
  // ---- Écrans de composants (« Ouvrir en grand ») ----

  /**
   * Écran du canevas qui affiche un composant seul, en taille réelle : pour les modales et panneaux,
   * qui s'affichent par-dessus l'écran et n'ont donc pas d'aperçu en vignette. Ses props viennent des
   * `examples` de rn-canvas.config.tsx (`example: 'Nom'`) ; le fichier généré ouvre la modale
   * (`visible: true`…) et neutralise ses rappels. Rien n'est écrasé si le fichier existe déjà.
   */
  createComponentStory(file: string, name: string): { story: string; file: string; created: boolean } {
    const entry = this.components().find((c) => c.file === file && c.name === name);
    if (!entry) throw new SourceError(`Composant « ${name} » introuvable dans ${file}.`, 404);
    const dir = this.config.include.includes('canvas') ? 'canvas/components' : `${this.config.include[0] ?? 'src'}/canvas`;
    const target = `${dir}/${name}.canvas.tsx`;
    const abs = this.resolve(target);
    const story = `${target}#Exemple`;
    if (fs.existsSync(abs)) {
      const existing = this.stories().find((g) => g.file === target)?.stories[0]?.id;
      return { story: existing ?? story, file: target, created: false };
    }

    // Repli quand l'exemple ne les fournit pas : modale ouverte, rappels sans effet.
    const fallback = entry.props
      .map((p) => {
        if (p.type === 'boolean' && /^(visible|open|isOpen|isVisible|show|opened)$/.test(p.name)) return `${p.name}: true`;
        if (p.type === 'function') return `${p.name}: () => {}`;
        return null;
      })
      .filter(Boolean);
    const others = entry.props.filter((p) => p.type !== 'function' && !(p.type === 'boolean' && /^(visible|open|isOpen|isVisible|show|opened)$/.test(p.name)) && p.name !== 'children');
    const code = `import type { CanvasMeta, CanvasStory } from 'rn-canvas/runtime';
import { ${name} } from ${JSON.stringify(this.moduleSpecifier(target, entry.file!))};

// ${name} affiché seul, en taille réelle. Ses données viennent de \`examples.${name}\` dans
// rn-canvas.config.tsx${others.length ? ` (props attendues : ${others.map((p) => p.name).join(', ')})` : ''}.
export default {
  title: ${JSON.stringify(name)},
  component: ${name},
  example: ${JSON.stringify(name)},
  props: { ${fallback.join(', ')} },
} satisfies CanvasMeta;

export const Exemple: CanvasStory = {};
`;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, code);
    this.writeManifest();
    return { story, file: target, created: true };
  }

  /** Chemin d'import de `target` depuis `fromFile` : alias du tsconfig s'il y en a un, sinon relatif. */
  private moduleSpecifier(fromFile: string, target: string): string {
    const bare = target.replace(/\.(tsx|jsx|ts|js)$/, '').replace(/\/index$/, '');
    for (const { alias, dir } of this.pathAliases()) if (bare.startsWith(`${dir}/`)) return `${alias}/${bare.slice(dir.length + 1)}`;
    let rel = path.posix.relative(path.posix.dirname(fromFile), bare);
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
  }

  private importPath(file: string, entry: ComponentEntry, src?: SourceFile): string {
    if (!entry.file) return 'react-native';
    if (entry.file === file) return '';
    // Même style que le fichier : alias de tsconfig (`@presentation/…`) s'il en importe déjà par cet alias.
    const target = entry.file.replace(/\.(tsx|jsx|ts|js)$/, '').replace(/\/index$/, '');
    for (const { alias, dir } of this.pathAliases()) {
      if (!target.startsWith(`${dir}/`)) continue;
      const used = src && programOf(src.ast).body.some((s: AstNode) => s.type === 'ImportDeclaration' && String(s.source.value).startsWith(`${alias}/`));
      if (used) return `${alias}/${target.slice(dir.length + 1)}`;
    }
    let rel = path.posix.relative(path.posix.dirname(file), entry.file).replace(/\.(tsx|jsx|ts|js)$/, '');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
  }

  /** Alias `paths` du tsconfig.json (`"@presentation/*": ["./src/presentation/*"]`). */
  private pathAliases(): { alias: string; dir: string }[] {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(this.root, 'tsconfig.json'), 'utf8');
    } catch {
      return [];
    }
    try {
      // JSON avec commentaires et virgules finales (tolérés par TypeScript).
      const json = JSON.parse(stripJsonComments(raw).replace(/,(\s*[}\]])/g, '$1'));
      const options = json.compilerOptions ?? {};
      const base = options.baseUrl ?? '.';
      return Object.entries((options.paths ?? {}) as Record<string, string[]>)
        .filter(([key, targets]) => key.endsWith('/*') && targets[0]?.endsWith('/*'))
        .map(([key, targets]) => ({ alias: key.slice(0, -2), dir: path.posix.normalize(path.posix.join(base, targets[0].slice(0, -2))).replace(/^\.\//, '') }));
    } catch {
      return [];
    }
  }

  private read(file: string): SourceFile {
    const abs = this.resolve(file);
    if (!fs.existsSync(abs)) throw new SourceError(`Fichier introuvable : ${file}`, 404);
    return parse(fs.readFileSync(abs, 'utf8'), file);
  }

  /** Applique les patchs et vérifie que le résultat reste du code valide avant d'écrire. */
  private write(file: string, src: SourceFile, patches: Patch[]): SourceFile {
    if (patches.length === 0) return src;
    const code = applyPatches(src.code, patches);
    let next: SourceFile;
    try {
      next = parse(code, file);
    } catch (error) {
      throw new SourceError(`La modification produirait du code invalide : ${(error as Error).message}`, 500);
    }
    const abs = this.resolve(file);
    if (fs.readFileSync(abs, 'utf8') !== src.code) throw new SourceError('Le fichier a changé pendant la modification, réessayez.', 409);
    fs.writeFileSync(abs, code);
    if (this.recording) Object.assign(this.recording, { file, before: src.code, after: code });
    return next;
  }
}

/** Libellé lisible d'une modification, affiché dans « Annuler … ». */
export function describe(request: EditRequest): string {
  switch (request.op) {
    case 'setStyle':
      return `${request.key} sur <${request.name}>`;
    case 'setStyles':
      return `${request.entries.map((e) => e.key).join(', ')} sur <${request.name}>`;
    case 'setText':
      return `texte de <${request.name}>`;
    case 'setProp':
      return `${request.prop} sur <${request.name}>`;
    case 'setToken':
      return `jeton ${request.path}`;
    case 'remove':
      return `suppression de <${request.name}>`;
    case 'duplicate':
      return `duplication de <${request.name}>`;
    case 'move':
      return `déplacement de <${request.name}>`;
    case 'insert':
      return `ajout de <${request.component.name}>`;
    case 'addStory':
      return `variante ${request.exportName}`;
    default:
      return 'modification';
  }
}

export function loadConfig(root: string): CanvasConfig {
  const raw = (readJson(path.join(root, CONFIG_FILE)) ?? {}) as Partial<CanvasConfig>;
  const appUrl = raw.appUrl ?? 'http://localhost:8081';
  return {
    appUrl,
    isolateStories: raw.isolateStories ?? new URL(appUrl).hostname === 'localhost',
    include: raw.include ?? ['src', 'app', 'components'].filter((d) => fs.existsSync(path.join(root, d))),
    theme: raw.theme,
    runtimeConfig: raw.runtimeConfig ?? 'rn-canvas.config.tsx',
    manifest: raw.manifest ?? 'rn-canvas.stories.ts',
    routerRoot: raw.routerRoot !== undefined ? raw.routerRoot : detectRouterRoot(root),
    ignoreRoutes: Array.isArray(raw.ignoreRoutes) ? raw.ignoreRoutes : [],
    board: raw.board ?? (fs.existsSync(path.join(root, 'canvas')) ? 'canvas/parcours.json' : 'rn-canvas.board.json'),
  };
}

/** `app` (ou `src/app`) quand le projet utilise expo-router. */
function detectRouterRoot(root: string): string | null {
  const pkg = readJson(path.join(root, 'package.json')) as { dependencies?: Record<string, string> } | null;
  if (!pkg?.dependencies?.['expo-router']) return null;
  return ['app', 'src/app'].find((dir) => fs.existsSync(path.join(root, dir))) ?? null;
}

/** Retire les commentaires d'un JSON « à la tsconfig », sans toucher aux chaînes (`"@app/*"`). */
export function stripJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i === -1) break;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Exports nommés d'un fichier canvas (= stories) et titre éventuel de l'export par défaut. */
export function storyExports(ast: AstNode): { title: string | null; exports: string[] } {
  const exports: string[] = [];
  let title: string | null = null;
  for (const stmt of programOf(ast).body) {
    if (stmt.type === 'ExportNamedDeclaration') {
      if (stmt.exportKind === 'type') continue;
      const decl = stmt.declaration;
      if (decl?.type === 'VariableDeclaration') {
        for (const d of decl.declarations) if (d.id.type === 'Identifier') exports.push(d.id.name);
      } else if (decl?.type === 'FunctionDeclaration' && decl.id) {
        exports.push(decl.id.name);
      }
      for (const s of stmt.specifiers ?? []) {
        if (s.exportKind !== 'type' && s.exported?.name && s.exported.name !== 'default') exports.push(s.exported.name);
      }
    }
    if (stmt.type === 'ExportDefaultDeclaration') {
      const decl = unwrap(stmt.declaration);
      const titleProp = decl.type === 'ObjectExpression' ? findProperty(decl, 'title') : undefined;
      if (titleProp && unwrap(titleProp.value).type === 'StringLiteral') title = unwrap(titleProp.value).value;
    }
  }
  return { title, exports };
}

function flattenTokens(src: SourceFile, object: AstNode, prefix: string, out: ThemeToken[]): void {
  for (const prop of object.properties) {
    const key = propertyKey(prop);
    if (key === null) continue;
    const value = unwrap(prop.value);
    if (value.type === 'ObjectExpression') flattenTokens(src, value, `${prefix}.${key}`, out);
    else out.push({ path: `${prefix}.${key}`, value: sourceValue(src, value) });
  }
}

function humanize(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function jsxElementAt(ast: AstNode, start: number): AstNode | null {
  let found: AstNode | null = null;
  walk(ast, (node) => {
    if (found) return false;
    if (node.type === 'JSXElement' && node.start === start) found = node;
  });
  return found;
}
