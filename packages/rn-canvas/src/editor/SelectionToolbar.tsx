import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditRequest, EditValue, Rect, StyleTarget, ThemeInfo } from '../shared/protocol.ts';
import type { Restack, Selection } from './App.tsx';
import { DIRECTIONS, gradientActions } from './Gradient.tsx';
import { ColorInput, CommitInput, type InstanceScope, InstanceSwitch, type Styleless, StylelessNotice, numberOf } from './fields.tsx';
import { mergedStyle, styleEntries, targetSourceOf, tokensFor, type Token } from './styleModel.ts';
import { SHADOWS, shadowEntries, shadowPreset } from './presets.ts';
import { IconPicker, ImagePicker } from './Bricks.tsx';
import { displayValue, isToken, parseInput, toHex } from './values.ts';
import { PALETTE_GAP, PALETTE_WIDE, PALETTE_WIDTH, type PaletteSide, paletteSide } from './palette.ts';

interface Props {
  selection: Selection;
  /** Zone de l'élément dans l'écran (coordonnées de l'iframe). */
  rect: Rect;
  frame: HTMLIFrameElement;
  theme: ThemeInfo | null;
  target: StyleTarget;
  onEdit: (request: EditRequest) => void | Promise<unknown>;
  /** Écrit une propriété de style (avec ses variantes plus précises). */
  onStyle: (key: string, value: EditValue) => void;
  /** Ouvre le panneau de droite sur la section Style. */
  onMore: () => void;
  /** Intégrée en haut du panneau de droite : pas de position flottante. */
  docked?: boolean;
  /** Tous les réglages, dépliés dans la palette flottante (panneau de droite fermé). */
  more?: React.ReactNode;
  /** Ouvrir le panneau de droite. */
  onOpenPanel?: () => void;
  /** Composant sans prop style : alerte à la place des réglages de style. */
  styleless?: Styleless | null;
  /** Élément d'un composant : bascule instance / toutes les instances. */
  instanceScope?: InstanceScope | null;
  /** Plans (zIndex) parmi les frères. */
  onRestack?: (how: Restack) => void;
}

const TEXT_NAMES = /Text|Title|Label|Heading|Caption|Paragraph/;
const ICON_NAMES = /Icon|Ionicons|MaterialIcons|MaterialCommunityIcons|Feather|FontAwesome\d?|AntDesign|Entypo|Octicons/;
type Kind = 'text' | 'image' | 'icon' | 'switch' | 'box';

const CORNER_KEYS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'];
const CORNER_SETS = {
  all: CORNER_KEYS,
  top: ['borderTopLeftRadius', 'borderTopRightRadius'],
  bottom: ['borderBottomLeftRadius', 'borderBottomRightRadius'],
};
const sameCorners = (a: string[], b: string[]) => a.length === b.length && a.every((c) => b.includes(c));

/** Chemin relatif de `from` (fichier) vers `to`, pour un `require` d'image. */
function relativePath(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const rel = [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}
const WEIGHT_BOLD = 600;

/**
 * Palette contextuelle posée à côté de l'écran, à la hauteur de l'élément sélectionné : les
 * réglages courants sans passer par le panneau de droite (couleurs, dégradé, texte, rayon,
 * opacité). Elle ne masque jamais l'écran ; le canevas écarte l'écran voisin pour lui faire place.
 */
export function SelectionToolbar({ selection, rect, frame, theme, target, onEdit, onStyle, onMore, docked = false, more, onOpenPanel, styleless, instanceScope, onRestack }: Props) {
  const [expanded, setExpanded] = useState(false);
  // Dépliée, la palette prend la largeur du panneau de droite (l'inspecteur complet y tient).
  const paletteWidth = expanded && more ? PALETTE_WIDE : PALETTE_WIDTH;
  const expandedRef = useRef(false);
  expandedRef.current = Boolean(expanded && more);
  const inspect = selection.inspect!;
  const computed = selection.info.computed;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; side: PaletteSide } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // Suit l'écran quand le canevas bouge (déplacement, zoom) : position relue à chaque image.
  useLayoutEffect(() => {
    if (docked) return;
    let frameId = 0;
    const update = () => {
      const box = frame.getBoundingClientRect();
      const scale = box.width / (frame.offsetWidth || 1);
      const height = ref.current?.offsetHeight ?? 200;
      const area = document.querySelector('main.canvas')?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const side = paletteSide(box.left, box.right, area.left, area.right);
      const width = expandedRef.current ? PALETTE_WIDE : PALETTE_WIDTH;
      const left = Math.max(area.left + 8, Math.min(side === 'right' ? box.right + PALETTE_GAP : box.left - PALETTE_GAP - width, area.right - width - 8));
      // À la hauteur de l'élément, sans dépasser l'écran ni le canevas.
      const wanted = box.top + rect.y * scale;
      const top = Math.max(area.top + 8, Math.min(wanted, box.bottom - height, area.bottom - height - 8));
      setPosition((p) => (p && p.side === side && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 ? p : { left, top, side }));
      frameId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frameId);
  }, [frame, rect, docked]);

  // Fermeture des menus au clic ailleurs ou avec Échap.
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

  const tokens = useMemo(() => tokensFor(theme, inspect.scope), [theme, inspect.scope]);
  const colorTokens = tokens.filter((t) => t.hex);
  const merged = mergedStyle(inspect.style.sources);
  const written = (key: string) => displayValue(merged.get(key)?.value);
  const shared = target.kind === 'stylesheet' ? (targetSourceOf(inspect.style.sources, target)?.usages ?? 1) : 1;

  const styleEditable = inspect.style.editable && !styleless;
  // Ce que l'élément est, pour ne proposer que ses réglages utiles (pas de texte sur une carte…).
  const kind: Kind = /^(Image|ImageBackground)$/.test(inspect.name)
    ? 'image'
    : ICON_NAMES.test(inspect.name)
      ? 'icon'
      : inspect.name === 'Switch'
        ? 'switch'
        : inspect.text !== null || TEXT_NAMES.test(inspect.name)
          ? 'text'
          : 'box';
  const isText = kind === 'text';
  const propValue = (prop: string) => displayValue(inspect.props.find((p) => p.name === prop)?.value);
  const setProp = (prop: string, value: EditValue) => onEdit({ op: 'setProp', loc: inspect.loc, name: inspect.name, prop, value });
  // Plusieurs propriétés en une écriture (une seule étape d'annulation).
  const setMany = (entries: [string, EditValue][]) =>
    onEdit({ op: 'setStyles', loc: inspect.loc, name: inspect.name, entries: entries.flatMap(([key, value]) => styleEntries(inspect, target, key, value)), target });
  const remove: EditValue = { kind: 'remove' };
  const lit = (value: string | number | boolean): EditValue => ({ kind: 'literal', value });
  // Position libre (position: 'absolute') : posée là où l'élément se trouve, à sa taille actuelle, pour
  // qu'il ne saute pas ; retirée, l'élément retourne dans le flux de son parent.
  const absolute = (written('position').replace(/['"]/g, '') || computed.position) === 'absolute';
  const toggleFree = () => {
    if (absolute) return setMany(['position', 'top', 'left', 'right', 'bottom'].map((key) => [key, remove] as [string, EditValue]));
    const offset = selection.info.offset ?? { left: 0, top: 0 };
    const keep = (key: 'width' | 'height'): [string, EditValue][] => (merged.has(key) ? [] : [[key, lit(Math.round(rect[key]))]]);
    return setMany([['position', lit('absolute')], ['left', lit(offset.left)], ['top', lit(offset.top)], ...keep('width'), ...keep('height')]);
  };
  const gradient = inspect.gradient;
  const grad = gradient ? gradientActions(gradient, computed.backgroundImage, inspect.scope, tokens, onEdit) : null;

  const colorOf = (key: string, fallback: string | undefined) => {
    const entry = merged.get(key);
    const token = entry && isToken(entry.value) ? tokens.find((t) => t.path === entry.value.code)?.value : null;
    const css = token ?? (entry?.value.kind === 'string' ? String(entry.value.value) : fallback);
    // Fond transparent (rgba(…, 0)) : pastille en damier plutôt qu'en noir.
    return css && /^rgba\(.*,\s*0\)$/.test(css.trim()) ? null : toHex(css);
  };
  const setColor = (key: string, raw: string) => onStyle(key, parseInput(raw, inspect.scope, { style: true }));
  const number = (key: string, computedKey = key) => numberOf(written(key)) ?? numberOf(computed[computedKey]) ?? 0;

  // Coins arrondis : les quatre (borderRadius), ou seulement certains (borderTopLeftRadius…). Les coins
  // choisis reçoivent le rayon, les autres repartent à zéro.
  const [corners, setCorners] = useState<string[]>(() => {
    const written = CORNER_KEYS.filter((c) => merged.has(c) && Number(displayValue(merged.get(c)?.value)) > 0);
    return written.length && !merged.has('borderRadius') ? written : [...CORNER_KEYS];
  });
  const setRadius = (value: number) => {
    if (corners.length === CORNER_KEYS.length) return setMany([['borderRadius', lit(value)], ...CORNER_KEYS.map((c): [string, EditValue] => [c, remove])]);
    setMany([['borderRadius', remove], ...CORNER_KEYS.map((c): [string, EditValue] => [c, corners.includes(c) ? lit(value) : remove])]);
  };
  const fontSize = number('fontSize');
  const weight = Number(written('fontWeight') || computed.fontWeight || 400);
  const align = written('textAlign').replace(/'/g, '') || computed.textAlign;
  const radius = number('borderRadius', 'borderTopLeftRadius');
  const opacity = numberOf(written('opacity')) ?? numberOf(computed.opacity) ?? 1;
  const direction = gradient ? DIRECTIONS.find((d) => d.value === gradient.direction) : undefined;

  return (
    <div
      ref={ref}
      className={docked ? 'sel-palette docked' : `sel-palette ${position?.side ?? 'right'} ${expanded && more ? 'expanded' : ''}`}
      style={docked ? undefined : position ? { left: position.left, top: position.top, width: paletteWidth } : { visibility: 'hidden', width: paletteWidth }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="sel-head">
        <strong title={inspect.loc}>{inspect.name}</strong>
        {shared > 1 && (
          <span className="sel-warn" title="Le style modifié est partagé : la modification touche tous les éléments qui l'utilisent (changez la cible dans le panneau de droite).">
            partagé ×{shared}
          </span>
        )}
        {onOpenPanel && (
          <button className="sel-open-panel" onClick={onOpenPanel} title="Ouvrir le panneau de droite (inspecteur complet)" aria-label="Ouvrir le panneau de droite">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M14.5 4.5v15" stroke="currentColor" strokeWidth="1.6" /></svg>
          </button>
        )}
      </div>

      {instanceScope && <InstanceSwitch value={instanceScope} />}
      {styleless && <StylelessNotice styleless={styleless} />}
      {!styleEditable && !styleless && <p className="hint small">Style calculé : modifiable dans le code.</p>}

      {styleEditable && !gradient?.own && kind === 'box' && (
        <div className="sel-row">
          <span className="sel-name">Fond</span>
          <ColorButton
            id="bg"
            open={open}
            setOpen={setOpen}
            title="Couleur de fond"
            color={colorOf('backgroundColor', computed.backgroundColor)}
            value={written('backgroundColor')}
            tokens={colorTokens}
            onPick={(raw) => setColor('backgroundColor', raw)}
            onRemove={merged.has('backgroundColor') ? () => onStyle('backgroundColor', { kind: 'remove' }) : undefined}
          />
        </div>
      )}

      {grad && (
        <div className="sel-row" title={gradient!.own ? 'Dégradé' : `Dégradé du calque de fond <${gradient!.name}>`}>
          <span className="sel-name">Dégradé</span>
          <span className="sel-inline">
            {grad.stops ? (
              grad.stops.map((stop, i) => (
                <ColorButton
                  key={i}
                  id={`stop-${i}`}
                  open={open}
                  setOpen={setOpen}
                  title={`Couleur ${i + 1} du dégradé`}
                  compact
                  color={grad.colorOf(stop, i)}
                  value={displayValue(stop)}
                  tokens={colorTokens}
                  onPick={(raw) => grad.setStop(i, raw)}
                />
              ))
            ) : (
              <span className="muted small">calculé</span>
            )}
            <button className="sel-btn" title={`Direction : ${direction?.label ?? 'personnalisée'} (clic : suivante)`} onClick={() => grad.cycleDirection()}>
              {direction?.short ?? '⤡'}
            </button>
          </span>
        </div>
      )}

      {styleEditable && isText && (
        <>
          <div className="sel-section">Texte</div>
          <div className="sel-row">
            <span className="sel-name">Couleur</span>
            <ColorButton
              id="color"
              open={open}
              setOpen={setOpen}
              title="Couleur du texte"
              color={colorOf('color', computed.color)}
              value={written('color')}
              tokens={colorTokens}
              onPick={(raw) => setColor('color', raw)}
              onRemove={merged.has('color') ? () => onStyle('color', { kind: 'remove' }) : undefined}
            />
          </div>
          <div className="sel-row">
            <span className="sel-name">Taille</span>
            <span className="sel-inline">
              <button className="sel-btn" title="Texte plus petit" onClick={() => onStyle('fontSize', { kind: 'literal', value: Math.max(1, Math.round(fontSize) - 1) })}>
                −
              </button>
              <NumberInput value={Math.round(fontSize)} title="Taille du texte" onCommit={(v) => onStyle('fontSize', { kind: 'literal', value: Math.max(1, v) })} />
              <button className="sel-btn" title="Texte plus grand" onClick={() => onStyle('fontSize', { kind: 'literal', value: Math.round(fontSize) + 1 })}>
                +
              </button>
            </span>
          </div>
          <div className="sel-row">
            <span className="sel-name">Style</span>
            <span className="sel-inline">
              <button
                className={`sel-btn ${weight >= WEIGHT_BOLD ? 'on' : ''}`}
                title="Gras"
                style={{ fontWeight: 800 }}
                onClick={() => onStyle('fontWeight', { kind: 'literal', value: weight >= WEIGHT_BOLD ? '400' : '700' })}
              >
                B
              </button>
              {(['left', 'center', 'right'] as const).map((a) => (
                <button
                  key={a}
                  className={`sel-btn ${align === a || (a === 'left' && (align === 'start' || !align)) ? 'on' : ''}`}
                  title={{ left: 'Aligné à gauche', center: 'Centré', right: 'Aligné à droite' }[a]}
                  onClick={() => onStyle('textAlign', { kind: 'literal', value: a })}
                >
                  {{ left: '⇤', center: '↔', right: '⇥' }[a]}
                </button>
              ))}
            </span>
          </div>
        </>
      )}

      {kind === 'icon' && (
        <>
          <div className="sel-section">Icône</div>
          <div className="sel-row">
            <span className="sel-name">Icône</span>
            <span className="sel-color">
              <button className={`sel-btn ${open === 'icon-pick' ? 'on' : ''}`} title="Changer d'icône" onClick={() => setOpen(open === 'icon-pick' ? null : 'icon-pick')}>
                <span className="sel-value">{propValue('name') || 'choisir'}</span>
              </button>
              {open === 'icon-pick' && (
                <div className="sel-popover sel-picker" role="dialog" aria-label="Changer d'icône">
                  <IconPicker
                    disabled={false}
                    onPick={(icon) => {
                      setProp('name', lit(icon));
                      setOpen(null);
                    }}
                  />
                </div>
              )}
            </span>
          </div>
          <div className="sel-row">
            <span className="sel-name">Taille</span>
            <NumberInput value={Number(propValue('size')) || 24} title="Taille de l'icône" onCommit={(v) => setProp('size', lit(Math.max(4, v)))} />
          </div>
          <div className="sel-row">
            <span className="sel-name">Couleur</span>
            <ColorButton
              id="icon-color"
              open={open}
              setOpen={setOpen}
              title="Couleur de l'icône"
              color={toHex(propValue('color')) ?? null}
              value={propValue('color')}
              tokens={colorTokens}
              onPick={(raw) => setProp('color', parseInput(raw, inspect.scope, { style: true }))}
            />
          </div>
        </>
      )}

      {kind === 'switch' && (
        <div className="sel-row">
          <span className="sel-name">Activé</span>
          <button className={`sel-btn ${propValue('value') === 'true' ? 'on' : ''}`} title="Valeur de l'interrupteur" onClick={() => setProp('value', lit(propValue('value') !== 'true'))}>
            {propValue('value') === 'true' ? 'Oui' : 'Non'}
          </button>
        </div>
      )}

      {kind === 'image' && (
        <>
          <div className="sel-section">Image</div>
          <div className="sel-row">
            <span className="sel-name">Ajuster</span>
            <span className="sel-inline">
              {(
                [
                  ['cover', 'Remplir', 'Remplit le cadre, quitte à couper l’image'],
                  ['contain', 'Contenir', 'Image entière, avec des bandes si besoin'],
                  ['stretch', 'Étirer', 'Déforme l’image pour remplir le cadre'],
                ] as const
              ).map(([mode, label, title]) => (
                <button key={mode} className={`sel-btn ${(propValue('resizeMode').replace(/'/g, '') || 'cover') === mode ? 'on' : ''}`} title={title} onClick={() => setProp('resizeMode', lit(mode))}>
                  {label}
                </button>
              ))}
            </span>
          </div>
          <div className="sel-row">
            <span className="sel-name">Fichier</span>
            <span className="sel-color">
              <button className={`sel-btn ${open === 'image-pick' ? 'on' : ''}`} title="Changer d'image (assets du projet, ou importer)" onClick={() => setOpen(open === 'image-pick' ? null : 'image-pick')}>
                <span className="sel-value">Changer…</span>
              </button>
              {open === 'image-pick' && (
                <div className="sel-popover sel-picker" role="dialog" aria-label="Changer d'image">
                  <ImagePicker
                    disabled={false}
                    onPick={(asset) => {
                      setProp('source', { kind: 'expression', code: `require('${relativePath(inspect.file, asset)}')` });
                      setOpen(null);
                    }}
                  />
                </div>
              )}
            </span>
          </div>
        </>
      )}

      {styleEditable && kind === 'box' && (
        <>
          <div className="sel-row">
            <span className="sel-name">Ombre</span>
            <select
              className="sel-select"
              title="Ombre portée"
              value={shadowPreset(written, (key) => merged.has(key))}
              onChange={(e) => onEdit({ op: 'setStyles', loc: inspect.loc, name: inspect.name, entries: shadowEntries(inspect, target, e.target.value), target })}
            >
              {SHADOWS.map((sh) => (
                <option key={sh.value} value={sh.value}>
                  {sh.label}
                </option>
              ))}
              <option value="custom" disabled>
                Personnalisée
              </option>
            </select>
          </div>
          <div className="sel-row">
            <span className="sel-name">Marge int.</span>
            <NumberInput value={Math.round(number('padding', 'paddingTop'))} title="Espace intérieur (padding)" onCommit={(v) => onStyle('padding', lit(Math.max(0, v)))} />
          </div>
        </>
      )}

      {styleEditable && (kind === 'box' || kind === 'image') && (
        <>
          <div className="sel-section">Taille</div>
          <div className="sel-shortcuts">
            <button className="sel-btn" title="Toute la largeur disponible (width: 100%)" onClick={() => setMany([['width', lit('100%')]])}>
              ↔ Largeur
            </button>
            <button
              className="sel-btn"
              title="Bord à bord : toute la largeur de l'écran, en annulant la marge intérieure du parent"
              onClick={() => setMany([['width', remove], ['alignSelf', lit('stretch')], ['marginHorizontal', rect.x > 0 ? lit(-Math.round(rect.x)) : remove]])}
            >
              ⇿ Bord à bord
            </button>
            <button className="sel-btn" title="Remplir la hauteur restante du parent (flex: 1)" onClick={() => setMany([['flex', lit(1)], ['height', remove]])}>
              ↕ Hauteur
            </button>
            <button className="sel-btn" title="Centrer dans le parent (alignSelf: center)" onClick={() => setMany([['alignSelf', lit('center')]])}>
              ◎ Centrer
            </button>
            <button className="sel-btn" title="Taille du contenu : sans largeur, hauteur ni flex imposés (flexGrow: 0 si l'élément s'étire, comme une ScrollView)" onClick={() => setMany([['width', remove], ['height', remove], ['flex', remove], ['flexGrow', Number(computed.flexGrow) > 0 || merged.has('flexGrow') ? lit(0) : remove], ['alignSelf', lit('flex-start')]])}>
              ⤡ Contenu
            </button>
          </div>
        </>
      )}

      {styleEditable && (
        <>
          <div className="sel-section">Position</div>
          <div className="sel-shortcuts">
            <button
              className={`sel-btn ${absolute ? 'on' : ''}`}
              title={
                absolute
                  ? "Position libre : glissez l'élément pour le placer au pixel près. Clic : le remettre dans le flux de son parent."
                  : "Sortir l'élément du flux (position: 'absolute') pour le placer où l'on veut ; il ne prend plus de place parmi ses frères."
              }
              onClick={toggleFree}
            >
              ⌖ {absolute ? 'Libre' : 'Position libre'}
            </button>
            {absolute && <span className="muted small sel-free-hint">Glissez l'élément pour le placer.</span>}
          </div>
          {selection.info.stack && onRestack && (
            <div className="sel-row">
              <span className="sel-name" title="Ordre d'affichage parmi les frères (zIndex)">Plan</span>
              <div className="sel-stack">
                <button className="sel-btn" title="Arrière-plan (⌥⌘[)" aria-label="Arrière-plan" onClick={() => onRestack('back')}>⤓</button>
                <button className="sel-btn" title="Reculer (⌘[)" aria-label="Reculer" onClick={() => onRestack('backward')}>↓</button>
                <button className="sel-btn" title="Avancer (⌘])" aria-label="Avancer" onClick={() => onRestack('forward')}>↑</button>
                <button className="sel-btn" title="Premier plan (⌥⌘])" aria-label="Premier plan" onClick={() => onRestack('front')}>⤒</button>
                <span className="muted small" title="zIndex">z {selection.info.stack.z}</span>
              </div>
            </div>
          )}
          {Number(written('elevation')) > 0 && (
            <p className="hint small">Sur Android, l'ombre (elevation) fait passer l'élément devant ses frères, quel que soit le plan.</p>
          )}
        </>
      )}

      {styleEditable && kind !== 'switch' && kind !== 'icon' && (
        <>
          <div className="sel-section">Forme</div>
          <div className="sel-row">
            <span className="sel-name">Rayon</span>
            <NumberInput value={Math.round(radius)} title="Rayon des coins choisis à droite (ou tirez les points dans les coins de l'élément)" onCommit={(v) => setRadius(Math.max(0, v))} />
          </div>
          <div className="sel-row">
            <span className="sel-name">Coins</span>
            <span className="sel-inline sel-corners">
              {(
                [
                  ['all', '▢', 'Les quatre coins'],
                  ['top', '◠', 'Les deux coins du haut'],
                  ['bottom', '◡', 'Les deux coins du bas'],
                ] as const
              ).map(([preset, icon, title]) => (
                <button key={preset} className={`sel-btn ${sameCorners(corners, CORNER_SETS[preset]) ? 'on' : ''}`} title={title} onClick={() => setCorners(CORNER_SETS[preset])}>
                  {icon}
                </button>
              ))}
              {CORNER_KEYS.map((corner, i) => (
                <button
                  key={corner}
                  className={`sel-btn ${corners.includes(corner) ? 'on' : ''}`}
                  title={`Coin ${['haut gauche', 'haut droit', 'bas gauche', 'bas droit'][i]}`}
                  onClick={() => setCorners(corners.includes(corner) ? corners.filter((c) => c !== corner) : [...corners, corner])}
                >
                  {['◜', '◝', '◟', '◞'][i]}
                </button>
              ))}
            </span>
          </div>
          <div className="sel-row">
            <span className="sel-name">Opacité</span>
            <NumberInput
              value={Math.round(opacity * 100)}
              suffix="%"
              step={10}
              title="Opacité"
              onCommit={(v) => onStyle('opacity', v >= 100 ? { kind: 'remove' } : { kind: 'literal', value: Math.max(0, Math.min(100, v)) / 100 })}
            />
          </div>
          <p className="hint small sel-tip">Marges, espacement, taille : tirez les poignées sur l'élément.</p>
        </>
      )}

      {more && expanded && <div className="sel-all">{more}</div>}
      <button className="sel-more" title={more ? 'Tous les réglages, ici dans la palette' : 'Tous les réglages (panneau de droite)'} onClick={more ? () => setExpanded(!expanded) : onMore}>
        {more && expanded ? 'Moins de réglages ▴' : 'Tous les réglages ⋯'}
      </button>
    </div>
  );
}

/** Pastille de couleur qui ouvre un menu : sélecteur, valeur, jetons du thème. */
function ColorButton({
  id,
  open,
  setOpen,
  title,
  icon,
  color,
  value,
  tokens,
  onPick,
  onRemove,
  compact,
}: {
  id: string;
  open: string | null;
  setOpen: (id: string | null) => void;
  title: string;
  icon?: string;
  /** Pastille seule, sans la valeur à côté (couleurs d'un dégradé). */
  compact?: boolean;
  color: string | null;
  value: string;
  tokens: Token[];
  onPick: (raw: string) => void;
  onRemove?: () => void;
}) {
  const pick = (raw: string) => {
    onPick(raw);
    setOpen(null);
  };
  return (
    <span className="sel-color">
      <button className={`sel-btn ${open === id ? 'on' : ''}`} title={value ? `${title} : ${value}` : title} onClick={() => setOpen(open === id ? null : id)}>
        {icon && <span className="sel-icon">{icon}</span>}
        <span className="sel-swatch" style={{ background: color ?? 'transparent' }} />
        {!compact && <span className={`sel-value ${isTokenText(value) ? 'token-value' : ''}`}>{value ? value.replace(/^[A-Za-z_$][\w$]*\./, '') : color ? color.toUpperCase() : 'aucune'}</span>}
      </button>
      {open === id && (
        <div className="sel-popover" role="dialog" aria-label={title}>
          <div className="sel-popover-row">
            <ColorInput value={color ?? '#000000'} onCommit={pick} />
            <CommitInput className={isTokenText(value) ? 'token-value' : ''} value={value} placeholder="#RRGGBB ou jeton" onCommit={pick} autoFocus />
          </div>
          {tokens.length > 0 && (
            <div className="sel-tokens">
              {tokens.map((t) => (
                <button key={t.path} className={`sel-token ${t.path === value ? 'on' : ''}`} title={`${t.path} · ${t.value}`} style={{ background: t.hex ?? undefined }} onClick={() => pick(t.path)} />
              ))}
            </div>
          )}
          {onRemove && (
            <button
              className="link"
              onClick={() => {
                onRemove();
                setOpen(null);
              }}
            >
              Retirer
            </button>
          )}
        </div>
      )}
    </span>
  );
}

const isTokenText = (value: string) => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(value);

/** Petit champ numérique : ↑/↓ (Maj ×10), Entrée pour écrire. */
function NumberInput({ value, onCommit, title, step = 1, suffix }: { value: number; onCommit: (value: number) => void; title: string; step?: number; suffix?: string }) {
  const [draft, setDraft] = useState(String(value));
  const timer = useRef(0);
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (text: string) => {
    window.clearTimeout(timer.current);
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
  };
  const nudge = (direction: 1 | -1, big: boolean) => {
    const next = (Number(draft) || 0) + direction * step * (big ? 10 : 1);
    setDraft(String(next));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit(String(next)), 450);
  };
  return (
    <label className="sel-number" title={title}>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft);
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
          }
        }}
      />
      {suffix && <span className="muted">{suffix}</span>}
    </label>
  );
}
