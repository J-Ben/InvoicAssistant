import { useEffect, useRef, useState } from 'react';

/** Éléments de l'éditeur qu'on peut masquer pour laisser la place aux écrans. */
export interface Display {
  leftPanel: boolean;
  rightPanel: boolean;
  libraryBar: boolean;
  palette: boolean;
  handles: boolean;
  pagesBar: boolean;
  boardTools: boolean;
  storyLabels: boolean;
}

const DEFAULTS: Display = { leftPanel: true, rightPanel: true, libraryBar: true, palette: true, handles: true, pagesBar: true, boardTools: true, storyLabels: true };

const LABELS: [keyof Display, string, string?][] = [
  ['leftPanel', 'Panneau de gauche', 'Écrans, calques, composants, thème'],
  ['rightPanel', 'Inspecteur (droite)'],
  ['palette', 'Palette à côté de la sélection'],
  ['handles', 'Poignées sur l’élément', 'Rayon, marges, espacement, taille'],
  ['libraryBar', 'Barre des composants (bas)'],
  ['pagesBar', 'Pages et parcours'],
  ['boardTools', 'Outils Groupe / Note'],
  ['storyLabels', 'Noms des écrans'],
];

const KEY = 'rn-canvas:display';

export function useDisplay(): [Display, (key: keyof Display, value: boolean) => void, () => void] {
  const [display, setDisplay] = useState<Display>(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    } catch {
      return DEFAULTS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(display));
    } catch {
      // Stockage indisponible : le choix vaut pour la session.
    }
  }, [display]);
  return [display, (key, value) => setDisplay((d) => ({ ...d, [key]: value })), () => setDisplay(DEFAULTS)];
}

/** Bouton « Affichage » de la barre du haut : cases à cocher, fermeture au clic ailleurs ou Échap. */
export function DisplayMenu({ display, onChange, onReset }: { display: Display; onChange: (key: keyof Display, value: boolean) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [open]);
  const hidden = LABELS.filter(([key]) => !display[key]).length;
  return (
    <div className="display-menu" ref={ref}>
      <button className={open ? 'on' : ''} aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Choisir ce qui est affiché (⌘\ : masquer / afficher les panneaux)">
        ◫ Affichage{hidden ? <span className="muted"> · {hidden} masqué{hidden > 1 ? 's' : ''}</span> : null}
      </button>
      {open && (
        <div className="display-popover" role="menu">
          {LABELS.map(([key, label, hint]) => (
            <label key={key} className="display-option">
              <input type="checkbox" checked={display[key]} onChange={(e) => onChange(key, e.target.checked)} />
              <span>
                {label}
                {hint && <span className="muted small"> — {hint}</span>}
              </span>
            </label>
          ))}
          <button className="link-button" onClick={onReset}>
            Tout réafficher
          </button>
        </div>
      )}
    </div>
  );
}
