import { useEffect, useMemo, useState } from 'react';
import type { ChangeEntry, JournalResponse, LoadSession, ScreenTiming } from '../shared/protocol.ts';
import { api } from './api.ts';

/** « 2,4 s » */
export function seconds(ms: number): string {
  return `${(ms / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
/** `canvas/Accueil.canvas.tsx#Rempli` → `Accueil · Rempli` */
const screenName = (id: string) => `${id.slice(0, id.lastIndexOf('#')).split('/').pop()!.replace(/\.canvas\.\w+$/, '')} · ${id.slice(id.lastIndexOf('#') + 1)}`;

const ACTIONS: Record<ChangeEntry['action'], { icon: string; label: string }> = {
  edit: { icon: '✎', label: 'Modifié' },
  undo: { icon: '↶', label: 'Annulé' },
  redo: { icon: '↷', label: 'Rétabli' },
  create: { icon: '＋', label: 'Créé' },
};

interface Summary {
  captures: ScreenTiming[];
  live: ScreenTiming[];
  average: number | null;
  slowest: ScreenTiming | null;
  /** Du lancement à la dernière capture. */
  total: number | null;
}

function summarize(session: LoadSession): Summary {
  const captures = session.screens.filter((s) => s.kind === 'capture');
  const live = session.screens.filter((s) => s.kind === 'live');
  const ok = captures.filter((s) => s.ok);
  const average = ok.length ? ok.reduce((sum, s) => sum + s.ms, 0) / ok.length : null;
  const slowest = ok.reduce<ScreenTiming | null>((max, s) => (!max || s.ms > max.ms ? s : max), null);
  const total = captures.length ? new Date(session.updatedAt).getTime() - new Date(session.startedAt).getTime() : null;
  return { captures, live, average, slowest, total };
}

/** Écart avec le lancement précédent pour le même écran : « +1,2 s » en rouge, « −0,8 s » en vert. */
function Delta({ ms, before }: { ms: number; before: number | undefined }) {
  if (before === undefined) return null;
  const diff = ms - before;
  if (Math.abs(diff) < 200) return <span className="history-delta same">=</span>;
  return <span className={`history-delta ${diff > 0 ? 'slower' : 'faster'}`}>{diff > 0 ? '+' : '−'}{seconds(Math.abs(diff))}</span>;
}

function Sessions({ sessions }: { sessions: LoadSession[] }) {
  const [open, setOpen] = useState<string | null>(sessions[0]?.id ?? null);
  if (!sessions.length) return <p className="hint">Aucun lancement enregistré pour l'instant : les temps s'enregistrent au prochain lancement de l'éditeur.</p>;
  return (
    <div className="history-list">
      {sessions.map((session, i) => {
        const s = summarize(session);
        // Lancement précédent (plus ancien) : dernière durée connue de chaque écran.
        const previous = new Map<string, number>();
        for (const older of sessions.slice(i + 1).reverse()) for (const t of older.screens) if (t.ok) previous.set(`${t.kind}|${t.id}`, t.ms);
        const expanded = open === session.id;
        const rows = [...session.screens].sort((a, b) => b.ms - a.ms);
        return (
          <section key={session.id} className={`history-session ${expanded ? 'open' : ''}`}>
            <button className="history-session-head" onClick={() => setOpen(expanded ? null : session.id)} aria-expanded={expanded}>
              <span className="history-when">{dateTime(session.startedAt)}</span>
              <span className="muted small">v{session.version}{session.device ? ` · ${session.device.replace('x', '×')}` : ''}</span>
              <span className="history-figures">
                {session.appReadyMs !== null && <span title="Du lancement de l'éditeur à la première réponse d'Expo">Expo prêt en {seconds(session.appReadyMs)}</span>}
                {s.captures.length > 0 && (
                  <span title="Captures faites pendant ce lancement (moyenne par écran)">
                    {s.captures.length} capture{s.captures.length > 1 ? 's' : ''}{s.average !== null ? ` · ${seconds(s.average)} en moyenne` : ''}
                  </span>
                )}
                {session.reused > 0 && <span title="Captures du lancement précédent, code inchangé : affichées tout de suite">{session.reused} reprise{session.reused > 1 ? 's' : ''}</span>}
                {s.live.length > 0 && <span title="Écrans chargés en direct dans l'éditeur">{s.live.length} en direct</span>}
              </span>
              <span className="history-chevron">{expanded ? '▾' : '▸'}</span>
            </button>
            {expanded && (
              <div className="history-session-body">
                {s.total !== null && (
                  <p className="muted small">
                    Du lancement à la dernière capture : {seconds(s.total)}
                    {s.slowest ? ` · plus lent : ${screenName(s.slowest.id)} (${seconds(s.slowest.ms)})` : ''}
                  </p>
                )}
                {rows.length === 0 ? (
                  <p className="muted small">Aucun écran chargé : toutes les captures étaient à jour.</p>
                ) : (
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Écran</th>
                        <th>Type</th>
                        <th>Durée</th>
                        <th title="Écart avec le dernier chargement connu de cet écran">Écart</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t, j) => (
                        <tr key={`${t.id}-${j}`} className={t.ok ? '' : 'failed'}>
                          <td title={t.id}>{screenName(t.id)}</td>
                          <td className="muted">{t.kind === 'capture' ? 'Capture' : 'Direct'}</td>
                          <td>
                            <span className="history-bar" style={{ width: `${Math.min(100, (t.ms / rows[0].ms) * 100)}%` }} />
                            {seconds(t.ms)}
                            {!t.ok && <span className="muted"> · échec</span>}
                          </td>
                          <td>
                            <Delta ms={t.ms} before={t.ok ? previous.get(`${t.kind}|${t.id}`) : undefined} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Changes({ changes, commits }: Pick<JournalResponse, 'changes' | 'commits'>) {
  // Modifications regroupées par jour, la plus récente en premier.
  const days = useMemo(() => {
    const out: [string, ChangeEntry[]][] = [];
    for (const change of changes) {
      const key = day(change.at);
      if (out.at(-1)?.[0] !== key) out.push([key, []]);
      out.at(-1)![1].push(change);
    }
    return out;
  }, [changes]);
  return (
    <div className="history-list">
      <h3>Depuis l'éditeur</h3>
      {days.length === 0 && <p className="hint">Aucune modification faite depuis l'éditeur pour l'instant.</p>}
      {days.map(([label, entries]) => (
        <section key={label}>
          <h4>{label}</h4>
          <ul className="history-changes">
            {entries.map((c, i) => (
              <li key={i} className={`change-${c.action}`}>
                <span className="history-time">{time(c.at)}</span>
                <span className="history-action" title={ACTIONS[c.action].label}>{ACTIONS[c.action].icon}</span>
                <span className="history-label">
                  {c.action === 'undo' || c.action === 'redo' ? `${ACTIONS[c.action].label} : ` : ''}
                  {c.label}
                </span>
                <span className="muted small history-file" title={c.file}>{c.file.split('/').pop()}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <h3>Commits git</h3>
      {commits.length === 0 && <p className="hint">Pas de dépôt git, ou aucun commit.</p>}
      <ul className="history-changes">
        {commits.map((c) => (
          <li key={c.hash}>
            <span className="history-time" title={dateTime(c.date)}>{new Date(c.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
            <code className="history-hash">{c.hash}</code>
            <span className="history-label">{c.subject}</span>
            <span className="muted small history-file" title={c.files.join('\n')}>
              {c.files.length} fichier{c.files.length > 1 ? 's' : ''} · {c.author}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Historique du projet : temps de chargement des écrans par lancement, modifications et commits. */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'loads' | 'changes'>('loads');
  const [data, setData] = useState<JournalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.journal().then(setData, (e: Error) => setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog history-dialog" role="dialog" aria-label="Historique">
        <header>
          <h2>Historique</h2>
          <div className="segmented" role="tablist">
            <button className={tab === 'loads' ? 'on' : ''} role="tab" aria-selected={tab === 'loads'} onClick={() => setTab('loads')}>
              Chargements
            </button>
            <button className={tab === 'changes' ? 'on' : ''} role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
              Modifications
            </button>
          </div>
          <button className="link-button" onClick={onClose} aria-label="Fermer">
            Fermer
          </button>
        </header>
        {error && <p className="create-error">{error}</p>}
        {!data && !error && <p className="muted">Chargement…</p>}
        {data && (tab === 'loads' ? <Sessions sessions={data.sessions} /> : <Changes changes={data.changes} commits={data.commits} />)}
      </div>
    </div>
  );
}
