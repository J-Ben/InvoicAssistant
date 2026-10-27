/**
 * Lecture des styles d'un élément inspecté, commune au panneau de droite et à la barre flottante :
 * valeurs écrites (par source), source à modifier, jetons du thème accessibles dans le fichier.
 */
import type { EditValue, InspectResult, SourceValue, StyleSource, StyleTarget, ThemeInfo } from '../shared/protocol.ts';
import { displayValue, toHex } from './values.ts';

export interface Token {
  path: string;
  value: string;
  hex: string | null;
}

/** Source modifiée par défaut : le style propre à l'élément (utilisé une fois), sinon l'élément lui-même. */
export function defaultTarget(sources: StyleSource[]): StyleTarget {
  const own = [...sources].reverse().find((s) => s.kind === 'stylesheet' && s.usages === 1);
  return own ? { kind: 'stylesheet', ref: own.ref } : { kind: 'instance' };
}

/** Jetons utilisables ici, sous le nom par lequel ce fichier y accède (export ou alias du thème). */
export function tokensFor(theme: ThemeInfo | null, scope: string[]): Token[] {
  if (!theme) return [];
  const names = [theme.exportName, theme.alias].filter((n): n is string => Boolean(n) && scope.includes(n!));
  const via = names.includes(theme.alias ?? '') ? theme.alias! : names[0];
  if (!via) return [];
  return theme.tokens.map((t) => {
    const value = displayValue(t.value);
    return { path: `${via}.${t.path.split('.').slice(1).join('.')}`, value, hex: toHex(value) };
  });
}

/** Valeur effective écrite (la dernière source l'emporte) et source d'origine de chaque clé. */
export function mergedStyle(sources: StyleSource[]): Map<string, { value: SourceValue; from: string }> {
  const merged = new Map<string, { value: SourceValue; from: string }>();
  for (const s of sources) for (const p of s.properties) if (!p.key.startsWith('...')) merged.set(p.key, { value: p.value, from: s.ref });
  return merged;
}

export function targetSourceOf(sources: StyleSource[], target: StyleTarget): StyleSource | undefined {
  return sources.find((s) => (target.kind === 'instance' ? s.kind === 'inline' && s === sources[sources.length - 1] : s.ref === target.ref));
}

/** Propriétés plus précises qu'un raccourci : elles l'emportent sur lui quelle que soit leur place. */
const SPECIFIC: Record<string, string[]> = {
  padding: ['paddingVertical', 'paddingHorizontal', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  paddingVertical: ['paddingTop', 'paddingBottom'],
  paddingHorizontal: ['paddingLeft', 'paddingRight'],
  margin: ['marginVertical', 'marginHorizontal', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  marginVertical: ['marginTop', 'marginBottom'],
  marginHorizontal: ['marginLeft', 'marginRight'],
  borderRadius: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'],
  gap: ['rowGap', 'columnGap'],
};

/**
 * Propriétés à écrire pour donner `value` à `key` : les variantes plus précises déjà écrites sont
 * retirées de la source modifiée, ou alignées si elles viennent d'une autre source (elles
 * masqueraient sinon la nouvelle valeur).
 */
export function styleEntries(inspect: InspectResult, target: StyleTarget, key: string, value: EditValue): { key: string; value: EditValue }[] {
  const sources = inspect.style.sources;
  const merged = mergedStyle(sources);
  const own = new Set(targetSourceOf(sources, target)?.properties.map((p) => p.key));
  const entries = [{ key, value }];
  for (const specific of SPECIFIC[key] ?? []) {
    if (own.has(specific)) entries.push({ key: specific, value: { kind: 'remove' } });
    else if (merged.has(specific) && value.kind !== 'remove') entries.push({ key: specific, value });
  }
  return entries;
}
