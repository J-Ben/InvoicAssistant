/**
 * Branche git du projet, et passage d'une branche à l'autre depuis l'éditeur. Jamais avec des
 * modifications en cours : elles suivraient dans l'autre branche, ou bloqueraient le changement.
 */
import { execFile } from 'node:child_process';
import type { CommitInfo, GitInfo } from '../shared/protocol.ts';
import { SourceError } from './inspect.ts';

const git = (root: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile('git', args, { cwd: root, timeout: 15_000 }, (error, stdout, stderr) => {
      if (error) reject(new SourceError(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });

/** null : le projet n'est pas dans un dépôt git. */
export async function gitInfo(root: string): Promise<GitInfo | null> {
  try {
    await git(root, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return null;
  }
  const [branch, refs, status] = await Promise.all([
    git(root, ['branch', '--show-current']),
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    // Fichiers suivis modifiés seulement : un fichier non suivi n'empêche pas de changer de branche.
    git(root, ['status', '--porcelain', '--untracked-files=no']),
  ]);
  return {
    branch: branch.trim() || null,
    branches: refs.split('\n').filter(Boolean).sort(),
    changes: status.split('\n').filter(Boolean).map((line) => line.slice(3)),
  };
}

export async function switchBranch(root: string, name: string): Promise<GitInfo> {
  const info = await gitInfo(root);
  if (!info) throw new SourceError("Le projet n'est pas dans un dépôt git.");
  if (!info.branches.includes(name)) throw new SourceError(`Branche « ${name} » introuvable.`, 404);
  if (info.changes.length) {
    throw new SourceError(`${info.changes.length} fichier(s) modifié(s) : commitez ou mettez de côté vos changements avant de changer de branche.`, 409);
  }
  await git(root, ['switch', name]);
  return (await gitInfo(root))!;
}

/**
 * Nouvelle branche, et passage dessus. Depuis la branche actuelle, les modifications en cours la
 * suivent (le travail commencé part sur la nouvelle branche) ; depuis une autre base, il faut un
 * dépôt propre, comme pour changer de branche.
 */
export async function createBranch(root: string, name: string, base?: string): Promise<GitInfo> {
  const info = await gitInfo(root);
  if (!info) throw new SourceError("Le projet n'est pas dans un dépôt git.");
  try {
    await git(root, ['check-ref-format', '--branch', name]);
  } catch {
    throw new SourceError(`« ${name} » n'est pas un nom de branche valide.`);
  }
  if (name.startsWith('-')) throw new SourceError(`« ${name} » n'est pas un nom de branche valide.`);
  if (info.branches.includes(name)) throw new SourceError(`La branche « ${name} » existe déjà.`, 409);
  const from = base && base !== info.branch ? base : null;
  if (from && !info.branches.includes(from)) throw new SourceError(`Branche de départ « ${from} » introuvable.`, 404);
  if (from && info.changes.length) {
    throw new SourceError(`${info.changes.length} fichier(s) modifié(s) : partez de la branche actuelle (${info.branch ?? 'HEAD'}) pour les emporter, ou commitez-les d'abord.`, 409);
  }
  await git(root, from ? ['switch', '-c', name, from] : ['switch', '-c', name]);
  return (await gitInfo(root))!;
}

/** Derniers commits de la branche courante (vide hors dépôt git). */
export async function recentCommits(root: string, limit = 30): Promise<CommitInfo[]> {
  try {
    const out = await git(root, ['log', `-n${limit}`, '--date=iso-strict', '--name-only', '--format=%x1e%h%x1f%ad%x1f%an%x1f%s']);
    return out
      .split('\x1e')
      .filter((block) => block.trim())
      .map((block) => {
        const [head, ...rest] = block.split('\n');
        const [hash, date, author, subject] = head.split('\x1f');
        return { hash, date, author, subject, files: rest.map((f) => f.trim()).filter(Boolean) };
      });
  } catch {
    return [];
  }
}
