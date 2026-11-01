import type { EditValue, InspectResult, StyleTarget } from '../shared/protocol.ts';
import { styleEntries } from './styleModel.ts';
import { parseInput } from './values.ts';

export const SHADOW_KEYS = ['shadowColor', 'shadowOffset', 'shadowOpacity', 'shadowRadius', 'elevation'];

/** Ombres toutes faites : iOS (shadow*), Android (elevation) ; le web les dessine aussi. */
export const SHADOWS: { value: string; label: string; style: Record<string, string> | null }[] = [
  { value: 'none', label: 'Aucune', style: null },
  { value: 'soft', label: 'Douce', style: { shadowColor: "'#000000'", shadowOffset: '{ width: 0, height: 2 }', shadowOpacity: '0.06', shadowRadius: '8', elevation: '2' } },
  { value: 'medium', label: 'Moyenne', style: { shadowColor: "'#000000'", shadowOffset: '{ width: 0, height: 4 }', shadowOpacity: '0.1', shadowRadius: '14', elevation: '4' } },
  { value: 'strong', label: 'Forte', style: { shadowColor: "'#000000'", shadowOffset: '{ width: 0, height: 10 }', shadowOpacity: '0.18', shadowRadius: '24', elevation: '8' } },
];

/** Préréglage d'ombre reconnu dans les styles écrits ; `custom` si une ombre ne correspond à aucun. */
export function shadowPreset(written: (key: string) => string, has: (key: string) => boolean): string {
  return SHADOWS.find((sh) => sh.style && written('shadowRadius') === sh.style.shadowRadius)?.value ?? (has('shadowRadius') || has('elevation') ? 'custom' : 'none');
}

/** Toutes les propriétés d'ombre du préréglage d'un coup (shadowOffset est un objet : écrit tel quel). */
export function shadowEntries(inspect: InspectResult, target: StyleTarget, value: string): { key: string; value: EditValue }[] {
  const preset = SHADOWS.find((sh) => sh.value === value);
  if (!preset) return [];
  const valueOf = (key: string, raw: string): EditValue => (key === 'shadowOffset' ? { kind: 'expression', code: raw } : parseInput(raw, inspect.scope, { style: true }));
  return SHADOW_KEYS.flatMap((key) => styleEntries(inspect, target, key, preset.style ? valueOf(key, preset.style[key]) : { kind: 'remove' }));
}
