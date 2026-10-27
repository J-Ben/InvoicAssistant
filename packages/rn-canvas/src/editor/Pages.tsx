import { useEffect, useRef, useState } from 'react';
import { type Board, type BoardPage, OVERVIEW_PAGE } from '../shared/protocol.ts';
import { api } from './api.ts';
import { legacyPositions } from './Canvas.tsx';

const PAGE_KEY = 'rn-canvas:page';

function readPage(): string {
  try {
    return localStorage.getItem(PAGE_KEY) ?? OVERVIEW_PAGE;
  } catch {
    return OVERVIEW_PAGE;
  }
}

/**
 * Pages du canevas (vue d'ensemble et parcours), lues et écrites dans le fichier du projet
 * (canvas/parcours.json). Les écritures sont regroupées : un glisser n'écrit qu'à la fin.
 */
export function useBoard(appUrl: string | null, onError: (message: string) => void) {
  const [board, setBoard] = useState<Board | null>(null);
  const [pageId, setPageId] = useState(readPage);
  const saved = useRef('');
  const error = useRef(onError);
  error.current = onError;

  useEffect(() => {
    if (!appUrl) return;
    api.board().then(
      (b) => {
        saved.current = JSON.stringify(b);
        // Disposition des versions précédentes (mémorisée dans le navigateur) : reprise une fois.
        const overview = b.pages[0];
        const legacy = legacyPositions(appUrl);
        if (Object.keys(overview.positions).length === 0 && Object.keys(legacy).length > 0) overview.positions = legacy;
        setBoard(b);
      },
      (e: Error) => error.current(e.message),
    );
  }, [appUrl]);

  useEffect(() => {
    if (!board) return;
    const json = JSON.stringify(board);
    if (json === saved.current) return;
    const timer = window.setTimeout(() => {
      saved.current = json;
      api.saveBoard(board).catch((e: Error) => error.current(`Parcours non enregistrés : ${e.message}`));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [board]);

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_KEY, pageId);
    } catch {}
  }, [pageId]);

  const page = board?.pages.find((p) => p.id === pageId) ?? board?.pages[0] ?? null;
  const updatePage = (id: string, update: (page: BoardPage) => BoardPage) =>
    setBoard((b) => (b ? { ...b, pages: b.pages.map((p) => (p.id === id ? update(p) : p)) } : b));
  const addPage = (name: string, stories: string[] = []) => {
    const id = Math.random().toString(36).slice(2, 10);
    setBoard((b) => (b ? { ...b, pages: [...b.pages, { id, name, stories, positions: {}, groups: [], notes: [] }] } : b));
    setPageId(id);
  };
  const removePage = (id: string) => {
    setBoard((b) => (b ? { ...b, pages: b.pages.filter((p) => p.id !== id || p.id === OVERVIEW_PAGE) } : b));
    if (pageId === id) setPageId(OVERVIEW_PAGE);
  };
  return { board, page, setPageId, updatePage, addPage, removePage };
}

interface Props {
  board: Board;
  page: BoardPage;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

/** Onglets des pages, en haut à gauche du canevas. */
export function PagesBar({ board, page, onSelect, onAdd, onRename, onRemove }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <nav className="pages-bar" aria-label="Pages" onPointerDown={(e) => e.stopPropagation()}>
      {board.pages.map((p) =>
        renaming === p.id ? (
          <input
            key={p.id}
            autoFocus
            className="page-input"
            defaultValue={p.name}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              if (e.target.value.trim()) onRename(p.id, e.target.value.trim());
              setRenaming(null);
            }}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button
            key={p.id}
            className={`page-tab ${p.id === page.id ? 'on' : ''}`}
            onClick={() => onSelect(p.id)}
            onDoubleClick={() => p.id !== OVERVIEW_PAGE && setRenaming(p.id)}
            title={p.id === OVERVIEW_PAGE ? 'Tous les écrans' : `Parcours · ${p.stories?.length ?? 0} écran(s) · double-clic pour renommer`}
          >
            {p.id === OVERVIEW_PAGE ? '▦ ' : '⇢ '}
            {p.name}
            {p.id !== OVERVIEW_PAGE && p.id === page.id && (
              <span
                className="page-remove"
                role="button"
                aria-label={`Supprimer le parcours ${p.name}`}
                title="Supprimer ce parcours (les écrans ne sont pas supprimés)"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Supprimer le parcours « ${p.name} » ? Les écrans restent dans la vue d'ensemble.`)) onRemove(p.id);
                }}
              >
                ×
              </span>
            )}
          </button>
        ),
      )}
      {adding ? (
        <input
          autoFocus
          className="page-input"
          placeholder="Nom du parcours"
          onBlur={(e) => {
            if (e.target.value.trim()) onAdd(e.target.value.trim());
            setAdding(false);
          }}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.key === 'Escape' && ((e.target as HTMLInputElement).value = ''), (e.target as HTMLInputElement).blur())}
        />
      ) : (
        <button className="page-tab add" onClick={() => setAdding(true)} title="Nouveau parcours : une page avec une sélection d'écrans, rangée à part">
          ＋ Parcours
        </button>
      )}
    </nav>
  );
}
