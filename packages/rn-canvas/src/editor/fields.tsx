import { useEffect, useRef, useState } from 'react';

/** Champ texte qui n'écrit qu'à la validation (Entrée ou perte du focus) ; Maj+Entrée = retour à la ligne, Échap annule. */
export function CommitInput({
  value,
  onCommit,
  placeholder,
  disabled,
  multiline,
  list,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
  list?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    } else if (e.key === 'Escape') {
      setDraft(value);
      requestAnimationFrame(() => (e.target as HTMLElement).blur());
    }
  };

  if (multiline) {
    return (
      <textarea
        className={className}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 32)))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    );
  }
  return (
    <input
      className={className}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      list={list}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}

/** Pastille de couleur : écrit à la fermeture du sélecteur (événement natif `change`), pas à chaque mouvement. */
export function ColorInput({ value, onCommit, disabled }: { value: string; onCommit: (value: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => el.value.toLowerCase() !== value.toLowerCase() && commit.current(el.value.toUpperCase());
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, [value]);
  return <input ref={ref} type="color" className="swatch" value={draft} disabled={disabled} onChange={(e) => setDraft(e.target.value)} />;
}

const DECIMALS = 1000;

/** `16px` / `16` / `0.5` → nombre ; null si la valeur n'est pas numérique (jeton, auto…). */
export function numberOf(text: string | undefined | null): number | null {
  if (text == null) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)(px)?\s*$/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Champ numérique : saisie libre (un jeton comme `spacing.md` reste possible), flèches ↑/↓ et
 * ⌘/Ctrl + molette pour faire varier la valeur — Maj : ×10, Alt : ×0,1. La valeur s'affiche tout
 * de suite et n'est écrite dans le code qu'une fois le réglage terminé.
 */
export function NumberField({
  value,
  fallback,
  step = 1,
  min,
  onCommit,
  placeholder,
  className,
}: {
  value: string;
  /** Valeur effective (calculée) dont on part si le champ est vide. */
  fallback?: string;
  step?: number;
  min?: number;
  onCommit: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const state = useRef({ draft: value, value, timer: 0 });
  state.current.value = value;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    setDraft(value);
    state.current.draft = value;
  }, [value]);

  const update = (next: string) => {
    state.current.draft = next;
    setDraft(next);
  };
  const flush = () => {
    window.clearTimeout(state.current.timer);
    if (state.current.draft !== state.current.value) commitRef.current(state.current.draft);
  };
  const nudge = (direction: 1 | -1, event: { shiftKey: boolean; altKey: boolean }) => {
    const base = numberOf(state.current.draft) ?? numberOf(fallback) ?? 0;
    const delta = step * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1) * direction;
    let next = Math.round((base + delta) * DECIMALS) / DECIMALS;
    if (min !== undefined) next = Math.max(min, next);
    update(String(next));
    window.clearTimeout(state.current.timer);
    state.current.timer = window.setTimeout(flush, 450);
  };

  // La molette doit être interceptée avec un écouteur non passif pour empêcher le défilement.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.deltaY === 0) return;
      e.preventDefault();
      nudge(e.deltaY < 0 ? 1 : -1, e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  useEffect(() => () => window.clearTimeout(state.current.timer), []);

  return (
    <input
      ref={ref}
      className={`number-field ${className ?? ''}`}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      title="⌘/Ctrl + molette ou ↑/↓ pour ajuster (Maj ×10, Alt ×0,1)"
      onChange={(e) => update(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          nudge(e.key === 'ArrowUp' ? 1 : -1, e);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          flush();
        } else if (e.key === 'Escape') {
          window.clearTimeout(state.current.timer);
          update(value);
          requestAnimationFrame(() => (e.target as HTMLElement).blur());
        }
      }}
    />
  );
}

export interface Choice {
  value: string;
  label: string;
  /** Libellé court pour les boutons segmentés. */
  short?: string;
}

/** Liste déroulante ; une valeur absente des choix (jeton, expression) reste affichée. */
export function SelectField({ value, choices, placeholder, onCommit }: { value: string; choices: Choice[]; placeholder?: string; onCommit: (value: string) => void }) {
  const known = value === '' || choices.some((c) => c.value === value);
  return (
    <select className="select-field" value={value} onChange={(e) => e.target.value !== value && onCommit(e.target.value)}>
      <option value="">{placeholder ? `— ${placeholder}` : '—'}</option>
      {!known && <option value={value}>{value}</option>}
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

/** Boutons segmentés pour les petites listes ; recliquer la valeur active la retire. */
export function SegmentedField({ value, choices, effective, onCommit }: { value: string; choices: Choice[]; effective?: string; onCommit: (value: string) => void }) {
  return (
    <div className="segmented-field" role="radiogroup">
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          className={value === c.value ? 'on' : !value && effective === c.value ? 'effective' : ''}
          title={c.label}
          onClick={() => onCommit(value === c.value ? '' : c.value)}
        >
          {c.short ?? c.label}
        </button>
      ))}
    </div>
  );
}

/** Sélecteur de jeton du thème (couleurs) affiché à côté d'un champ. */
export function TokenPicker({ tokens, value, onPick }: { tokens: { path: string; value: string; hex: string | null }[]; value: string; onPick: (path: string) => void }) {
  if (tokens.length === 0) return null;
  return (
    // Toujours affiché « ◆ » : le jeton courant est déjà visible dans le champ à côté.
    <select className="token-picker" value="" onChange={(e) => e.target.value && e.target.value !== value && onPick(e.target.value)} title="Choisir un jeton du thème">
      <option value="">◆</option>
      {tokens.map((t) => (
        <option key={t.path} value={t.path}>
          {t.path.split('.').slice(1).join('.')} · {t.value}
        </option>
      ))}
    </select>
  );
}
