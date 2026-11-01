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
  minimap: boolean;
  /** Écrans gardés chargés hors de la vue (0 : tous) ; au-delà, les moins récemment vus sont libérés. */
  keepLoaded: number;
  /**
   * Tous les écrans cochés se chargent (4 à la fois, les plus proches de la vue d'abord) et restent
   * chargés. Désactivé : seuls les écrans autour de la vue se chargent (gros projets).
   */
  loadAll: boolean;
  /**
   * Écrans en images : le serveur les capture en arrière-plan (Chrome sans fenêtre) et seul l'écran
   * sélectionné tourne en direct. Désactivé, ou sans moteur de captures : un écran = une app chargée.
   */
  snapshots: boolean;
}

type Toggle = Exclude<keyof Display, 'keepLoaded'>;
/** Réglages de chargement : pas comptés comme « masqués ». */
const LOADING: Toggle[] = ['loadAll', 'snapshots'];

/** Choix proposés : chaque écran chargé garde une copie de l'app en mémoire. */
const KEEP_CHOICES = [12, 24, 48, 0];

const DEFAULTS: Display = { leftPanel: true, rightPanel: false, libraryBar: true, palette: true, handles: true, pagesBar: true, boardTools: true, storyLabels: true, minimap: true, keepLoaded: 24, loadAll: false, snapshots: true };

const LABELS: [Toggle, string, string?][] = [
  ['leftPanel', 'Panneau de gauche', 'Écrans, calques, composants, thème'],
  ['rightPanel', 'Inspecteur (droite)'],
  ['palette', 'Palette à côté de la sélection'],
  ['handles', 'Poignées sur l’élément', 'Rayon, marges, espacement, taille'],
  ['libraryBar', 'Barre des composants (bas)'],
  ['pagesBar', 'Pages et parcours'],
  ['boardTools', 'Outils Groupe / Note'],
  ['storyLabels', 'Noms des écrans'],
  ['minimap', 'Minicarte', 'Tout le canevas en petit, en bas à droite : cliquer pour s’y déplacer'],
];

const SNAPSHOTS_LABEL: [Toggle, string, string] = ['snapshots', 'Écrans en images (recommandé)', 'Pris en arrière-plan ; seul l’écran sélectionné tourne en direct'];
const LOAD_ALL_LABEL: [Toggle, string, string] = ['loadAll', 'Charger tous les écrans', 'Sinon, seulement ceux autour de la vue : pour les projets à très nombreux écrans'];

const KEY = 'rn-canvas:display';

type SetDisplay = <K extends keyof Display>(key: K, value: Display[K]) => void;

export function useDisplay(): [Display, SetDisplay, () => void] {
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
export function DisplayMenu({ display, onChange, onReset, snapshotsAvailable }: { display: Display; onChange: SetDisplay; onReset: () => void; snapshotsAvailable: boolean }) {
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
  const hidden = LABELS.filter(([key]) => !LOADING.includes(key) && !display[key]).length;
  // Écrans chargés en direct (pas d'images) : les réglages de chargement s'appliquent.
  const direct = !display.snapshots || !snapshotsAvailable;
  const options = [...LABELS, ...(snapshotsAvailable ? [SNAPSHOTS_LABEL] : []), ...(direct ? [LOAD_ALL_LABEL] : [])];
  return (
    <div className="display-menu" ref={ref}>
      <button className={open ? 'on' : ''} aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`Affichage${hidden ? ` · ${hidden} masqué${hidden > 1 ? 's' : ''}` : ''} (⌘\\ : masquer / afficher les panneaux)`}
        aria-label="Affichage">
        ◫{hidden ? <span className="display-hidden" aria-label={`${hidden} masqué${hidden > 1 ? 's' : ''}`}>{hidden}</span> : null}
      </button>
      {open && (
        <div className="display-popover" role="menu">
          {options.map(([key, label, hint]) => (
            <label key={key} className="display-option">
              <input type="checkbox" checked={display[key]} onChange={(e) => onChange(key, e.target.checked)} />
              <span>
                {label}
                {hint && <span className="muted small"> — {hint}</span>}
              </span>
            </label>
          ))}
          {direct && !display.loadAll && <label className="display-option display-keep">
            <span>
              Écrans gardés chargés
              <span className="muted small"> — revenir sur un écran déjà chargé ne le recharge pas</span>
            </span>
            <select value={display.keepLoaded} onChange={(e) => onChange('keepLoaded', Number(e.target.value))}>
              {KEEP_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Tous' : n}
                </option>
              ))}
            </select>
          </label>}
          <button className="link-button" onClick={onReset}>
            Tout réafficher
          </button>
        </div>
      )}
    </div>
  );
}
