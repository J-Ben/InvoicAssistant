import type { EditValue, SourceValue } from '../shared/protocol.ts';

const MEMBER_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/;

/** Ce que l'utilisateur tape → valeur d'édition. `colors.primary` devient un jeton s'il est en portée. */
export function parseInput(raw: string, scope: string[]): EditValue {
  const text = raw.trim();
  if (text === '') return { kind: 'remove' };
  if (/^-?\d+(\.\d+)?$/.test(text)) return { kind: 'literal', value: Number(text) };
  if (text === 'true' || text === 'false') return { kind: 'literal', value: text === 'true' };
  if (MEMBER_PATH.test(text) && scope.includes(text.split('.')[0])) return { kind: 'expression', code: text };
  const quoted = /^(['"])(.*)\1$/.exec(text);
  return { kind: 'literal', value: quoted ? quoted[2] : text };
}

/** Valeur du code → texte affiché dans un champ. */
export function displayValue(value: SourceValue | null | undefined): string {
  if (!value) return '';
  if (value.kind === 'expression') return value.code;
  if (value.kind === 'null') return 'null';
  return String(value.value);
}

export function isToken(value: SourceValue | null | undefined): boolean {
  return value?.kind === 'expression' && MEMBER_PATH.test(value.code);
}

/** `rgb(198, 124, 78)` / `#abc` → `#rrggbb` pour un `<input type="color">`. */
export function toHex(color: string | undefined | null): string | null {
  if (!color) return null;
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join('')}`.toLowerCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (m) return `#${m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return null;
}

export function isColorKey(key: string): boolean {
  return /color$/i.test(key) || key === 'tintColor';
}
