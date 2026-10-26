import { useEffect, useMemo, useState } from 'react';
import type { EditRequest, InspectResult, SourceValue, StyleSource, StyleTarget, ThemeInfo, ValueOrigin } from '../shared/protocol.ts';
import type { Selection } from './App.tsx';
import { type Choice, ColorInput, CommitInput, NumberField, SegmentedField, SelectField, TokenPicker } from './fields.tsx';
import { displayValue, isColorKey, isToken, parseInput, toHex } from './values.ts';

interface Props {
  selection: Selection | null;
  theme: ThemeInfo | null;
  root: string;
  onSelectAncestor: (loc: string) => void;
  onEdit: (request: EditRequest) => void;
}

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Disposition', keys: ['flex', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'alignSelf', 'gap', 'width', 'height'] },
  { title: 'Espacement', keys: ['padding', 'paddingHorizontal', 'paddingVertical', 'margin', 'marginHorizontal', 'marginVertical'] },
  { title: 'Apparence', keys: ['backgroundColor', 'borderRadius', 'borderWidth', 'borderColor', 'opacity'] },
  { title: 'Texte', keys: ['color', 'fontSize', 'fontWeight', 'lineHeight', 'textAlign'] },
];
const GROUPED = new Set(GROUPS.flatMap((g) => g.keys));

const choices = (values: string[], labels: Record<string, string> = {}, shorts: Record<string, string> = {}): Choice[] =>
  values.map((v) => ({ value: v, label: labels[v] ?? v, short: shorts[v] }));

/** Petites listes : boutons segmentés. */
const SEGMENTED: Record<string, Choice[]> = {
  flexDirection: choices(['row', 'column', 'row-reverse', 'column-reverse'], { row: 'Ligne', column: 'Colonne', 'row-reverse': 'Ligne inversée', 'column-reverse': 'Colonne inversée' }, { row: '→', column: '↓', 'row-reverse': '←', 'column-reverse': '↑' }),
  textAlign: choices(['left', 'center', 'right', 'justify'], { left: 'Gauche', center: 'Centré', right: 'Droite', justify: 'Justifié' }, { left: '⇤', center: '↔', right: '⇥', justify: '☰' }),
  flexWrap: choices(['nowrap', 'wrap'], { nowrap: 'Sur une ligne', wrap: 'Retour à la ligne' }, { nowrap: '—', wrap: '↵' }),
};

/** Listes plus longues : menu déroulant. */
const SELECTS: Record<string, Choice[]> = {
  alignItems: choices(['flex-start', 'center', 'flex-end', 'stretch', 'baseline'], { 'flex-start': 'Début', center: 'Centre', 'flex-end': 'Fin', stretch: 'Étirer', baseline: 'Ligne de base' }),
  alignSelf: choices(['auto', 'flex-start', 'center', 'flex-end', 'stretch'], { auto: 'Auto', 'flex-start': 'Début', center: 'Centre', 'flex-end': 'Fin', stretch: 'Étirer' }),
  justifyContent: choices(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'], { 'flex-start': 'Début', center: 'Centre', 'flex-end': 'Fin', 'space-between': 'Espacé (bords)', 'space-around': 'Espacé (autour)', 'space-evenly': 'Espacé (égal)' }),
  fontWeight: choices(['300', '400', '500', '600', '700', '800'], { '300': '300 · Light', '400': '400 · Regular', '500': '500 · Medium', '600': '600 · SemiBold', '700': '700 · Bold', '800': '800 · ExtraBold' }),
  position: choices(['relative', 'absolute']),
  overflow: choices(['visible', 'hidden', 'scroll']),
};

const NUMERIC = /^(flex|flexGrow|flexShrink|gap|rowGap|columnGap|width|height|minWidth|minHeight|maxWidth|maxHeight|top|right|bottom|left|zIndex|elevation|opacity|fontSize|lineHeight|letterSpacing|(padding|margin)(Top|Right|Bottom|Left|Horizontal|Vertical)?|border\w*(Width|Radius))$/;
const STEP: Record<string, number> = { opacity: 0.05, flex: 1 };
const MIN: Record<string, number> = { opacity: 0, fontSize: 1, borderWidth: 0 };

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
              Clic : l'élément tel qu'il est écrit dans l'écran · double-clic : entrer dans le composant · Alt+clic : l'élément exact.
              <br />
              Glissez un élément sur l'écran pour le déplacer.
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
            Pour ne changer que cet endroit, sélectionnez l'instance dans le fil d'Ariane.
          </p>
        )}

        {error && <p className="notice error">{error}</p>}
        {!inspect && !error && <p className="hint">Analyse du code…</p>}
        {inspect && (
          <Details
            key={inspect.loc}
            inspect={inspect}
            computed={info.computed}
            theme={theme}
            onEdit={onEdit}
            parent={info.ancestors[1] ?? null}
            onSelectParent={() => info.ancestors[1] && onSelectAncestor(info.ancestors[1].loc)}
          />
        )}
      </div>
    </aside>
  );
}

interface DetailsProps {
  inspect: InspectResult;
  computed: Record<string, string>;
  theme: ThemeInfo | null;
  onEdit: Props['onEdit'];
  /** L'instance qui englobe l'élément (là où se règlent ses props). */
  parent: { loc: string; name: string } | null;
  onSelectParent: () => void;
}

/** « colors : useTheme() (l. 7) · color : prop de AppText » */
function Origins({ origins, parent, onSelectParent }: { origins?: ValueOrigin[]; parent: DetailsProps['parent']; onSelectParent: () => void }) {
  if (!origins?.length) return null;
  const fromProp = origins.some((o) => o.kind === 'prop');
  return (
    <div className="origin-note">
      {origins.map((o, i) => (
        <span key={o.name}>
          {i > 0 && ' · '}
          <code>{o.name}</code> : {o.detail}
          {o.line ? <span className="muted"> (l. {o.line})</span> : null}
        </span>
      ))}
      {fromProp && parent && (
        <button className="link" onClick={onSelectParent} title="Les props se règlent sur l'instance qui utilise ce composant">
          Régler sur l'instance &lt;{parent.name}&gt; ↗
        </button>
      )}
    </div>
  );
}

function Details({ inspect, computed, theme, onEdit, parent, onSelectParent }: DetailsProps) {
  const { loc, name } = inspect;
  const sources = inspect.style.sources;
  const [target, setTarget] = useState<StyleTarget>(() => defaultTarget(sources));
  const [newKey, setNewKey] = useState('');

  useEffect(() => {
    // Après une édition, la source ciblée doit toujours exister.
    if (target.kind === 'stylesheet' && !sources.some((s) => s.ref === target.ref)) setTarget(defaultTarget(sources));
  }, [sources, target]);

  // Jetons utilisables ici, sous le nom par lequel ce fichier y accède (export ou alias du thème).
  const tokens = useMemo(() => {
    if (!theme) return [];
    const names = [theme.exportName, theme.alias].filter((n): n is string => Boolean(n) && inspect.scope.includes(n!));
    const via = names.includes(theme.alias ?? '') ? theme.alias! : names[0];
    if (!via) return [];
    return theme.tokens.map((t) => {
      const value = displayValue(t.value);
      return { path: `${via}.${t.path.split('.').slice(1).join('.')}`, value, hex: toHex(value) };
    });
  }, [theme, inspect.scope]);
  const colorTokens = tokens.filter((t) => t.hex);
  const tokenValue = (code: string) => tokens.find((t) => t.path === code)?.value;

  // Valeur effective (la dernière source l'emporte) et source d'origine de chaque clé.
  const merged = new Map<string, { value: SourceValue; from: string }>();
  for (const s of sources) for (const p of s.properties) if (!p.key.startsWith('...')) merged.set(p.key, { value: p.value, from: s.ref });
  const targetSource = sources.find((s) => (target.kind === 'instance' ? s.kind === 'inline' && s === sources[sources.length - 1] : s.ref === target.ref));
  const inTarget = new Set(targetSource?.properties.map((p) => p.key));

  const setStyle = (key: string, raw: string) => onEdit({ op: 'setStyle', loc, name, key, value: parseInput(raw, inspect.scope, { style: true }), target });
  const removeStyle = (key: string) => onEdit({ op: 'setStyle', loc, name, key, value: { kind: 'remove' }, target });

  const extraKeys = [...merged.keys()].filter((k) => !GROUPED.has(k));
  const isComponent = /^[A-Z]/.test(name) && !BUILTINS.test(name);

  const row = (key: string) => {
    const entry = merged.get(key);
    const text = displayValue(entry?.value);
    const effective = computed[COMPUTED_ALIAS[key] ?? key];
    const placeholder = effective && effective !== 'auto' && effective !== 'normal' ? effective : '';
    const token = entry && isToken(entry.value);
    const colorSource = token ? tokenValue(entry.value.code) ?? effective : text || effective;
    const hex = isColorKey(key) ? toHex(colorSource) : null;
    const overridden = entry && targetSource && entry.from !== targetSource.ref && target.kind === 'stylesheet';
    // Choix d'une liste : toujours une chaîne (fontWeight '600', pas 600) ; vide = retirer.
    const commitChoice = (v: string) => (v === '' ? removeStyle(key) : setStyle(key, `'${v}'`));

    let field: React.ReactNode;
    if (isColorKey(key)) {
      field = (
        <>
          <ColorInput value={hex ?? '#000000'} onCommit={(v) => setStyle(key, v)} />
          <CommitInput className={token ? 'token-value' : ''} value={text} placeholder={placeholder} onCommit={(v) => setStyle(key, v)} />
          <TokenPicker tokens={colorTokens} value={text} onPick={(path) => setStyle(key, path)} />
        </>
      );
    } else if (SEGMENTED[key] && !token) {
      field = <SegmentedField value={text} choices={SEGMENTED[key]} effective={effective} onCommit={commitChoice} />;
    } else if (SELECTS[key] && !token) {
      field = <SelectField value={text} choices={SELECTS[key]} placeholder={placeholder} onCommit={commitChoice} />;
    } else if (NUMERIC.test(key)) {
      field = (
        <NumberField
          className={token ? 'token-value' : ''}
          value={text}
          fallback={effective}
          step={STEP[key] ?? 1}
          min={MIN[key]}
          placeholder={placeholder}
          onCommit={(v) => setStyle(key, v)}
        />
      );
    } else {
      field = <CommitInput className={token ? 'token-value' : ''} value={text} placeholder={placeholder} onCommit={(v) => setStyle(key, v)} />;
    }

    return (
      <div key={key} className={`prop-row ${entry ? 'set' : ''}`} title={effective ? `Valeur effective : ${effective}` : undefined}>
        <label title={key}>{key}</label>
        <div className="prop-input">
          {field}
          {inTarget.has(key) ? (
            <button className="icon" title="Retirer" onClick={() => removeStyle(key)}>×</button>
          ) : entry ? (
            <span className={`origin ${overridden ? 'warn' : ''}`} title={`Défini par ${entry.from}`}>{entry.from === 'inline' ? 'inline' : entry.from.split('.').pop()}</span>
          ) : (
            <span className="origin" />
          )}
        </div>
        {entry?.value.origins && !token && <Origins origins={entry.value.origins} parent={parent} onSelectParent={onSelectParent} />}
        {entry?.value.origins && token && effective && (
          <div className="origin-note">
            = <code>{effective}</code> · {entry.value.origins.map((o) => `${o.name} : ${o.detail}`).join(' · ')}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
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
              <div className="computed-sources">
                <h4>Calculé à l'exécution</h4>
                {sources
                  .filter((s) => s.kind === 'unknown')
                  .map((s) => (
                    <div key={s.ref} className="computed-source">
                      <code>{s.ref}</code>
                      <Origins origins={s.origins} parent={parent} onSelectParent={onSelectParent} />
                    </div>
                  ))}
                <p className="hint small">Ces styles ne sont pas écrits ici : modifiez leur source, ou surchargez-les avec « Cet élément uniquement ».</p>
              </div>
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
