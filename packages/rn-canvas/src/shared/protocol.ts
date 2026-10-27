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
  | { source: 'rn-canvas'; type: 'error'; story: string; message: string }
  /** Navigation demandée par l'écran (ignorée : l'écran reste affiché seul). */
  | { source: 'rn-canvas'; type: 'navigate'; story: string; action: string; href: string | null }
  /** Appel réseau coupé dans le canevas (`network: 'offline'`, par défaut) : `count` depuis le chargement. */
  | { source: 'rn-canvas'; type: 'network-blocked'; story: string; url: string; count: number }
  /** Glisser-déposer sur l'écran : déplacer un élément, ou déposer le composant glissé depuis l'éditeur. */
  | { source: 'rn-canvas'; type: 'drop'; story: string; kind: 'move' | 'component'; from: { loc: Loc; name: string } | null; target: { loc: Loc; name: string }; position: InsertPosition }
  | { source: 'rn-canvas'; type: 'snapshot'; story: string; requestId: number; storage: Record<string, string> }
  | { source: 'rn-canvas'; type: 'measured'; story: string; requestId: number; rects: Record<Loc, Rect>; viewport: { width: number; height: number } }
  /** Clic droit sur l'élément sélectionné (x, y dans l'écran) : l'éditeur ouvre son menu. */
  | { source: 'rn-canvas'; type: 'contextmenu'; story: string; x: number; y: number }
  /** ⌘/Ctrl + molette au-dessus de l'écran (zoom du canevas) ; x, y dans l'écran. */
  | { source: 'rn-canvas'; type: 'wheel'; story: string; deltaX: number; deltaY: number; x: number; y: number; metaKey: boolean; ctrlKey: boolean }
  /** Raccourci clavier tapé pendant que le focus est dans l'écran (relayé à l'éditeur). */
  | { source: 'rn-canvas'; type: 'key'; story: string; key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
  /** Cadre des aperçus de la bibliothèque prêt à recevoir sa liste (`gallery`). */
  | { source: 'rn-canvas'; type: 'gallery-ready'; story: string }
  /** Clic sur un aperçu : composant à insérer (`fichier#Nom`). */
  | { source: 'rn-canvas'; type: 'pick'; story: string; key: string }
  /** « Ouvrir en grand » sur la vignette d'une modale : écran dédié dans le canevas. */
  | { source: 'rn-canvas'; type: 'open'; story: string; key: string }
  /** Poignée relâchée sur l'élément sélectionné : style à écrire (`value` en px, ou null pour retirer). */
  | { source: 'rn-canvas'; type: 'style-drag'; story: string; loc: Loc; key: string; value: number }
  /** Texte modifié sur place (double-clic sur un texte sélectionné). */
  | { source: 'rn-canvas'; type: 'text-edit'; story: string; loc: Loc; value: string }
  /** Position de l'élément sélectionné dans l'écran, à chaque changement (barre d'outils de l'éditeur). */
  | { source: 'rn-canvas'; type: 'selection-rect'; story: string; loc: Loc; rect: Rect | null };

/** Composant à prévisualiser dans le cadre des aperçus. */
export interface GalleryItem {
  /** `fichier#Nom`, clé du manifeste. */
  key: string;
  name: string;
  props: { name: string; type: 'string' | 'number' | 'boolean' | 'function' | 'array' | 'unknown' }[];
}

/** Paramètre d'URL qui affiche les aperçus de la bibliothèque au lieu d'un écran. */
export const GALLERY_PARAM = 'rnc-gallery';

export type CanvasMode = 'inspect' | 'interact';

/** Retire `source` de chaque membre d'une union de messages. */
export type Payload<T> = T extends unknown ? Omit<T, 'source'> : never;

/** Messages éditeur → runtime. */
export type EditorMessage =
  | { source: 'rn-canvas-editor'; type: 'mode'; mode: CanvasMode }
  /** `name` : nom attendu ; tant que l'écran affiche autre chose à cet emplacement (Fast Refresh en cours), la sélection attend. */
  | { source: 'rn-canvas-editor'; type: 'select'; loc: Loc | null; name?: string }
  | { source: 'rn-canvas-editor'; type: 'hover'; loc: Loc | null }
  /** Demande le contenu du stockage de l'écran (pour l'enregistrer comme variante). */
  | { source: 'rn-canvas-editor'; type: 'snapshot'; requestId: number }
  /** Position des éléments donnés (mode Flux) : réponse `measured`, éléments visibles seulement. */
  | { source: 'rn-canvas-editor'; type: 'measure'; requestId: number; locs: Loc[] }
  /** Composants à afficher dans le cadre des aperçus. */
  | { source: 'rn-canvas-editor'; type: 'gallery'; items: GalleryItem[] }
  /** Poignées affichées sur l'élément sélectionné (selon ce que le code permet d'écrire). */
  | { source: 'rn-canvas-editor'; type: 'handles'; loc: Loc; handles: HandleSet }
  /** Fin de l'écriture d'un style tiré à la souris : l'aperçu en direct peut être retiré. */
  | { source: 'rn-canvas-editor'; type: 'style-applied'; ok: boolean };

/** Poignées disponibles sur l'élément sélectionné. */
export interface HandleSet {
  radius: boolean;
  padding: boolean;
  margin: boolean;
  /** Espacement entre enfants (conteneur flex avec au moins deux enfants). */
  gap: boolean;
  /** Largeur / hauteur : seulement si elles sont déjà écrites (sinon l'élément garderait une taille figée). */
  width: boolean;
  height: boolean;
  /** Texte modifiable sur place (double-clic). */
  text: boolean;
}

/** Lien de navigation lu dans le code (mode Flux). */
export interface FlowLink {
  /** Fichier où se trouve l'appel. */
  file: string;
  /** Élément déclencheur (bouton, lien…) ; null : navigation de l'écran lui-même (effet, redirection). */
  loc: Loc | null;
  name: string | null;
  /** Texte de l'élément, pour l'affichage. */
  label?: string;
  /** `push`, `replace`, `navigate`, `link`, `redirect`… */
  action: string;
  /** Cible telle qu'écrite (`/invoice/:param` pour un gabarit). */
  href: string;
  /** Écran de destination (fichier de route), s'il est trouvé. */
  route: string | null;
  /** Stories qui affichent l'écran de destination. */
  targets: string[];
  /** Pour `loc` null : stories qui affichent l'écran d'où part la navigation. */
  sources: string[];
}

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

/** D'où vient un nom utilisé dans une expression (`colors` → useTheme(), `color` → prop…). */
export interface ValueOrigin {
  name: string;
  kind: 'prop' | 'hook' | 'import' | 'module' | 'local' | 'param' | 'unknown';
  /** Explication lisible : « useTheme() », « import de '../theme' », « prop de AppText »… */
  detail: string;
  line: number | null;
}

export interface SourceValue {
  kind: ValueKind;
  /** Valeur littérale si `kind` n'est pas `expression`. */
  value?: string | number | boolean | null;
  /** Code source de l'expression (toujours présent). */
  code: string;
  /** Pour une expression : l'origine de chaque nom qu'elle utilise. */
  origins?: ValueOrigin[];
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
  /** Pour une source `unknown` : l'origine des noms de son expression. */
  origins?: ValueOrigin[];
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
  /** Code JSX de l'élément (pour le copier). */
  source: string;
  /** Fond dégradé (`<LinearGradient colors={…}>`) : l'élément lui-même ou son calque de fond. */
  gradient: GradientInfo | null;
}

export type GradientDirection = 'vertical' | 'horizontal' | 'diagonal' | 'diagonal-up' | 'custom';

export interface GradientInfo {
  /** Élément `LinearGradient` à modifier. */
  loc: Loc;
  name: string;
  /** false : calque de fond (enfant) de l'élément inspecté. */
  own: boolean;
  /** Couleurs, dans l'ordre ; null si le tableau est calculé (lecture seule). */
  stops: SourceValue[] | null;
  colorsCode: string;
  direction: GradientDirection;
}

export type EditValue =
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'expression'; code: string }
  | { kind: 'remove' };

export type StyleTarget = { kind: 'instance' } | { kind: 'stylesheet'; ref: string };

export type EditRequest =
  | { op: 'setStyle'; loc: Loc; name: string; key: string; value: EditValue; target: StyleTarget }
  /** Plusieurs propriétés en une seule modification (une seule étape d'annulation). */
  | { op: 'setStyles'; loc: Loc; name: string; entries: { key: string; value: EditValue }[]; target: StyleTarget }
  | { op: 'setText'; loc: Loc; name: string; value: string }
  | { op: 'setProp'; loc: Loc; name: string; prop: string; value: EditValue }
  | { op: 'setToken'; path: string; value: EditValue }
  | { op: 'remove'; loc: Loc; name: string }
  | { op: 'duplicate'; loc: Loc; name: string }
  | { op: 'move'; loc: Loc; name: string; target: Loc; targetName: string; position: InsertPosition }
  | { op: 'insert'; loc: Loc; name: string; position: InsertPosition; component: { name: string; file: string | null } }
  /** Ajoute une variante à un fichier canvas, à partir d'une variante existante et d'un stockage capturé. */
  | { op: 'addStory'; file: string; base: string; exportName: string; storage: Record<string, string> };

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

export interface HistoryState {
  /** Libellé de la prochaine modification annulable / rétablissable. */
  undo: string | null;
  redo: string | null;
}

export interface EditResult {
  ok: true;
  file: string;
  history: HistoryState;
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
  /** Nom sous lequel les composants accèdent au thème, s'il diffère de l'export (ex. `colors`). */
  alias: string | null;
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

// ---- Pages, parcours, groupes et notes (fichier canvas/parcours.json) ----

export interface BoardPoint {
  x: number;
  y: number;
}

/** Cadre de couleur titré : les écrans et notes dont le centre est dedans en font partie. */
export interface BoardGroup {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardNote {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  color: string;
}

/**
 * Une page du canevas. La vue d'ensemble (`stories: null`) montre tous les écrans ; un parcours en
 * reprend une sélection, avec sa propre disposition, sans rien changer à la vue d'ensemble.
 */
export interface BoardPage {
  id: string;
  name: string;
  stories: string[] | null;
  positions: Record<string, BoardPoint>;
  groups: BoardGroup[];
  notes: BoardNote[];
}

export interface Board {
  version: 1;
  pages: BoardPage[];
}

export const OVERVIEW_PAGE = 'overview';

export function emptyBoard(): Board {
  return { version: 1, pages: [{ id: OVERVIEW_PAGE, name: "Vue d'ensemble", stories: null, positions: {}, groups: [], notes: [] }] };
}

const finite = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback);
const text = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Remet en forme un plan lu dans un fichier ou reçu de l'éditeur (champs manquants, types, tailles). */
export function normalizeBoard(input: unknown): Board {
  const pages = list(record(input).pages).slice(0, 200).map((raw): BoardPage => {
    const p = record(raw);
    const positions: Record<string, BoardPoint> = {};
    for (const [id, point] of Object.entries(record(p.positions))) positions[id.slice(0, 500)] = { x: finite(record(point).x), y: finite(record(point).y) };
    return {
      id: text(p.id, 64) || Math.random().toString(36).slice(2, 10),
      name: text(p.name, 120, 'Parcours'),
      stories: p.stories === null || p.stories === undefined ? null : list(p.stories).filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 500)),
      positions,
      groups: list(p.groups).slice(0, 500).map((g) => {
        const r = record(g);
        return { id: text(r.id, 64) || Math.random().toString(36).slice(2, 10), name: text(r.name, 120, 'Groupe'), color: text(r.color, 32, 'violet'), x: finite(r.x), y: finite(r.y), width: Math.max(200, finite(r.width, 900)), height: Math.max(120, finite(r.height, 1000)) };
      }),
      notes: list(p.notes).slice(0, 1000).map((n) => {
        const r = record(n);
        return { id: text(r.id, 64) || Math.random().toString(36).slice(2, 10), text: text(r.text, 5000), x: finite(r.x), y: finite(r.y), width: Math.max(120, finite(r.width, 280)), color: text(r.color, 32, 'yellow') };
      }),
    };
  });
  const overview = pages.find((p) => p.id === OVERVIEW_PAGE);
  if (overview) overview.stories = null;
  else pages.unshift(emptyBoard().pages[0]);
  return { version: 1, pages: [pages.find((p) => p.id === OVERVIEW_PAGE)!, ...pages.filter((p) => p.id !== OVERVIEW_PAGE)] };
}
