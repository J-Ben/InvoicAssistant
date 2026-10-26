/**
 * Le projet hôte : configuration, découverte des stories, lecture et écriture des fichiers.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EditRequest, EditResult, InspectResult, ProjectInfo, StoryGroup, ThemeInfo, ThemeToken } from '../shared/protocol.ts';
import { parseLoc } from '../shared/protocol.ts';
import { type AstNode, type Patch, type SourceFile, applyPatches, findProperty, parse, programOf, propertyKey, unwrap } from './ast.ts';
import { setProp, setStyle, setText, setToken, themeObject } from './edit.ts';
import { SourceError, findElement, inspectElement, locOfIndex, sourceValue } from './inspect.ts';

export interface CanvasConfig {
  /** URL de l'app en version web (serveur de dev Expo). */
  appUrl: string;
  /** Dossiers où chercher les fichiers `*.canvas.tsx`. */
  include: string[];
  /** Objet de thème exporté dont les valeurs deviennent des jetons. */
  theme?: { file: string; export: string };
  /** Fichier de configuration runtime optionnel (wrapper, appareils). */
  runtimeConfig: string;
  /** Fichier généré qui référence toutes les stories pour le bundler. */
  manifest: string;
}

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
      theme: this.theme(),
      stories: this.stories(),
    };
  }

  // ---- Stories ----

  canvasFiles(): string[] {
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
        } else if (CANVAS_FILE.test(entry.name)) {
          out.push(this.relative(path.join(dir, entry.name)));
        }
      }
    };
    for (const dir of this.config.include) visit(path.resolve(this.root, dir));
    return out.sort();
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
    const entries = this.canvasFiles()
      .map((file) => `    ${JSON.stringify(file)}: () => require(${JSON.stringify(importPath(file))}),`)
      .join('\n');

    const content = `/* eslint-disable */
// Fichier généré par rn-canvas : ne pas modifier à la main (\`npx rn-canvas generate\`).
import type { CanvasManifest } from 'rn-canvas/runtime';

const manifest: CanvasManifest = {
  config: ${runtimeConfig},
  files: {
${entries}
  },
};

export default manifest;
`;
    const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (previous === content) return false;
    fs.writeFileSync(target, content);
    return true;
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
      return { file: theme.file, exportName: theme.export, tokens };
    } catch {
      return null;
    }
  }

  // ---- Inspection / édition ----

  inspect(loc: string, name?: string): InspectResult {
    const parsed = parseLoc(loc);
    if (!parsed) throw new SourceError(`Emplacement invalide : ${loc}`);
    const src = this.read(parsed.file);
    const { element } = findElement(src.ast, parsed.line, parsed.column, name);
    return inspectElement(src, parsed.file, element);
  }

  edit(request: EditRequest): EditResult {
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
    switch (request.op) {
      case 'setStyle':
        patches = setStyle(src, element, request.key, request.value, request.target);
        break;
      case 'setText':
        patches = setText(src, element, request.value);
        break;
      case 'setProp':
        patches = setProp(src, element, request.prop, request.value);
        break;
      default:
        throw new SourceError('Opération inconnue.');
    }

    const next = this.write(parsed.file, src, patches);
    // Les éditions n'ajoutent ni ne retirent d'éléments : le n-ième élément reste le même.
    return { ok: true, file: parsed.file, loc: locOfIndex(next.ast, parsed.file, index) };
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
    return next;
  }
}

export function loadConfig(root: string): CanvasConfig {
  const raw = (readJson(path.join(root, CONFIG_FILE)) ?? {}) as Partial<CanvasConfig>;
  return {
    appUrl: raw.appUrl ?? 'http://localhost:8081',
    include: raw.include ?? ['src', 'app', 'components'].filter((d) => fs.existsSync(path.join(root, d))),
    theme: raw.theme,
    runtimeConfig: raw.runtimeConfig ?? 'rn-canvas.config.tsx',
    manifest: raw.manifest ?? 'rn-canvas.stories.ts',
  };
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
