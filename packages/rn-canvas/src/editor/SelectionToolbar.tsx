import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditRequest, EditValue, Rect, StyleTarget, ThemeInfo } from '../shared/protocol.ts';
import type { Selection } from './App.tsx';
import { DIRECTIONS, gradientActions } from './Gradient.tsx';
import { ColorInput, CommitInput, numberOf } from './fields.tsx';
import { mergedStyle, targetSourceOf, tokensFor, type Token } from './styleModel.ts';
import { displayValue, isToken, parseInput, toHex } from './values.ts';
import { PALETTE_GAP, PALETTE_WIDTH, type PaletteSide, paletteSide } from './palette.ts';

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
}

const TEXT_NAMES = /Text|Title|Label|Heading|Caption|Paragraph/;
const WEIGHT_BOLD = 600;

/**
 * Palette contextuelle posée à côté de l'écran, à la hauteur de l'élément sélectionné : les
 * réglages courants sans passer par le panneau de droite (couleurs, dégradé, texte, rayon,
 * opacité). Elle ne masque jamais l'écran ; le canevas écarte l'écran voisin pour lui faire place.
 */
export function SelectionToolbar({ selection, rect, frame, theme, target, onEdit, onStyle, onMore }: Props) {
  const inspect = selection.inspect!;
  const computed = selection.info.computed;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; side: PaletteSide } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // Suit l'écran quand le canevas bouge (déplacement, zoom) : position relue à chaque image.
  useLayoutEffect(() => {
    let frameId = 0;
    const update = () => {
      const box = frame.getBoundingClientRect();
      const scale = box.width / (frame.offsetWidth || 1);
      const height = ref.current?.offsetHeight ?? 200;
      const area = document.querySelector('main.canvas')?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const side = paletteSide(box.left, box.right, area.left, area.right);
      const left = Math.max(area.left + 8, Math.min(side === 'right' ? box.right + PALETTE_GAP : box.left - PALETTE_GAP - PALETTE_WIDTH, area.right - PALETTE_WIDTH - 8));
      // À la hauteur de l'élément, sans dépasser l'écran ni le canevas.
      const wanted = box.top + rect.y * scale;
      const top = Math.max(area.top + 8, Math.min(wanted, box.bottom - height, area.bottom - height - 8));
      setPosition((p) => (p && p.side === side && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 ? p : { left, top, side }));
      frameId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frameId);
  }, [frame, rect]);

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

  const styleEditable = inspect.style.editable;
  // Élément écrit dans le fichier d'un composant (pas dans l'écran) : toutes ses instances changent.
  const screenFile = selection.info.ancestors[selection.info.ancestors.length - 1]?.loc.split(':')[0];
  const ownFile = inspect.loc.split(':')[0];
  const componentFile = screenFile && ownFile !== screenFile ? ownFile.split('/').pop() : null;
  const isText = inspect.text !== null || TEXT_NAMES.test(inspect.name) || merged.has('fontSize') || merged.has('color');
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

  const fontSize = number('fontSize');
  const weight = Number(written('fontWeight') || computed.fontWeight || 400);
  const align = written('textAlign').replace(/'/g, '') || computed.textAlign;
  const radius = number('borderRadius', 'borderTopLeftRadius');
  const opacity = numberOf(written('opacity')) ?? numberOf(computed.opacity) ?? 1;
  const direction = gradient ? DIRECTIONS.find((d) => d.value === gradient.direction) : undefined;

  return (
    <div
      ref={ref}
      className={`sel-palette ${position?.side ?? 'right'}`}
      style={position ? { left: position.left, top: position.top, width: PALETTE_WIDTH } : { visibility: 'hidden', width: PALETTE_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="sel-head">
        <strong title={inspect.loc}>{inspect.name}</strong>
        {componentFile && (
          <span className="sel-warn" title={`Élément défini dans ${componentFile} : le modifier ici change toutes les instances de ce composant. Pour ne changer que cet endroit, sélectionnez l'instance dans le fil d'Ariane (panneau de droite).`}>
            toutes les instances
          </span>
        )}
        {shared > 1 && (
          <span className="sel-warn" title="Le style modifié est partagé : la modification touche tous les éléments qui l'utilisent (changez la cible dans le panneau de droite).">
            partagé ×{shared}
          </span>
        )}
      </div>

      {!styleEditable && <p className="hint small">Style calculé : modifiable dans le code.</p>}

      {styleEditable && !gradient?.own && (
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

      {styleEditable && (
        <>
          <div className="sel-section">Forme</div>
          <div className="sel-row">
            <span className="sel-name">Rayon</span>
            <NumberInput value={Math.round(radius)} title="Rayon des coins (ou tirez les points dans les coins de l'élément)" onCommit={(v) => onStyle('borderRadius', { kind: 'literal', value: Math.max(0, v) })} />
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

      <button className="sel-more" title="Tous les réglages (panneau de droite)" onClick={onMore}>
        Tous les réglages ⋯
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
            <CommitInput className={isTokenText(value) ? 'token-value' : ''} value={value} placeholder="#RRGGBB ou jeton" onCommit={pick} />
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
