/**
 * Contrats partagés entre le runtime (dans l'app), l'éditeur (navigateur) et le serveur (Node).
 * Ce fichier ne doit dépendre de rien : il est importé des trois côtés.
 */

/** Emplacement d'un élément JSX dans le code : `fichier:ligne:colonne` (ligne 1-based, colonne 0-based). */
export type Loc = string;

export interface ParsedTag {
  loc: Loc;
  file: string;
  line: number;
  column: number;
  name: string;
}

/** Valeur injectée par le plugin Babel : `fichier:ligne:colonne:Nom`. */
export function parseTag(tag: string): ParsedTag | null {
  const parts = tag.split(':');
  if (parts.length < 4) return null;
  const name = parts.pop()!;
  const column = Number(parts.pop());
  const line = Number(parts.pop());
  const file = parts.join(':');
  if (!file || !Number.isInteger(line) || !Number.isInteger(column)) return null;
  return { loc: `${file}:${line}:${column}`, file, line, column, name };
}

export function parseLoc(loc: Loc): { file: string; line: number; column: number } | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(loc);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), column: Number(m[3]) };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Nœud de l'arbre des calques, construit depuis l'arbre React rendu. */
export interface LayerNode {
  /** Identifiant unique dans le rendu courant (plusieurs instances peuvent partager un même `loc`). */
  key: string;
  loc: Loc;
  name: string;
  children: LayerNode[];
}

export interface SelectionInfo {
  loc: Loc;
  name: string;
  /** Du plus proche au plus lointain : l'élément cliqué puis ses parents instrumentés. */
  ancestors: { loc: Loc; name: string }[];
  rect: Rect | null;
  computed: Record<string, string>;
}

/** Messages runtime → éditeur. */
export type RuntimeMessage =
  | { source: 'rn-canvas'; type: 'ready'; story: string }
  | { source: 'rn-canvas'; type: 'tree'; story: string; tree: LayerNode[] }
  | { source: 'rn-canvas'; type: 'select'; story: string; selection: SelectionInfo }
  | { source: 'rn-canvas'; type: 'error'; story: string; message: string };

export type CanvasMode = 'inspect' | 'interact';

/** Retire `source` de chaque membre d'une union de messages. */
export type Payload<T> = T extends unknown ? Omit<T, 'source'> : never;

/** Messages éditeur → runtime. */
export type EditorMessage =
  | { source: 'rn-canvas-editor'; type: 'mode'; mode: CanvasMode }
  /** `name` : nom attendu ; tant que l'écran affiche autre chose à cet emplacement (Fast Refresh en cours), la sélection attend. */
  | { source: 'rn-canvas-editor'; type: 'select'; loc: Loc | null; name?: string }
  | { source: 'rn-canvas-editor'; type: 'hover'; loc: Loc | null };

/** Liste des stories, calculée par le serveur à partir des fichiers `*.canvas.tsx`. */
export interface StoryEntry {
  /** `chemin/du/fichier.canvas.tsx#NomExport` */
  id: string;
  file: string;
  exportName: string;
  title: string;
}

export interface StoryGroup {
  file: string;
  title: string;
  stories: StoryEntry[];
}

// ---- API HTTP du serveur ----

export type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'expression';

export interface SourceValue {
  kind: ValueKind;
  /** Valeur littérale si `kind` n'est pas `expression`. */
  value?: string | number | boolean | null;
  /** Code source de l'expression (toujours présent). */
  code: string;
}

export interface StyleSource {
  /** `inline` = objet littéral sur l'élément ; `stylesheet` = entrée d'un `StyleSheet.create`. */
  kind: 'inline' | 'stylesheet' | 'unknown';
  /** Pour `stylesheet` : `styles.card`. Pour `unknown` : le code de l'expression. */
  ref: string;
  /** Nombre d'utilisations de la référence dans le fichier (un style partagé vaut > 1). */
  usages: number;
  conditional: boolean;
  properties: { key: string; value: SourceValue }[];
}

export interface InspectResult {
  loc: Loc;
  file: string;
  name: string;
  text: { editable: boolean; value: string | null; code: string | null } | null;
  props: { name: string; value: SourceValue | null }[];
  style: { sources: StyleSource[]; editable: boolean; code: string | null };
  /** Identifiants utilisables comme jetons dans ce fichier (ex. `colors`). */
  scope: string[];
}

export type EditValue =
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'expression'; code: string }
  | { kind: 'remove' };

export type StyleTarget = { kind: 'instance' } | { kind: 'stylesheet'; ref: string };

export type EditRequest =
  | { op: 'setStyle'; loc: Loc; name: string; key: string; value: EditValue; target: StyleTarget }
  | { op: 'setText'; loc: Loc; name: string; value: string }
  | { op: 'setProp'; loc: Loc; name: string; prop: string; value: EditValue }
  | { op: 'setToken'; path: string; value: EditValue }
  | { op: 'remove'; loc: Loc; name: string }
  | { op: 'duplicate'; loc: Loc; name: string }
  | { op: 'move'; loc: Loc; name: string; target: Loc; targetName: string; position: InsertPosition }
  | { op: 'insert'; loc: Loc; name: string; position: InsertPosition; component: { name: string; file: string | null } };

/** Où placer un élément par rapport à la cible : frère avant/après, ou dernier enfant. */
export type InsertPosition = 'before' | 'after' | 'inside';

/** Composant insérable depuis la bibliothèque. `file` vaut null pour les primitives React Native. */
export interface ComponentEntry {
  name: string;
  file: string | null;
  group: string;
  /** Props obligatoires, remplies avec des valeurs d'exemple à l'insertion. */
  props: { name: string; type: 'string' | 'number' | 'boolean' | 'function' | 'array' | 'unknown' }[];
}

export interface EditResult {
  ok: true;
  file: string;
  /** Emplacement de l'élément édité, déplacé ou créé (null s'il a été supprimé). */
  loc: Loc | null;
}

export interface ThemeToken {
  path: string;
  value: SourceValue;
}

export interface ThemeInfo {
  file: string;
  exportName: string;
  tokens: ThemeToken[];
}

export interface ProjectInfo {
  name: string;
  root: string;
  appUrl: string;
  /** Chaque écran est servi depuis son propre sous-domaine de localhost (stockage isolé). */
  isolateStories: boolean;
  theme: ThemeInfo | null;
  stories: StoryGroup[];
  components: ComponentEntry[];
}
