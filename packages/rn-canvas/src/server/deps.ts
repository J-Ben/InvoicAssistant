/**
 * Empreinte du code d'un écran : son fichier canvas et tout ce qu'il importe, de proche en proche
 * (fichiers du projet seulement ; les paquets sont couverts par le fichier de verrouillage). Une
 * capture est à refaire quand l'empreinte change, et seulement dans ce cas : modifier un composant ne
 * refait que les captures des écrans qui l'utilisent.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRelative } from './setup.ts';

/** `import … from 'x'`, `export … from 'x'`, `import 'x'`, `require('x')`, `import('x')`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g;
const PLATFORM = ['.web.tsx', '.web.ts', '.web.jsx', '.web.js'];
const LOCKFILES = ['yarn.lock', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lockb', 'package.json'];

interface FileInfo {
  mtimeMs: number;
  size: number;
  hash: string;
  imports: string[];
}

export class DependencyGraph {
  private readonly root: string;
  private files = new Map<string, FileInfo | null>();

  constructor(root: string) {
    this.root = root;
  }

  /** Fichier modifié (ou supprimé) : relu au prochain calcul. */
  invalidate(rel: string) {
    this.files.delete(rel);
  }

  private info(rel: string): FileInfo | null {
    const abs = path.join(this.root, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      this.files.set(rel, null);
      return null;
    }
    const cached = this.files.get(rel);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
    const content = fs.readFileSync(abs);
    const info: FileInfo = { mtimeMs: stat.mtimeMs, size: stat.size, hash: crypto.createHash('sha1').update(content).digest('hex'), imports: [] };
    if (/\.(tsx?|jsx?|mjs|cjs)$/.test(rel)) {
      const code = content.toString('utf8');
      const seen = new Set<string>();
      for (const match of code.matchAll(SPECIFIER)) {
        const resolved = resolveRelative(this.root, rel, match[1]);
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        info.imports.push(resolved);
        // Variante web d'un fichier (Button.web.tsx) : c'est elle que Metro sert dans le canevas.
        const base = resolved.replace(/\.(tsx?|jsx?)$/, '');
        for (const ext of PLATFORM) if (fs.existsSync(path.join(this.root, base + ext))) info.imports.push(base + ext);
      }
    }
    this.files.set(rel, info);
    return info;
  }

  /** Fichiers atteints depuis `entries`, avec leur empreinte de contenu. */
  closure(entries: string[]): Map<string, string> {
    const out = new Map<string, string>();
    const stack = [...entries];
    while (stack.length) {
      const rel = stack.pop()!;
      if (out.has(rel)) continue;
      const info = this.info(rel);
      if (!info) continue;
      out.set(rel, info.hash);
      for (const next of info.imports) if (!out.has(next)) stack.push(next);
    }
    return out;
  }

  /** Empreinte combinée de `entries` et de ce qu'ils importent, plus le verrouillage des paquets et `salt`. */
  hash(entries: string[], salt: string): string {
    const h = crypto.createHash('sha1').update(salt);
    for (const [rel, hash] of [...this.closure(entries)].sort(([a], [b]) => a.localeCompare(b))) h.update(`${rel}\0${hash}\n`);
    for (const lock of LOCKFILES) {
      const info = this.info(lock);
      if (info) h.update(`${lock}\0${info.hash}\n`);
    }
    return h.digest('hex').slice(0, 16);
  }
}
