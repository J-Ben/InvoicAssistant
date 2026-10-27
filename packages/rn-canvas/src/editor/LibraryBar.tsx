import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentEntry } from '../shared/protocol.ts';
import { endComponentDrag, startComponentDrag } from './Sidebar.tsx';

/** Outils rapides : le composant du projet s'il existe (AppText, Button…), sinon la primitive React Native. */
const QUICK: { label: string; icon: string; prefer: string[]; fallback: string }[] = [
  { label: 'Texte', icon: 'T', prefer: ['AppText', 'Typography', 'ThemedText'], fallback: 'Text' },
  { label: 'Bouton', icon: '▭', prefer: ['Button', 'AppButton', 'PrimaryButton'], fallback: 'Pressable' },
  { label: 'Champ', icon: '⌨', prefer: ['Input', 'TextField', 'AppInput', 'ThemedTextInput'], fallback: 'TextInput' },
  { label: 'Conteneur', icon: '◻', prefer: [], fallback: 'View' },
];

/** Dossiers de l'atomic design d'abord, le reste du projet ensuite. */
const GROUPS: { key: string; label: string }[] = [
  { key: 'atoms', label: 'Atomes' },
  { key: 'molecules', label: 'Molécules' },
  { key: 'organisms', label: 'Organismes' },
];

interface Props {
  components: ComponentEntry[];
  /** Où le composant sera inséré (affiché en info-bulle) ; null : rien de sélectionné ni d'écran actif. */
  target: string | null;
  onInsert: (component: ComponentEntry) => void;
}

/** Barre flottante en bas du canevas : ajouter du texte, un bouton… ou un composant de la bibliothèque. */
export function LibraryBar({ components, target, onInsert }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const quick = useMemo(
    () =>
      QUICK.map((q) => ({
        ...q,
        component: q.prefer.map((name) => components.find((c) => c.file && c.name === name)).find(Boolean) ?? components.find((c) => !c.file && c.name === q.fallback),
      })).filter((q) => q.component),
    [components],
  );

  const groups = useMemo(() => {
    const project = components.filter((c) => c.file);
    const known = GROUPS.map((g) => ({ ...g, items: project.filter((c) => c.group === g.key) })).filter((g) => g.items.length > 0);
    const others = project.filter((c) => !GROUPS.some((g) => g.key === c.group));
    return others.length ? [...known, { key: '*', label: 'Autres', items: others }] : known;
  }, [components]);

  // Fermeture au clic ailleurs ou avec Échap.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [open]);

  const disabled = target === null;
  const hint = disabled ? "Cliquez d'abord sur un écran ou un élément" : `Insérer ${target}`;
  const insert = (c: ComponentEntry) => {
    if (disabled) return;
    setOpen(null);
    onInsert(c);
  };
  const current = groups.find((g) => g.key === open);
  const items = current?.items.filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase())) ?? [];

  return (
    <div className="library-bar" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      {quick.map((q) => (
        <button
          key={q.label}
          className="library-tool"
          draggable
          onDragStart={(e) => startComponentDrag(e, q.component!)}
          onDragEnd={endComponentDrag}
          onClick={() => insert(q.component!)}
          aria-disabled={disabled}
          title={`${q.label} : <${q.component!.name}> · ${hint} (ou glissez-le sur un écran)`}
        >
          <span className="library-icon">{q.icon}</span>
          {q.label}
        </button>
      ))}
      {groups.length > 0 && <span className="library-separator" />}
      {groups.map((g) => (
        <button
          key={g.key}
          className={`library-tool ${open === g.key ? 'on' : ''}`}
          aria-expanded={open === g.key}
          onClick={() => {
            setQuery('');
            setOpen(open === g.key ? null : g.key);
          }}
        >
          {g.label} <span className="muted">{g.items.length}</span> ▴
        </button>
      ))}
      {current && (
        <div className="library-popover" role="menu">
          <input className="search" autoFocus placeholder={`Rechercher dans ${current.label.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          <p className="hint small">{disabled ? "Cliquez d'abord sur un écran ou un élément, ou glissez un composant sur un écran." : `Clic : ${hint.toLowerCase()} · ou glissez-le sur un écran.`}</p>
          <div className="library-items">
            {items.map((c) => (
              <button
                key={`${c.file}:${c.name}`}
                className="component-item"
                role="menuitem"
                draggable
                aria-disabled={disabled}
                onDragStart={(e) => startComponentDrag(e, c)}
                onDragEnd={endComponentDrag}
                onClick={() => insert(c)}
                title={c.file ?? 'react-native'}
              >
                <span className="component">◇ {c.name}</span>
                {c.props.length > 0 && <span className="muted small">{c.props.map((p) => p.name).join(', ')}</span>}
              </button>
            ))}
            {items.length === 0 && <p className="hint small">Aucun composant.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
