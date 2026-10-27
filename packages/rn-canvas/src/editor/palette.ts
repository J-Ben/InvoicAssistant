/**
 * Place de la palette contextuelle (réglages de la sélection) : à droite de l'écran, ou à gauche
 * s'il n'y a pas la place dans le canevas. Partagé entre la palette et le canevas, qui écarte les
 * écrans voisins du même côté.
 */
export const PALETTE_WIDTH = 236;
/** Espace entre l'écran et la palette, et entre la palette et l'écran voisin écarté. */
export const PALETTE_GAP = 16;

export type PaletteSide = 'right' | 'left';

export function paletteSide(frameLeft: number, frameRight: number, areaLeft: number, areaRight: number): PaletteSide {
  if (frameRight + PALETTE_GAP + PALETTE_WIDTH <= areaRight - 8) return 'right';
  if (frameLeft - PALETTE_GAP - PALETTE_WIDTH >= areaLeft + 8) return 'left';
  return 'right';
}
