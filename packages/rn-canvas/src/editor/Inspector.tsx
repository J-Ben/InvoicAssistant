import { useEffect, useMemo, useState } from 'react';
import type { EditRequest, InspectResult, SourceValue, StyleSource, StyleTarget, ThemeInfo } from '../shared/protocol.ts';
import type { Selection } from './App.tsx';
import { ColorInput, CommitInput } from './fields.tsx';
import { displayValue, isColorKey, isToken, parseInput, toHex } from './values.ts';

interface Props {
  selection: Selection | null;
  theme: ThemeInfo | null;
  root: string;
  onSelectAncestor: (loc: string) => void;
  onEdit: (request: EditRequest) => void;
}

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Disposition', keys: ['flex', 'flexDirection', 'alignItems', 'justifyContent', 'gap', 'width', 'height'] },
  { title: 'Espacement', keys: ['padding', 'paddingHorizontal', 'paddingVertical', 'margin', 'marginHorizontal', 'marginVertical'] },
  { title: 'Apparence', keys: ['backgroundColor', 'borderRadius', 'borderWidth', 'borderColor', 'opacity'] },
  { title: 'Texte', keys: ['color', 'fontSize', 'fontWeight', 'lineHeight', 'textAlign'] },
];
const GROUPED = new Set(GROUPS.flatMap((g) => g.keys));

const ENUMS: Record<string, string[]> = {
  flexDirection: ['row', 'column', 'row-reverse', 'column-reverse'],
  alignItems: ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'],
  justifyContent: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  textAlign: ['auto', 'left', 'center', 'right', 'justify'],
  fontWeight: ['300', '400', '500', '600', '700', '800', 'normal', 'bold'],
};

/** Clé RN → propriété calculée du DOM, pour afficher la valeur effective en filigrane. */
const COMPUTED_ALIAS: Record<string, string> = {
  padding: 'paddingTop',
  paddingHorizontal: 'paddingLeft',
  paddingVertical: 'paddingTop',
  margin: 'marginTop',
  marginHorizontal: 'marginLeft',
  marginVertical: 'marginTop',
  borderRadius: 'borderTopLeftRadius',
  borderWidth: 'borderTopWidth',
  borderColor: 'borderTopColor',
};

const BUILTINS = /^(View|Text|Image|ScrollView|FlatList|SectionList|TextInput|Pressable|Touchable\w*|SafeAreaView|KeyboardAvoidingView|ActivityIndicator|Switch|Modal|ImageBackground)$/;

function targetKey(t: StyleTarget) {
  return t.kind === 'instance' ? 'instance' : t.ref;
}

function defaultTarget(sources: StyleSource[]): StyleTarget {
  const own = [...sources].reverse().find((s) => s.kind === 'stylesheet' && s.usages === 1);
  return own ? { kind: 'stylesheet', ref: own.ref } : { kind: 'instance' };
}

export function Inspector({ selection, theme, root, onSelectAncestor, onEdit }: Props) {
  if (!selection) {
    return (
      <aside className="sidebar right">
        <div className="panel-body">
          <p className="hint">
            Cliquez sur un élément d'un écran pour l'inspecter.
            <br />
            <span className="small">
              Un clic sélectionne l'instance d'un composant, Alt+clic l'élément exact à l'intérieur.
              <br />
              V : sélection · I : interaction · Échap : désélectionner
            </span>
          </p>
        </div>
      </aside>
    );
  }

  const { info, inspect, error } = selection;
  const ancestors = [...info.ancestors].reverse();
  const screenFile = ancestors[0]?.loc.split(':')[0];
  const file = info.loc.split(':')[0];
  const [, line, column] = /:(\d+):(\d+)$/.exec(info.loc) ?? [];

  return (
    <aside className="sidebar right">
      <div className="panel-body">
        <div className="crumbs">
          {ancestors.map((a, i) => (
            <span key={`${a.loc}-${i}`}>
              {i > 0 && <span className="muted"> › </span>}
              <button className={a.loc === info.loc ? 'crumb on' : 'crumb'} onClick={() => onSelectAncestor(a.loc)} title={a.loc}>
                {a.name}
              </button>
            </span>
          ))}
        </div>
        <div className="element-head">
          <h2 className="element-name">{info.name}</h2>
          <div className="actions">
            <button onClick={() => onEdit({ op: 'duplicate', loc: info.loc, name: info.name })} title="Dupliquer (⌘/Ctrl+D)">Dupliquer</button>
            <button className="danger" onClick={() => onEdit({ op: 'remove', loc: info.loc, name: info.name })} title="Supprimer (Suppr)">Supprimer</button>
          </div>
        </div>
        <a className="file-link" href={`vscode://file/${root}/${file}:${line}:${Number(column) + 1}`} title="Ouvrir dans VS Code">
          {file}:{line}
        </a>

        {screenFile && file !== screenFile && (
          <p className="notice">
            Élément défini dans <b>{file.split('/').pop()}</b> : le modifier ici change <b>toutes les instances</b> de ce composant.
            Pour ne changer que cet endroit, sélectionnez l'instance dans le fil d'Ariane (ou cliquez sans Alt).
          </p>
        )}

        {error && <p className="notice error">{error}</p>}
        {!inspect && !error && <p className="hint">Analyse du code…</p>}
        {inspect && <Details key={inspect.loc} inspect={inspect} computed={info.computed} theme={theme} onEdit={onEdit} />}
      </div>
    </aside>
  );
}

function Details({ inspect, computed, theme, onEdit }: { inspect: InspectResult; computed: Record<string, string>; theme: ThemeInfo | null; onEdit: Props['onEdit'] }) {
  const { loc, name } = inspect;
  const sources = inspect.style.sources;
  const [target, setTarget] = useState<StyleTarget>(() => defaultTarget(sources));
  const [newKey, setNewKey] = useState('');

  useEffect(() => {
    // Après une édition, la source ciblée doit toujours exister.
    if (target.kind === 'stylesheet' && !sources.some((s) => s.ref === target.ref)) setTarget(defaultTarget(sources));
  }, [sources, target]);

  const tokens = useMemo(
    () => (theme?.tokens ?? []).filter((t) => inspect.scope.includes(t.path.split('.')[0])),
    [theme, inspect.scope],
  );
  const tokenValue = (code: string) => theme?.tokens.find((t) => t.path === code)?.value;

  // Valeur effective (la dernière source l'emporte) et source d'origine de chaque clé.
  const merged = new Map<string, { value: SourceValue; from: string }>();
  for (const s of sources) for (const p of s.properties) if (!p.key.startsWith('...')) merged.set(p.key, { value: p.value, from: s.ref });
  const targetSource = sources.find((s) => (target.kind === 'instance' ? s.kind === 'inline' && s === sources[sources.length - 1] : s.ref === target.ref));
  const inTarget = new Set(targetSource?.properties.map((p) => p.key));

  const setStyle = (key: string, raw: string) => onEdit({ op: 'setStyle', loc, name, key, value: parseInput(raw, inspect.scope), target });
  const removeStyle = (key: string) => onEdit({ op: 'setStyle', loc, name, key, value: { kind: 'remove' }, target });

  const extraKeys = [...merged.keys()].filter((k) => !GROUPED.has(k));
  const isComponent = /^[A-Z]/.test(name) && !BUILTINS.test(name);

  const row = (key: string) => {
    const entry = merged.get(key);
    const text = displayValue(entry?.value);
    const effective = computed[COMPUTED_ALIAS[key] ?? key];
    const colorSource = entry && isToken(entry.value) ? displayValue(tokenValue(entry.value.code)) : text || effective;
    const hex = isColorKey(key) ? toHex(colorSource) : null;
    const overridden = entry && targetSource && entry.from !== targetSource.ref && target.kind === 'stylesheet';
    return (
      <div key={key} className={`prop-row ${entry ? 'set' : ''}`}>
        <label title={key}>{key}</label>
        <div className="prop-input">
          {isColorKey(key) && <ColorInput value={hex ?? '#000000'} onCommit={(v) => setStyle(key, v)} />}
          <CommitInput
            className={entry && isToken(entry.value) ? 'token-value' : ''}
            value={text}
            placeholder={effective && effective !== 'auto' && effective !== 'normal' ? effective : ''}
            list={isColorKey(key) ? 'rnc-tokens' : ENUMS[key] ? `rnc-enum-${key}` : undefined}
            onCommit={(v) => setStyle(key, v)}
          />
          {inTarget.has(key) ? (
            <button className="icon" title="Retirer" onClick={() => removeStyle(key)}>×</button>
          ) : entry ? (
            <span className={`origin ${overridden ? 'warn' : ''}`} title={`Défini par ${entry.from}`}>{entry.from === 'inline' ? 'inline' : entry.from.split('.').pop()}</span>
          ) : (
            <span className="origin" />
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <datalist id="rnc-tokens">
        {tokens.map((t) => (
          <option key={t.path} value={t.path}>{displayValue(t.value)}</option>
        ))}
      </datalist>
      {Object.entries(ENUMS).map(([key, values]) => (
        <datalist key={key} id={`rnc-enum-${key}`}>
          {values.map((v) => <option key={v} value={v} />)}
        </datalist>
      ))}

      {inspect.text && (
        <section className="section">
          <h3>Texte</h3>
          {inspect.text.editable ? (
            <CommitInput multiline value={inspect.text.value ?? ''} onCommit={(v) => onEdit({ op: 'setText', loc, name, value: v })} />
          ) : (
            <p className="code">{inspect.text.code}</p>
          )}
          {!inspect.text.editable && <p className="hint small">Texte dynamique : il vient des données, modifiez-le dans le code.</p>}
        </section>
      )}

      {inspect.props.length > 0 || isComponent ? (
        <section className="section">
          <h3>{isComponent ? `Props de l'instance` : 'Props'}</h3>
          {inspect.props.map((p) => (
            <div key={p.name} className="prop-row set">
              <label title={p.name}>{p.name}</label>
              <div className="prop-input">
                {p.value && p.value.kind !== 'expression' && !p.name.startsWith('...') ? (
                  <CommitInput
                    value={displayValue(p.value)}
                    onCommit={(v) => onEdit({ op: 'setProp', loc, name, prop: p.name, value: parseInput(v, inspect.scope) })}
                  />
                ) : (
                  <span className="code" title="Expression : modifiable dans le code">{p.value?.code ?? '{}'}</span>
                )}
                {!p.name.startsWith('...') && (
                  <button className="icon" title="Retirer" onClick={() => onEdit({ op: 'setProp', loc, name, prop: p.name, value: { kind: 'remove' } })}>×</button>
                )}
              </div>
            </div>
          ))}
          <AddRow placeholder="nouvelle prop" onAdd={(prop, value) => onEdit({ op: 'setProp', loc, name, prop, value: parseInput(value, inspect.scope) })} />
        </section>
      ) : null}

      <section className="section">
        <h3>Style</h3>
        {!inspect.style.editable ? (
          <p className="code">{inspect.style.code}</p>
        ) : (
          <>
            <label className="target">
              <span>Modifier</span>
              <select
                value={targetKey(target)}
                onChange={(e) => setTarget(e.target.value === 'instance' ? { kind: 'instance' } : { kind: 'stylesheet', ref: e.target.value })}
              >
                {sources
                  .filter((s) => s.kind === 'stylesheet')
                  .map((s) => (
                    <option key={s.ref} value={s.ref}>
                      {s.ref}
                      {s.usages > 1 ? ` (partagé ×${s.usages})` : ''}
                      {s.conditional ? ' (conditionnel)' : ''}
                    </option>
                  ))}
                <option value="instance">Cet élément uniquement</option>
              </select>
            </label>
            {target.kind === 'stylesheet' && (sources.find((s) => s.ref === target.ref)?.usages ?? 1) > 1 && (
              <p className="notice small">Ce style est partagé : la modification touche tous les éléments qui l'utilisent.</p>
            )}
            {sources.some((s) => s.kind === 'unknown') && (
              <p className="hint small">
                Styles non analysables : {sources.filter((s) => s.kind === 'unknown').map((s) => s.ref).join(', ')}
              </p>
            )}
            {GROUPS.map((g) => (
              <div key={g.title} className="style-group">
                <h4>{g.title}</h4>
                {g.keys.map(row)}
              </div>
            ))}
            {extraKeys.length > 0 && (
              <div className="style-group">
                <h4>Autres</h4>
                {extraKeys.map(row)}
              </div>
            )}
            <div className="style-group">
              <AddRow
                placeholder="propriété (ex. borderBottomWidth)"
                keyValue={newKey}
                onKeyChange={setNewKey}
                onAdd={(key, value) => {
                  setStyle(key, value);
                  setNewKey('');
                }}
              />
            </div>
          </>
        )}
      </section>
    </>
  );
}

function AddRow({ placeholder, onAdd, keyValue, onKeyChange }: { placeholder: string; onAdd: (key: string, value: string) => void; keyValue?: string; onKeyChange?: (v: string) => void }) {
  const [localKey, setLocalKey] = useState('');
  const [value, setValue] = useState('');
  const key = keyValue ?? localKey;
  const setKey = onKeyChange ?? setLocalKey;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !value.trim()) return;
    onAdd(key.trim(), value);
    setLocalKey('');
    setValue('');
  };
  return (
    <form className="add-row" onSubmit={submit}>
      <input value={key} placeholder={placeholder} onChange={(e) => setKey(e.target.value)} spellCheck={false} />
      <input value={value} placeholder="valeur" onChange={(e) => setValue(e.target.value)} spellCheck={false} />
      <button type="submit" className="icon" title="Ajouter">+</button>
    </form>
  );
}
