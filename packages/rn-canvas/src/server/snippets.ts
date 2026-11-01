/**
 * Briques à poser sur un écran depuis l'éditeur, comme les formes de Figma : une forme qui a déjà une
 * taille (une View vide en a zéro), une image des assets du projet, une icône, un interrupteur, et des
 * mises en page toutes faites (rangée, colonne, grille, rangée défilante, carte). Chacune donne son
 * JSX et ses imports ; les styles sont posés sur l'élément, à reprendre ensuite dans l'inspecteur.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { SnippetRequest } from '../shared/protocol.ts';
import { SourceError } from './inspect.ts';

export interface Snippet {
  jsx: string;
  imports: { name: string; from: string }[];
}

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const ASSET_DIRS = ['assets', 'src/assets', 'app/assets'];
const ICON_PACKAGE = '@expo/vector-icons';

/** Pastille grise de 120 × 120 : une View qui se voit. */
const box = (q: string, width = '120', height = '120') =>
  `<View style={{ width: ${width}, height: ${height}, borderRadius: 12, backgroundColor: ${q}#E5E5EA${q} }} />`;

export function snippet(root: string, file: string, request: SnippetRequest, q: string): Snippet {
  const rn = (...names: string[]) => names.map((name) => ({ name, from: 'react-native' }));
  switch (request.kind) {
    case 'box':
      return { jsx: box(q), imports: rn('View') };
    case 'switch':
      return { jsx: '<Switch value={true} />', imports: rn('Switch') };
    case 'image': {
      if (!request.asset || !IMAGE.test(request.asset)) throw new SourceError('Choisissez une image (png, jpg, webp, gif).');
      if (!fs.existsSync(path.join(root, request.asset))) throw new SourceError(`${request.asset} introuvable.`);
      let rel = path.posix.relative(path.posix.dirname(file), request.asset);
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return {
        jsx: `<Image source={require(${q}${rel}${q})} style={{ width: 160, height: 120, borderRadius: 12 }} resizeMode="cover" />`,
        imports: rn('Image'),
      };
    }
    case 'icon': {
      const name = request.icon ?? '';
      if (!iconNames(root)?.includes(name)) throw new SourceError(`Icône « ${name} » inconnue.`);
      return { jsx: `<Ionicons name="${name}" size={24} color="#1C1C1E" />`, imports: [{ name: 'Ionicons', from: ICON_PACKAGE }] };
    }
    case 'row':
      return {
        jsx: `<View style={{ flexDirection: ${q}row${q}, alignItems: ${q}center${q}, gap: 12 }}>\n  ${box(q, '64', '64')}\n  ${box(q, '64', '64')}\n</View>`,
        imports: rn('View'),
      };
    case 'column':
      return {
        jsx: `<View style={{ gap: 12 }}>\n  ${box(q, `${q}100%${q}`, '64')}\n  ${box(q, `${q}100%${q}`, '64')}\n</View>`,
        imports: rn('View'),
      };
    case 'grid': {
      const cell = box(q, `${q}47%${q}`, '120');
      return { jsx: `<View style={{ flexDirection: ${q}row${q}, flexWrap: ${q}wrap${q}, gap: 12 }}>\n  ${[cell, cell, cell, cell].join('\n  ')}\n</View>`, imports: rn('View') };
    }
    case 'chips': {
      const chip = (label: string) =>
        `<View style={{ paddingHorizontal: 16, height: 40, borderRadius: 20, backgroundColor: ${q}#FFFFFF${q}, justifyContent: ${q}center${q} }}>\n    <Text>${label}</Text>\n  </View>`;
      return {
        // flexGrow: 0 : sinon une ScrollView s'étire sur toute la hauteur restante du parent.
        jsx: `<ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>\n  ${['Option 1', 'Option 2', 'Option 3'].map(chip).join('\n  ')}\n</ScrollView>`,
        imports: rn('ScrollView', 'View', 'Text'),
      };
    }
    case 'gradient': {
      // expo-linear-gradient : le dégradé que l'éditeur sait déjà régler (couleurs, direction).
      try {
        createRequire(path.join(root, 'package.json')).resolve('expo-linear-gradient/package.json');
      } catch {
        throw new SourceError('Le dégradé utilise expo-linear-gradient, absent du projet : npx expo install expo-linear-gradient');
      }
      return {
        jsx: `<LinearGradient colors={[${q}#7C5CFF${q}, ${q}#4F9BFF${q}]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 160, borderRadius: 16 }} />`,
        imports: [{ name: 'LinearGradient', from: 'expo-linear-gradient' }],
      };
    }
    case 'card':
      return {
        jsx: `<View style={{ padding: 16, gap: 6, borderRadius: 20, backgroundColor: ${q}#FFFFFF${q}, shadowColor: ${q}#000000${q}, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>\n  <Text style={{ fontSize: 16, fontWeight: ${q}600${q} }}>Titre</Text>\n  <Text style={{ fontSize: 13, color: ${q}#8E8E93${q} }}>Sous-titre</Text>\n</View>`,
        imports: rn('View', 'Text'),
      };
    default:
      throw new SourceError('Brique inconnue.');
  }
}

/** Images du projet (dossiers d'assets usuels), pour la brique Image. */
export function projectImages(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= 300 || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory() && depth < 4) walk(child, depth + 1);
      else if (e.isFile() && IMAGE.test(e.name) && !/@[23]x\./.test(e.name)) out.push(child);
    }
  };
  for (const dir of ASSET_DIRS) walk(dir, 0);
  return out.sort();
}

/** Dossier où ranger une image importée : `assets/images` s'il existe, sinon le premier dossier d'assets. */
export function importImage(root: string, name: string, data: Buffer): string {
  if (!IMAGE.test(name)) throw new SourceError('Format accepté : png, jpg, webp, gif.');
  if (data.length > 10 * 1024 * 1024) throw new SourceError('Image trop lourde (10 Mo au plus).', 413);
  const dir = ['assets/images', 'src/assets/images', 'assets', 'src/assets'].find((d) => fs.existsSync(path.join(root, d))) ?? 'assets/images';
  const ext = path.extname(name).toLowerCase();
  const base = path
    .basename(name, path.extname(name))
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'image';
  let target = `${dir}/${base}${ext}`;
  for (let i = 2; fs.existsSync(path.join(root, target)); i++) target = `${dir}/${base}-${i}${ext}`;
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, target), data);
  return target;
}

const iconCache = new Map<string, Record<string, number> | null>();

/** Icônes Ionicons de @expo/vector-icons (nom → point de code de la police) ; null si le paquet n'est pas installé. */
export function iconGlyphs(root: string): Record<string, number> | null {
  if (iconCache.has(root)) return iconCache.get(root)!;
  let glyphs: Record<string, number> | null = null;
  try {
    const require = createRequire(path.join(root, 'package.json'));
    glyphs = require(`${ICON_PACKAGE}/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json`);
  } catch {
    glyphs = null;
  }
  iconCache.set(root, glyphs);
  return glyphs;
}

export const iconNames = (root: string): string[] | null => {
  const glyphs = iconGlyphs(root);
  return glyphs ? Object.keys(glyphs) : null;
};

/** Police Ionicons du projet (pour dessiner les icônes dans le sélecteur de l'éditeur). */
export function iconFont(root: string): string | null {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    return require.resolve(`${ICON_PACKAGE}/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf`);
  } catch {
    return null;
  }
}

/** Fichier image du projet à servir en aperçu : seulement une image, dans le projet, hors node_modules. */
export function imageFile(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep) || !IMAGE.test(abs) || abs.split(path.sep).includes('node_modules')) return null;
  return fs.existsSync(abs) ? abs : null;
}

/** Polices chargées par le projet (`useFonts({ … })`, `Font.loadAsync({ … })`), à proposer pour fontFamily. */
export function projectFonts(root: string, files: string[]): string[] {
  const fonts = new Set<string>();
  for (const file of files) {
    let code = '';
    try {
      code = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const match of code.matchAll(/(?:useFonts|loadAsync)\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      // `'Inter-Bold': require(…)`, `Inter_400Regular,` (raccourci des polices Google d'Expo).
      for (const key of match[1].matchAll(/(?:^|[,{\s])['"]?([A-Za-z][\w-]*)['"]?\s*(?=[:,}]|$)/gm)) fonts.add(key[1]);
    }
  }
  return [...fonts].filter((f) => f !== 'require').sort();
}
