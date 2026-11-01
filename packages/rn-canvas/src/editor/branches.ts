/** Types de branches gitflow, et branche de départ habituelle de chacun. */
export const BRANCH_TYPES: { prefix: string; label: string; base: string[] }[] = [
  { prefix: 'feature/', label: 'feature', base: ['develop', 'dev'] },
  { prefix: 'bugfix/', label: 'bugfix', base: ['develop', 'dev'] },
  { prefix: 'release/', label: 'release', base: ['develop', 'dev'] },
  { prefix: 'hotfix/', label: 'hotfix', base: ['main', 'master'] },
  { prefix: '', label: 'libre', base: [] },
];

/** « Écran d'accueil » → `ecran-d-accueil` : un morceau de nom de branche lisible. */
export const branchSlug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Branche de départ proposée : celle de gitflow si elle existe, sinon la branche actuelle. */
export const defaultBase = (prefix: string, branches: string[], current: string | null) =>
  BRANCH_TYPES.find((t) => t.prefix === prefix)?.base.find((b) => branches.includes(b)) ?? current ?? branches[0] ?? '';

/** Prévenir la barre du haut qu'une branche a changé (création depuis un autre endroit). */
export const GIT_CHANGED_EVENT = 'rn-canvas:git-changed';
