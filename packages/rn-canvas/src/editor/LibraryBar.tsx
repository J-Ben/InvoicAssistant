import { useMemo } from 'react';
import type { ComponentEntry, SnippetRequest } from '../shared/protocol.ts';
import { Bricks } from './Bricks.tsx';
import { endComponentDrag, startComponentDrag } from './Sidebar.tsx';

/** Outils rapides : le composant du projet s'il existe (AppText, Button…), sinon la primitive React Native. */
const QUICK: { label: string; icon: string; prefer: string[]; fallback: string }[] = [
  { label: 'Texte', icon: 'T', prefer: ['AppText', 'Typography', 'ThemedText'], fallback: 'Text' },
  { label: 'Bouton', icon: '▭', prefer: ['Button', 'AppButton', 'PrimaryButton'], fallback: 'Pressable' },
  { label: 'Champ', icon: '⌨', prefer: ['Input', 'TextField', 'AppInput', 'ThemedTextInput'], fallback: 'TextInput' },
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
  /** Brique de l'éditeur (forme, image, icône, interrupteur, mise en page). */
  onInsertSnippet: (snippet: SnippetRequest) => void;
  /** Bibliothèque complète (liste et aperçus) : onglet Composants du panneau de gauche. */
  onShowComponents: () => void;
}

/**
 * Barre flottante en bas du canevas : ajouter du texte, un bouton, une brique. La bibliothèque elle-même
 * s'ouvre dans le panneau de gauche, pour ne pas recouvrir les écrans.
 */
export function LibraryBar({ components, target, onInsert, onInsertSnippet, onShowComponents }: Props) {
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

  const disabled = target === null;
  const hint = disabled ? "Cliquez d'abord sur un écran ou un élément" : `Insérer ${target}`;
  const insert = (c: ComponentEntry) => {
    if (!disabled) onInsert(c);
  };

  return (
    <div className="library-bar" onPointerDown={(e) => e.stopPropagation()}>
      {quick.map((q) => (
        <button
          key={q.label}
          className="library-tool quick"
          aria-label={q.label}
          draggable
          onDragStart={(e) => startComponentDrag(e, q.component!)}
          onDragEnd={endComponentDrag}
          onClick={() => insert(q.component!)}
          aria-disabled={disabled}
          title={`${q.label} : <${q.component!.name}> · ${hint} (ou glissez-le sur un écran)`}
        >
          <span className="library-icon">{q.icon}</span>
          <span className="library-label">{q.label}</span>
        </button>
      ))}
      {/* Formes, images, icônes… : une View vide ne se voit pas (taille nulle), ces briques ont déjà une taille. */}
      <Bricks disabled={disabled} hint={hint} onInsert={onInsertSnippet} />
      {groups.length > 0 && <span className="library-separator" />}
      {groups.length > 0 && (
        <button className="library-tool" onClick={onShowComponents} title={`Bibliothèque : ${groups.map((g) => `${g.items.length} ${g.label.toLowerCase()}`).join(', ')} (panneau de gauche, onglet Composants)`}>
          ◇ Composants <span className="muted">{groups.reduce((n, g) => n + g.items.length, 0)}</span>
        </button>
      )}
    </div>
  );
}
