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
