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
  | { source: 'rn-canvas-editor'; type: 'select'; loc: Loc | null }
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
  | { op: 'setToken'; path: string; value: EditValue };

export interface EditResult {
  ok: true;
  file: string;
  /** Nouvel emplacement de l'élément édité (peut bouger si une édition a lieu au-dessus). */
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
  theme: ThemeInfo | null;
  stories: StoryGroup[];
}
