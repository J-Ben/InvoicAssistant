import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentEntry, CreateInfo, CreatePropKind, CreatePropSpec, CreateRequest, CreateResult, GitInfo } from '../shared/protocol.ts';
import { api } from './api.ts';
import { GIT_CHANGED_EVENT, branchSlug } from './branches.ts';

export type Placement = 'center' | 'beside';

interface Props {
  conventions: CreateInfo;
  components: ComponentEntry[];
  /** Écran sélectionné : « à côté de » le propose comme emplacement. */
  activeTitle: string | null;
  onClose: () => void;
  onCreated: (result: CreateResult, placement: Placement) => void;
}

const PROP_TYPES: [CreatePropKind, string][] = [
  ['string', 'Texte'],
  ['number', 'Nombre'],
  ['boolean', 'Oui / non'],
  ['color', 'Couleur'],
  ['function', 'Action (onPress…)'],
  ['node', 'Contenu (children)'],
];

const LEVEL_LABELS: Record<string, string> = { atoms: 'Atome', molecules: 'Molécule', organisms: 'Organisme', templates: 'Template', pages: 'Page' };

/**
 * Création d'un composant ou d'un écran : nom libre (normalisé), rangement, point de départ (vide avec
 * ses props, ou copie d'un composant), skeleton, emplacement sur le canevas. L'aperçu montre les
 * fichiers qui seront écrits, aux conventions du projet.
 */
export function CreateDialog({ conventions, components, activeTitle, onClose, onCreated }: Props) {
  const hasComponents = conventions.levels.length > 0;
  const [kind, setKind] = useState<'component' | 'screen'>(hasComponents ? 'component' : 'screen');
  const [name, setName] = useState('');
  const [level, setLevel] = useState(conventions.levels[0]?.name ?? '');
  const [group, setGroup] = useState('');
  const [dir, setDir] = useState(conventions.screenDirs[0] ?? '');
  const [from, setFrom] = useState('');
  const [props, setProps] = useState<CreatePropSpec[]>([]);
  const [skeleton, setSkeleton] = useState(false);
  const [placement, setPlacement] = useState<Placement>(activeTitle ? 'beside' : 'center');
  const [preview, setPreview] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Nouvelle branche pour ce travail (gitflow) : feature/<nom>, depuis la branche actuelle.
  const [git, setGit] = useState<GitInfo | null>(null);
  const [onBranch, setOnBranch] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);
  useEffect(() => {
    api.git().then(setGit, () => setGit(null));
  }, []);
  const branch = branchName ?? `feature/${branchSlug(name) || (kind === 'screen' ? 'nouvel-ecran' : 'nouveau-composant')}`;
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => nameInput.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Copie : un composant de la bibliothèque, ou un écran du canevas.
  const sources = useMemo(() => {
    if (kind === 'screen') return [['Écrans du canevas', conventions.screens.map((s) => ({ name: s.name, file: s.file }))]] as [string, { name: string; file: string | null }[]][];
    const groups = new Map<string, ComponentEntry[]>();
    for (const c of components) if (c.file) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [components, conventions.screens, kind]);
  const source = from ? (sources.flatMap(([, items]) => items).find((c) => `${c.file}#${c.name}` === from) ?? null) : null;
  useEffect(() => setFrom(''), [kind]);
  const currentLevel = conventions.levels.find((l) => l.name === level);

  const request: CreateRequest = {
    kind,
    name,
    ...(kind === 'component' ? { level, group: group || undefined } : { dir }),
    from: source ? { file: source.file!, name: source.name } : null,
    props: kind === 'component' && !source ? props.filter((p) => p.name.trim()) : [],
    skeleton: kind === 'component' && !source && skeleton,
  };
  const key = JSON.stringify(request);

  // Aperçu des fichiers (et des erreurs : nom pris, nom invalide…) à chaque changement.
  useEffect(() => {
    if (!name.trim()) {
      setPreview(null);
      setError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api.previewCreate(request).then(
        (result) => {
          setPreview(result);
          setError(null);
        },
        (e: Error) => {
          setPreview(null);
          setError(e.message);
        },
      );
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const submit = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      if (onBranch && git) {
        await api.createBranch(branch.trim());
        window.dispatchEvent(new Event(GIT_CHANGED_EVENT));
      }
      const result = await api.create(request);
      onCreated(result, placement);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const setProp = (i: number, patch: Partial<CreatePropSpec>) => setProps((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog create-dialog"
        role="dialog"
        aria-label="Créer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2>Créer</h2>
          <div className="segmented">
            <button type="button" className={kind === 'component' ? 'on' : ''} disabled={!hasComponents} onClick={() => setKind('component')} title={hasComponents ? '' : 'Aucun dossier Atomic Design trouvé (voir rn-canvas doctor)'}>
              Composant
            </button>
            <button type="button" className={kind === 'screen' ? 'on' : ''} onClick={() => setKind('screen')}>
              Écran
            </button>
          </div>
        </header>

        <label className="field">
          <span>Nom</span>
          <input ref={nameInput} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'component' ? 'bouton principal, carte facture…' : 'récap mensuel…'} spellCheck={false} />
          {preview && <small className="muted">→ {preview.name}</small>}
        </label>

        {kind === 'component' ? (
          <div className="field-row">
            <label className="field">
              <span>Niveau</span>
              <select
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                  setGroup('');
                }}
              >
                {conventions.levels.map((l) => (
                  <option key={l.name} value={l.name}>
                    {LEVEL_LABELS[l.name] ?? l.name} ({l.name})
                  </option>
                ))}
              </select>
            </label>
            {currentLevel && currentLevel.groups.length > 0 && (
              <label className="field">
                <span>Rangé dans</span>
                <select value={group} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">{currentLevel.name}/</option>
                  {currentLevel.groups.map((g) => (
                    <option key={g} value={g}>
                      {currentLevel.name}/{g}/
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : (
          <label className="field">
            <span>Dossier</span>
            <input list="create-screen-dirs" value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
            <datalist id="create-screen-dirs">
              {conventions.screenDirs.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
        )}

        <label className="field">
          <span>Partir de</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{kind === 'component' ? 'Un composant vide' : 'Un écran vide'}</option>
            {sources.map(([g, items]) => (
              <optgroup key={g} label={g}>
                {items.map((c) => (
                  <option key={`${c.file}#${c.name}`} value={`${c.file}#${c.name}`}>
                    Copie de {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {source && <small className="muted">Ses fichiers sont copiés et renommés ; l'original n'est pas touché.</small>}
        </label>

        {kind === 'component' && !source && (
          <fieldset className="field create-props">
            <legend>Propriétés</legend>
            {props.map((p, i) => (
              <div key={i} className="create-prop">
                <input value={p.name} onChange={(e) => setProp(i, { name: e.target.value })} placeholder="nom (libellé, on press…)" spellCheck={false} aria-label="Nom de la propriété" />
                <select value={p.type} onChange={(e) => setProp(i, { type: e.target.value as CreatePropKind })} aria-label="Type">
                  {PROP_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {!['function', 'node'].includes(p.type) ? (
                  p.type === 'boolean' ? (
                    <select value={p.default ?? 'false'} onChange={(e) => setProp(i, { default: e.target.value })} aria-label="Valeur par défaut">
                      <option value="false">non</option>
                      <option value="true">oui</option>
                    </select>
                  ) : (
                    <input value={p.default ?? ''} type={p.type === 'color' ? 'color' : 'text'} onChange={(e) => setProp(i, { default: e.target.value })} placeholder="par défaut" aria-label="Valeur par défaut" />
                  )
                ) : (
                  <span />
                )}
                <label className="create-optional" title="Facultative (sinon obligatoire)">
                  <input type="checkbox" checked={p.optional} onChange={(e) => setProp(i, { optional: e.target.checked })} /> facultative
                </label>
                <button type="button" className="icon" onClick={() => setProps((ps) => ps.filter((_, j) => j !== i))} aria-label="Retirer la propriété">
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="link-button" onClick={() => setProps((ps) => [...ps, { name: '', type: 'string', optional: false }])}>
              ＋ Ajouter une propriété
            </button>
          </fieldset>
        )}

        {kind === 'component' && !source && conventions.skeleton && (
          <label className="field-check">
            <input type="checkbox" checked={skeleton} onChange={(e) => setSkeleton(e.target.checked)} />
            Avec skeleton (react-zero-skeleton) : la forme du composant devient un SkeletonBox, export avec withSkeleton
          </label>
        )}

        {git && (
          <div className="field">
            <span>Branche</span>
            <div className="create-branch">
              <label className="create-branch-check" title={`Créer la branche depuis ${git.branch ?? 'HEAD'} (les fichiers modifiés la suivent), puis les fichiers dessus`}>
                <input type="checkbox" checked={onBranch} onChange={(e) => setOnBranch(e.target.checked)} />
                {onBranch ? 'Nouvelle branche' : `Rester sur ${git.branch ?? 'HEAD détaché'}`}
              </label>
              {onBranch && <input value={branch} onChange={(e) => setBranchName(e.target.value)} aria-label="Nom de la nouvelle branche" spellCheck={false} />}
            </div>
          </div>
        )}

        <label className="field">
          <span>Sur le canevas</span>
          <select value={placement} onChange={(e) => setPlacement(e.target.value as Placement)}>
            <option value="center">Au centre de la vue</option>
            {activeTitle && <option value="beside">À côté de « {activeTitle} »</option>}
          </select>
        </label>

        <div className="create-preview" aria-live="polite">
          {error ? (
            <p className="create-error">{error}</p>
          ) : preview ? (
            <>
              <p className="muted small">Fichiers créés :</p>
              <ul>
                {preview.files.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
              <p className="muted small">
                Import : <code>{preview.importFrom}</code>
                {kind === 'screen' && ' · pas ajouté à la navigation de l’app'}
              </p>
            </>
          ) : (
            <p className="muted small">Donnez un nom : les fichiers à créer s'affichent ici.</p>
          )}
        </div>

        <footer>
          <button type="button" className="link-button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="primary-button" disabled={!preview || busy}>
            {busy ? 'Création…' : `Créer ${preview ? preview.name : ''}`}
          </button>
        </footer>
      </form>
    </div>
  );
}
