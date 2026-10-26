/**
 * Liens de navigation lus dans le code : quel élément (bouton, lien…) mène à quelle route.
 *
 * Reconnu : `router.push / replace / navigate / dismissTo(cible)` (tout objet dont le nom contient
 * « router » ou « navigation »), `<Link href=…>`. La cible doit être lisible sans exécuter le code :
 * chaîne, gabarit (`/invoice/${id}` → `/invoice/:param`) ou `{ pathname: … }`.
 * L'élément déclencheur est l'élément JSX dont un `on…` contient l'appel, directement ou via une
 * fonction du même fichier (`onPress={handleCreate}`, `onPress={() => handleCreate()}`).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FlowLink } from '../shared/protocol.ts';
import { type AstNode, type SourceFile, jsxName, unwrap, walk } from './ast.ts';

const NAVIGATION_METHODS = new Set(['push', 'replace', 'navigate', 'dismissTo']);
const NAVIGATOR_OBJECT = /router|navigation/i;
const LINK_COMPONENTS = new Set(['Link', 'Redirect']);
export const PARAM = ':param';

type RawLink = Omit<FlowLink, 'route' | 'targets' | 'sources'>;

/** Cible lisible d'un appel de navigation, ou null si elle est calculée. */
export function hrefOf(node: AstNode | undefined): string | null {
  if (!node) return null;
  const n = unwrap(node);
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'TemplateLiteral') {
    return n.quasis.map((q: AstNode, i: number) => q.value.cooked + (i < n.expressions.length ? PARAM : '')).join('');
  }
  if (n.type === 'ObjectExpression') {
    const pathname = n.properties.find((p: AstNode) => p.type === 'ObjectProperty' && !p.computed && (p.key.name ?? p.key.value) === 'pathname');
    return pathname ? hrefOf(pathname.value) : null;
  }
  if (n.type === 'JSXExpressionContainer') return hrefOf(n.expression);
  return null;
}

/** Emplacement `fichier:ligne:colonne` d'un élément JSX (même format que le plugin Babel). */
const locOf = (file: string, element: AstNode) => `${file}:${element.loc.start.line}:${element.loc.start.column}`;

/** Nom de la fonction qui contient le nœud (`const handleX = () => …`, `function handleX()`, `useCallback`). */
function enclosingFunctionName(parents: AstNode[]): string | null {
  for (let i = parents.length - 1; i >= 0; i--) {
    const node = parents[i];
    if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression' && node.type !== 'FunctionDeclaration') continue;
    if (node.type === 'FunctionDeclaration') return node.id?.name ?? null;
    // Remonte les enveloppes (useCallback(fn, deps), parenthèses) jusqu'à la déclaration.
    for (let j = i - 1; j >= 0; j--) {
      const parent = parents[j];
      if (parent.type === 'VariableDeclarator') return parent.id.type === 'Identifier' ? parent.id.name : null;
      if (parent.type === 'CallExpression' || parent.type === 'TSAsExpression' || parent.type === 'ParenthesizedExpression') continue;
      break;
    }
    return null;
  }
  return null;
}

/** Élément JSX dont un attribut `on…` contient le nœud, s'il y en a un. */
function triggerElement(parents: AstNode[]): AstNode | null {
  for (let i = parents.length - 1; i >= 1; i--) {
    const node = parents[i];
    if (node.type === 'JSXAttribute' && /^on[A-Z]/.test(node.name?.name ?? '')) {
      const opening = parents[i - 1];
      const element = parents[i - 2];
      if (opening?.type === 'JSXOpeningElement' && element?.type === 'JSXElement') return element;
    }
    // Une fonction déclarée hors de tout JSX n'a pas de déclencheur direct.
    if (node.type === 'JSXElement') return null;
  }
  return null;
}

function labelOf(element: AstNode): string | undefined {
  const texts: string[] = [];
  walk(element, (node) => {
    if (node.type === 'JSXText' && node.value.trim()) texts.push(node.value.trim());
    if (node.type === 'JSXExpressionContainer' && unwrap(node.expression).type === 'StringLiteral') texts.push(unwrap(node.expression).value);
  });
  if (texts.length) return texts.join(' ').replace(/\s+/g, ' ').slice(0, 60);
  for (const attr of element.openingElement.attributes ?? []) {
    if (attr.type !== 'JSXAttribute' || !['title', 'label', 'accessibilityLabel'].includes(attr.name?.name) || !attr.value) continue;
    const value = unwrap(attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value);
    if (value.type === 'StringLiteral') return value.value;
  }
  return undefined;
}

/** Liens de navigation d'un fichier. `loc` null : navigation sans déclencheur (effet, redirection). */
export function navigationLinks(src: SourceFile, file: string): RawLink[] {
  const links: RawLink[] = [];
  const pendingByFunction = new Map<string, RawLink[]>();

  walk(src.ast, (node, parents) => {
    let action: string | null = null;
    let href: string | null = null;
    let trigger: AstNode | null = null;

    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed) {
      const method = node.callee.property.name;
      const object = node.callee.object;
      const objectName = object.type === 'Identifier' ? object.name : object.type === 'MemberExpression' ? object.property?.name : null;
      if (!NAVIGATION_METHODS.has(method) || !objectName || !NAVIGATOR_OBJECT.test(objectName)) return;
      action = method;
      href = hrefOf(node.arguments[0]);
      trigger = triggerElement(parents);
    } else if (node.type === 'JSXElement') {
      const name = jsxName(node.openingElement.name);
      if (!name || !LINK_COMPONENTS.has(name)) return;
      const hrefAttr = node.openingElement.attributes.find((a: AstNode) => a.type === 'JSXAttribute' && a.name?.name === 'href');
      if (!hrefAttr) return;
      action = name === 'Redirect' ? 'redirect' : 'link';
      href = hrefOf(hrefAttr.value);
      trigger = name === 'Link' ? node : null;
    } else {
      return;
    }
    if (href === null || action === null) return;

    const link: RawLink = { file, loc: trigger ? locOf(file, trigger) : null, name: trigger ? jsxName(trigger.openingElement.name) : null, label: trigger ? labelOf(trigger) : undefined, action, href };
    const fn = trigger ? null : enclosingFunctionName(parents);
    if (fn) {
      const list = pendingByFunction.get(fn) ?? [];
      list.push(link);
      pendingByFunction.set(fn, list);
    } else {
      links.push(link);
    }
  });

  if (pendingByFunction.size === 0) return links;

  // Fonctions qui naviguent : on cherche les éléments qui les appellent depuis un `on…`.
  const triggered = new Set<string>();
  walk(src.ast, (node, parents) => {
    if (node.type !== 'Identifier' || !pendingByFunction.has(node.name)) return;
    const parent = parents[parents.length - 1];
    if (parent?.type === 'VariableDeclarator' && parent.id === node) return;
    if (parent?.type === 'FunctionDeclaration' && parent.id === node) return;
    const element = triggerElement(parents);
    if (!element) return;
    const key = `${node.name}@${element.start}`;
    if (triggered.has(key)) return;
    triggered.add(key);
    for (const link of pendingByFunction.get(node.name)!) {
      links.push({ ...link, loc: locOf(file, element), name: jsxName(element.openingElement.name), label: labelOf(element) });
    }
  });
  // Fonctions jamais branchées sur un élément : navigation de l'écran lui-même.
  for (const [fn, pending] of pendingByFunction) {
    if (![...triggered].some((k) => k.startsWith(`${fn}@`))) links.push(...pending);
  }
  return links;
}

// ---- Routes (expo-router) ----

export interface Route {
  /** Fichier de l'écran, relatif au projet. */
  file: string;
  /** Segments du chemin public (`(groupe)` et `index` retirés) ; `:param` / `*` pour les segments dynamiques. */
  segments: string[];
}

const ROUTE_FILE = /\.(tsx|ts|jsx|js)$/;

/** Écrans du dossier de routes (`app/`), hors layouts et fichiers spéciaux. */
export function routesOf(root: string, routerRoot: string): Route[] {
  const base = path.join(root, routerRoot);
  const out: Route[] = [];
  const visit = (dir: string, segments: string[]) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const group = /^\(.+\)$/.test(entry.name);
        visit(path.join(dir, entry.name), group ? segments : [...segments, segmentOf(entry.name)]);
      } else if (ROUTE_FILE.test(entry.name)) {
        const name = entry.name.replace(ROUTE_FILE, '');
        if (name.startsWith('_') || name.startsWith('+')) continue;
        const file = path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/');
        out.push({ file, segments: name === 'index' ? segments : [...segments, segmentOf(name)] });
      }
    }
  };
  visit(base, []);
  return out;
}

function segmentOf(name: string): string {
  if (/^\[\.\.\..+\]$/.test(name)) return '*';
  if (/^\[.+\]$/.test(name)) return PARAM;
  return name;
}

/** Route correspondant à une cible (`/invoice/:param?mode=edit` → app/invoice/[id].tsx). */
export function matchRoute(href: string, routes: Route[]): Route | null {
  if (/^[a-z]+:/i.test(href) || href.startsWith('.')) return null;
  const pathname = href.split(/[?#]/)[0];
  const parts = pathname.split('/').filter((s) => s && !/^\(.+\)$/.test(s));
  let best: { route: Route; score: number } | null = null;
  for (const route of routes) {
    const score = matchScore(parts, route.segments);
    if (score !== null && (!best || score > best.score)) best = { route, score };
  }
  return best?.route ?? null;
}

/** Nombre de segments fixes en commun, ou null si la route ne correspond pas. */
function matchScore(parts: string[], segments: string[]): number | null {
  let score = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === '*') return i < parts.length ? score : null;
    const part = parts[i];
    if (part === undefined) return null;
    if (segment === PARAM) continue;
    if (part === PARAM || part !== segment) return null;
    score++;
  }
  return parts.length === segments.length ? score : null;
}

/** Fichier importé par un chemin relatif, résolu avec les extensions usuelles. */
export function resolveImport(root: string, fromFile: string, source: string): string | null {
  if (!source.startsWith('.')) return null;
  const base = path.resolve(root, path.dirname(fromFile), source);
  for (const candidate of [base, ...['.tsx', '.ts', '.jsx', '.js'].map((ext) => base + ext), ...['tsx', 'ts', 'jsx', 'js'].map((ext) => path.join(base, `index.${ext}`))]) {
    try {
      if (fs.statSync(candidate).isFile()) return path.relative(root, candidate).split(path.sep).join('/');
    } catch {
      // Candidat suivant.
    }
  }
  return null;
}

/** Fichiers importés par un fichier canvas (pour savoir quel écran il affiche). */
export function relativeImports(src: SourceFile): string[] {
  const out: string[] = [];
  for (const stmt of src.ast.program.body) {
    if (stmt.type === 'ImportDeclaration' && stmt.importKind !== 'type') out.push(stmt.source.value);
  }
  return out;
}
