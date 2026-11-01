import { useEffect, useRef, useState } from 'react';
import type { SnippetKind, SnippetRequest } from '../shared/protocol.ts';
import { api } from './api.ts';

const LAYOUTS: { kind: SnippetKind; label: string; hint: string; icon: string }[] = [
  { kind: 'row', label: 'Rangée', hint: 'Éléments côte à côte', icon: '▭▭' },
  { kind: 'column', label: 'Colonne', hint: 'Éléments les uns sous les autres', icon: '☰' },
  { kind: 'grid', label: 'Grille', hint: 'Deux colonnes, cases égales', icon: '▦' },
  { kind: 'chips', label: 'Rangée défilante', hint: 'Pastilles qui défilent à l’horizontale', icon: '⇆' },
  { kind: 'card', label: 'Carte', hint: 'Fond blanc, coins arrondis, ombre douce', icon: '▢' },
  { kind: 'gradient', label: 'Dégradé', hint: 'Bloc en dégradé, couleurs et direction réglables', icon: '◐' },
];

/**
 * Briques de la barre du bas, comme les formes de Figma : une forme qui a déjà une taille, une image des
 * assets (ou importée), une icône, un interrupteur, des mises en page toutes faites. Elles s'insèrent
 * dans l'élément sélectionné (ou à côté), comme les composants.
 */
export function Bricks({ disabled, hint, onInsert }: { disabled: boolean; hint: string; onInsert: (snippet: SnippetRequest) => void }) {
  const [open, setOpen] = useState<'image' | 'icon' | 'layout' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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

  const insert = (snippet: SnippetRequest) => {
    if (disabled) return;
    setOpen(null);
    onInsert(snippet);
  };
  const tool = (key: string, icon: string, label: string, onClick: () => void, expanded?: boolean) => (
    <button key={key} className={`library-tool quick ${expanded ? 'on' : ''}`} aria-label={label} aria-disabled={disabled} aria-expanded={expanded} onClick={onClick} title={`${label} · ${hint}`}>
      <span className="library-icon">{icon}</span>
      <span className="library-label">{label}</span>
    </button>
  );

  return (
    <div className="bricks" ref={ref}>
      {tool('box', '■', 'Forme', () => insert({ kind: 'box' }))}
      {tool('image', '🖼', 'Image', () => setOpen(open === 'image' ? null : 'image'), open === 'image')}
      {tool('icon', '★', 'Icône', () => setOpen(open === 'icon' ? null : 'icon'), open === 'icon')}
      {tool('switch', '⏻', 'Interrupteur', () => insert({ kind: 'switch' }))}
      {tool('layout', '⊞', 'Mise en page', () => setOpen(open === 'layout' ? null : 'layout'), open === 'layout')}
      {open === 'image' && <ImagePicker disabled={disabled} onPick={(asset) => insert({ kind: 'image', asset })} />}
      {open === 'icon' && <IconPicker disabled={disabled} onPick={(icon) => insert({ kind: 'icon', icon })} />}
      {open === 'layout' && (
        <div className="library-popover bricks-popover" role="menu">
          <p className="hint small">{disabled ? "Cliquez d'abord sur un écran ou un élément." : hint}</p>
          {LAYOUTS.map((l) => (
            <button key={l.kind} className="component-item" role="menuitem" aria-disabled={disabled} onClick={() => insert({ kind: l.kind })}>
              <span className="brick-icon">{l.icon}</span>
              <span>
                <b>{l.label}</b>
                <span className="muted small"> · {l.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Images du projet en vignettes, et import d'une image de l'ordinateur (copiée dans les assets). */
export function ImagePicker({ disabled, onPick }: { disabled: boolean; onPick: (asset: string) => void }) {
  const [images, setImages] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api.images().then(setImages, (e: Error) => setError(e.message));
  }, []);
  return (
    <div className="library-popover bricks-popover" role="menu">
      <div className="library-popover-head">
        <button className="primary-button small" onClick={() => file.current?.click()}>
          Importer une image…
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={async (e) => {
            const picked = e.target.files?.[0];
            if (!picked) return;
            try {
              const { path } = await api.importImage(picked);
              onPick(path);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      </div>
      {error && <p className="notice error small">{error}</p>}
      {disabled && <p className="hint small">Cliquez d'abord sur un écran ou un élément.</p>}
      <div className="image-grid">
        {images?.map((path) => (
          <button key={path} className="image-cell" aria-disabled={disabled} onClick={() => onPick(path)} title={path}>
            <img src={api.imageUrl(path)} alt="" loading="lazy" />
            <span>{path.split('/').pop()}</span>
          </button>
        ))}
        {images?.length === 0 && <p className="hint small">Aucune image dans assets/ : importez-en une.</p>}
      </div>
    </div>
  );
}

/** Icônes Ionicons (@expo/vector-icons), dessinées avec leur police pour les choisir à l'œil. */
export function IconPicker({ disabled, onPick }: { disabled: boolean; onPick: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ installed: boolean; icons: { name: string; code: number }[] } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => api.icons(query).then(setResult, () => setResult(null)), 150);
    return () => window.clearTimeout(timer);
  }, [query]);
  return (
    <div className="library-popover bricks-popover wide-icons" role="menu">
      <div className="library-popover-head">
        <input className="search" autoFocus placeholder="Rechercher une icône (home, bell, settings…)" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {result && !result.installed ? (
        <p className="notice small">
          Les icônes viennent de <code>@expo/vector-icons</code>, absent du projet : <code>npx expo install @expo/vector-icons</code>
        </p>
      ) : (
        <div className="icon-grid">
          {result?.icons.map((icon) => (
            <button key={icon.name} className="icon-cell" aria-disabled={disabled} onClick={() => onPick(icon.name)} title={icon.name}>
              <span className="ionicon">{String.fromCodePoint(icon.code)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
