import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitInfo } from '../shared/protocol.ts';
import { api } from './api.ts';
import { BRANCH_TYPES, GIT_CHANGED_EVENT, branchSlug, defaultBase } from './branches.ts';

/** Branches regroupées comme dans gitflow : principales, puis feature/, release/, hotfix/, bugfix/, le reste. */
const GROUPS: { label: string; test: (b: string) => boolean }[] = [
  { label: 'Principales', test: (b) => ['main', 'master', 'develop', 'dev'].includes(b) },
  { label: 'Features', test: (b) => b.startsWith('feature/') || b.startsWith('feat/') },
  { label: 'Releases', test: (b) => b.startsWith('release/') },
  { label: 'Hotfixes', test: (b) => b.startsWith('hotfix/') },
  { label: 'Corrections', test: (b) => b.startsWith('bugfix/') || b.startsWith('fix/') },
];

/**
 * Branche git du projet dans la barre du haut ; un clic ouvre la liste pour en changer. Le changement
 * est refusé tant que des fichiers suivis sont modifiés ; une fois fait, l'éditeur se recharge (écrans,
 * parcours et composants peuvent différer d'une branche à l'autre).
 */
export function BranchMenu({ onError }: { onError: (message: string) => void }) {
  const [info, setInfo] = useState<GitInfo | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = () => api.git().then(setInfo, () => setInfo(null));
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(GIT_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener(GIT_CHANGED_EVENT, refresh);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    refresh();
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

  const groups = useMemo(() => {
    const branches = (info?.branches ?? []).filter((b) => !query || b.toLowerCase().includes(query.toLowerCase()));
    const placed = new Set<string>();
    const out = GROUPS.map((g) => {
      const items = branches.filter((b) => !placed.has(b) && g.test(b));
      items.forEach((b) => placed.add(b));
      return { label: g.label, items };
    });
    out.push({ label: 'Autres', items: branches.filter((b) => !placed.has(b)) });
    return out.filter((g) => g.items.length > 0);
  }, [info, query]);

  if (!info) return null;
  const dirty = info.changes.length > 0;

  const switchTo = async (branch: string) => {
    if (branch === info.branch || switching) return;
    setSwitching(branch);
    try {
      await api.switchBranch(branch);
      window.location.reload();
    } catch (error) {
      setSwitching(null);
      onError((error as Error).message);
      refresh();
    }
  };

  return (
    <div className="branch-menu" ref={ref}>
      <button className={`branch-button ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title={dirty ? `${info.changes.length} fichier(s) modifié(s) non commité(s)` : 'Branche git du projet'}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M6 4v12M6 16a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM18 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18 8c0 5-6 4-12 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="branch-name">{info.branch ?? 'HEAD détaché'}</span>
        {dirty && <span className="branch-dirty" aria-label="Modifications non commitées" />}
      </button>
      {open && (
        <div className="branch-popover" role="menu">
          <input className="search" autoFocus placeholder="Rechercher une branche" value={query} onChange={(e) => setQuery(e.target.value)} />
          {dirty && (
            <p className="notice small">
              {info.changes.length} fichier(s) modifié(s) : commitez ou mettez de côté vos changements pour changer de branche.
            </p>
          )}
          <NewBranch info={info} onError={onError} onCreated={(created) => (setInfo(created), setOpen(false))} />
          <div className="branch-list">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="branch-group">{g.label}</div>
                {g.items.map((b) => (
                  <button
                    key={b}
                    role="menuitem"
                    className={`branch-item ${b === info.branch ? 'current' : ''}`}
                    disabled={dirty || Boolean(switching)}
                    onClick={() => switchTo(b)}
                    title={b === info.branch ? 'Branche actuelle' : `Passer sur ${b}`}
                  >
                    {b === info.branch ? '✓ ' : ''}
                    {b}
                    {switching === b && <span className="muted"> · changement…</span>}
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <p className="hint small">Aucune branche.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Nouvelle branche : type gitflow, nom, branche de départ. Depuis la branche actuelle, les fichiers
 * modifiés suivent ; depuis une autre, il faut d'abord les commiter.
 */
function NewBranch({ info, onError, onCreated }: { info: GitInfo; onError: (message: string) => void; onCreated: (info: GitInfo) => void }) {
  const [open, setOpen] = useState(false);
  const [prefix, setPrefix] = useState('feature/');
  const [name, setName] = useState('');
  const [base, setBase] = useState(() => defaultBase('feature/', info.branches, info.branch));
  const [busy, setBusy] = useState(false);
  const full = prefix + branchSlug(name);
  const blocked = info.changes.length > 0 && base !== info.branch;

  if (!open) {
    return (
      <button className="branch-new" onClick={() => setOpen(true)}>
        ＋ Nouvelle branche
      </button>
    );
  }
  const create = async () => {
    if (!branchSlug(name) || busy) return;
    setBusy(true);
    try {
      onCreated(await api.createBranch(full, base));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="branch-form"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="branch-form-row">
        <select
          value={prefix}
          onChange={(e) => {
            setPrefix(e.target.value);
            setBase(defaultBase(e.target.value, info.branches, info.branch));
          }}
          aria-label="Type de branche"
        >
          {BRANCH_TYPES.map((t) => (
            <option key={t.label} value={t.prefix}>
              {t.label}
            </option>
          ))}
        </select>
        <input autoFocus placeholder="nom (ex. ecran-maison)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom de la branche" />
      </div>
      <label className="branch-form-row">
        <span className="muted small">depuis</span>
        <select value={base} onChange={(e) => setBase(e.target.value)} aria-label="Branche de départ">
          {info.branches.map((b) => (
            <option key={b} value={b}>
              {b}
              {b === info.branch ? ' (actuelle)' : ''}
            </option>
          ))}
        </select>
      </label>
      {blocked && <p className="notice small">Fichiers modifiés : partez de {info.branch ?? 'la branche actuelle'} pour les emporter, ou commitez-les d'abord.</p>}
      <div className="branch-form-row">
        <code className="branch-preview">{full || prefix}</code>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          Annuler
        </button>
        <button type="submit" className="primary-button small" disabled={!branchSlug(name) || blocked || busy}>
          Créer
        </button>
      </div>
    </form>
  );
}
