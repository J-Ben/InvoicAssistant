import type { EditRequest, GradientDirection, GradientInfo, SourceValue } from '../shared/protocol.ts';
import { type Choice, ColorInput, CommitInput, SegmentedField, TokenPicker } from './fields.tsx';
import { displayValue, isToken, parseInput, toHex } from './values.ts';

const DIRECTIONS: (Choice & { value: GradientDirection; angle: number; start: string; end: string })[] = [
  { value: 'vertical', label: 'De haut en bas', short: '↓', angle: 180, start: '{ x: 0, y: 0 }', end: '{ x: 0, y: 1 }' },
  { value: 'horizontal', label: 'De gauche à droite', short: '→', angle: 90, start: '{ x: 0, y: 0 }', end: '{ x: 1, y: 0 }' },
  { value: 'diagonal', label: 'En diagonale, vers le bas', short: '↘', angle: 135, start: '{ x: 0, y: 0 }', end: '{ x: 1, y: 1 }' },
  { value: 'diagonal-up', label: 'En diagonale, vers le haut', short: '↗', angle: 45, start: '{ x: 0, y: 1 }', end: '{ x: 1, y: 0 }' },
];

/** Couleurs d'un `linear-gradient(…)` calculé par le navigateur, dans l'ordre. */
export function renderedStops(css: string | undefined): string[] {
  if (!css) return [];
  return css.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi) ?? [];
}

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

interface Props {
  gradient: GradientInfo;
  /** `background-image` rendu (couleurs effectives, même calculées). */
  rendered: string | undefined;
  scope: string[];
  tokens: { path: string; value: string; hex: string | null }[];
  onEdit: (request: EditRequest) => void | Promise<unknown>;
}

/** Fond dégradé : couleurs (valeur, jeton du thème ou expression), ajout / retrait, direction. */
export function GradientSection({ gradient, rendered, scope, tokens, onEdit }: Props) {
  const { stops } = gradient;
  const live = renderedStops(rendered);
  const tokenValue = (code: string) => tokens.find((t) => t.path === code)?.value;
  const colorOf = (stop: SourceValue, i: number) =>
    (stop.kind === 'string' ? toHex(String(stop.value)) : isToken(stop) ? toHex(tokenValue(stop.code)) : null) ?? toHex(live[i]);

  const codeOf = (stop: SourceValue) => (stop.kind === 'string' ? quote(String(stop.value)) : stop.code);
  const writeStops = (codes: string[]) =>
    onEdit({ op: 'setProp', loc: gradient.loc, name: gradient.name, prop: 'colors', value: { kind: 'expression', code: `[${codes.join(', ')}]` } });
  const asCode = (raw: string): string | null => {
    const value = parseInput(raw, scope, { style: true });
    if (value.kind === 'expression') return value.code;
    if (value.kind === 'literal') return quote(String(value.value));
    return null;
  };
  const setStop = (index: number, raw: string) => {
    const code = asCode(raw);
    if (stops && code) writeStops(stops.map((s, i) => (i === index ? code : codeOf(s))));
  };
  const setDirection = async (value: string) => {
    const direction = DIRECTIONS.find((d) => d.value === value);
    if (!direction) return;
    await onEdit({ op: 'setProp', loc: gradient.loc, name: gradient.name, prop: 'start', value: { kind: 'expression', code: direction.start } });
    await onEdit({ op: 'setProp', loc: gradient.loc, name: gradient.name, prop: 'end', value: { kind: 'expression', code: direction.end } });
  };

  const direction = DIRECTIONS.find((d) => d.value === gradient.direction);
  const previewColors = stops ? stops.map((s, i) => colorOf(s, i) ?? '#cccccc') : live;
  const preview = direction && previewColors.length > 1 ? `linear-gradient(${direction.angle}deg, ${previewColors.join(', ')})` : rendered;

  return (
    <section className="section">
      <h3>Fond dégradé</h3>
      {!gradient.own && (
        <p className="hint small">
          Calque de fond <code>&lt;{gradient.name}&gt;</code> (l. {gradient.loc.split(':').slice(-2, -1)}) de cet élément.
        </p>
      )}
      {preview && <div className="gradient-preview" style={{ backgroundImage: preview }} />}
      {stops ? (
        <>
          {stops.map((stop, i) => {
            const text = displayValue(stop);
            const token = isToken(stop);
            const computed = stop.kind === 'expression' && !token;
            return (
              <div key={i} className="prop-row set" title={computed && live[i] ? `Valeur effective : ${live[i]}` : undefined}>
                <label>Couleur {i + 1}</label>
                <div className="prop-input">
                  <ColorInput value={colorOf(stop, i) ?? '#000000'} onCommit={(v) => setStop(i, v)} />
                  <CommitInput className={token || computed ? 'token-value' : ''} value={text} onCommit={(v) => setStop(i, v)} />
                  <TokenPicker tokens={tokens.filter((t) => t.hex)} value={text} onPick={(path) => setStop(i, path)} />
                  {stops.length > 2 ? (
                    <button className="icon" title="Retirer cette couleur" onClick={() => writeStops(stops.filter((_, j) => j !== i).map(codeOf))}>
                      ×
                    </button>
                  ) : (
                    <span className="origin" />
                  )}
                </div>
              </div>
            );
          })}
          <button className="add-stop" onClick={() => writeStops([...stops.map(codeOf), codeOf(stops[stops.length - 1])])}>
            + Ajouter une couleur
          </button>
        </>
      ) : (
        <>
          <p className="code">{gradient.colorsCode}</p>
          <p className="hint small">Couleurs calculées par le code : modifiables dans le code.</p>
        </>
      )}
      <div className="prop-row set">
        <label>Direction</label>
        <div className="prop-input">
          <SegmentedField value={gradient.direction === 'custom' ? '' : gradient.direction} choices={DIRECTIONS} onCommit={setDirection} />
        </div>
      </div>
      {gradient.direction === 'custom' && <p className="hint small">Direction personnalisée (start / end) : choisissez-en une pour la remplacer.</p>}
    </section>
  );
}
