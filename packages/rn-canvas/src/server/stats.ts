/**
 * Mémoire de tout ce que l'éditeur fait tourner : ce serveur, l'app (Expo, Metro) et le navigateur
 * des captures, soit l'arbre des processus lancés depuis celui-ci. Affichée en haut à droite de l'éditeur.
 */
import { execFile } from 'node:child_process';
import type { MemoryStats } from '../shared/protocol.ts';

const MB = 1024 * 1024;

export function memoryStats(): Promise<MemoryStats> {
  const own = Math.round(process.memoryUsage().rss / MB);
  if (process.platform === 'win32') return Promise.resolve({ total: own, server: own, app: null, captures: null });
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm='], { timeout: 5000, maxBuffer: 8 * MB }, (error, stdout) => {
      if (error) return resolve({ total: own, server: own, app: null, captures: null });
      const rows = stdout
        .split('\n')
        .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), kb: Number(m[3]), name: m[4] }));
      const children = new Map<number, typeof rows>();
      for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
      // Sous-arbre de chaque enfant direct : le navigateur des captures d'un côté, l'app de l'autre.
      const subtree = (pid: number): number => (children.get(pid) ?? []).reduce((sum, c) => sum + c.kb + subtree(c.pid), 0);
      let app = 0;
      let captures = 0;
      for (const child of children.get(process.pid) ?? []) {
        const kb = child.kb + subtree(child.pid);
        if (/chrom|edge|brave/i.test(child.name)) captures += kb;
        else app += kb;
      }
      const server = Math.round((rows.find((r) => r.pid === process.pid)?.kb ?? own * 1024) / 1024);
      resolve({ total: server + Math.round(app / 1024) + Math.round(captures / 1024), server, app: Math.round(app / 1024), captures: Math.round(captures / 1024) });
    });
  });
}
