/**
 * Serveur local de l'éditeur : sert l'interface et l'API d'inspection/édition.
 *
 * Il n'écoute que sur la boucle locale et refuse les requêtes venant d'autres sites
 * (en-têtes Host/Origin), car il a le droit d'écrire dans le code du projet.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { EditRequest } from '../shared/protocol.ts';
import type { CreateRequest } from './create.ts';
import { createBranch, gitInfo, switchBranch } from './git.ts';
import { memoryStats } from './stats.ts';
import { iconFont, iconGlyphs, imageFile, importImage, projectFonts, projectImages } from './snippets.ts';
import { SourceError } from './inspect.ts';
import type { Project } from './project.ts';
import type { DeviceSize, SnapshotEngine } from './snapshots.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  editorDir: string;
  /** Moteur de captures (créé après le serveur, qui lui sert à prévenir l'éditeur). */
  snapshots?: { current: SnapshotEngine | null };
}

/** Taille d'appareil passée par l'éditeur (`w`, `h`), bornée. */
function deviceOf(source: { w?: unknown; h?: unknown }): DeviceSize {
  const width = Math.round(Number(source.w));
  const height = Math.round(Number(source.h));
  if (!(width >= 200 && width <= 2000 && height >= 200 && height <= 3000)) throw new SourceError('Taille d’appareil invalide.');
  return { width, height };
}

export interface CanvasServer {
  url: string;
  /** Prévient les éditeurs ouverts (Server-Sent Events). */
  notify(event: string, data?: unknown): void;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const MAX_BODY = 1024 * 1024;

export function startServer(project: Project, options: ServerOptions): Promise<CanvasServer> {
  const host = options.host ?? '127.0.0.1';
  const clients = new Set<http.ServerResponse>();
  const allowedHosts = new Set([`localhost:${options.port}`, `127.0.0.1:${options.port}`, `${host}:${options.port}`]);

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host ?? '')) return send(res, 403, { error: 'Hôte non autorisé.' });
      const origin = req.headers.origin;
      if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'Origine non autorisée.' });

      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/api/project' && req.method === 'GET') return send(res, 200, project.info());

      if (url.pathname === '/api/inspect' && req.method === 'GET') {
        const loc = url.searchParams.get('loc');
        if (!loc) throw new SourceError('Paramètre `loc` manquant.');
        return send(res, 200, project.inspect(loc, url.searchParams.get('name') ?? undefined));
      }

      if (url.pathname === '/api/edit' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new SourceError('Content-Type JSON attendu.', 415);
        const body = (await readJson(req)) as EditRequest;
        return send(res, 200, project.edit(body));
      }

      if (url.pathname === '/api/component-story' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new SourceError('Content-Type JSON attendu.', 415);
        const body = (await readJson(req)) as { file: string; name: string };
        return send(res, 200, project.createComponentStory(body.file, body.name));
      }
      // Création de composants et d'écrans : conventions du projet, aperçu des fichiers, création.
      if (url.pathname === '/api/create' && req.method === 'GET') return send(res, 200, project.createInfo());
      if ((url.pathname === '/api/create' || url.pathname === '/api/create/preview') && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new SourceError('Content-Type JSON attendu.', 415);
        const body = (await readJson(req)) as CreateRequest;
        const plan = url.pathname === '/api/create' ? project.create(body) : project.planCreate(body);
        return send(res, 200, { name: plan.name, main: plan.main, files: plan.files.map((f) => f.path), story: plan.story, importFrom: plan.importFrom });
      }
      // Briques de l'éditeur : images du projet (et import), icônes, polices chargées.
      if (url.pathname === '/api/assets' && req.method === 'GET') return send(res, 200, projectImages(project.root));
      if (url.pathname === '/api/assets' && req.method === 'POST') {
        const name = url.searchParams.get('name') ?? '';
        return send(res, 200, { path: importImage(project.root, name, await readBody(req, 10 * 1024 * 1024)) });
      }
      if (url.pathname === '/api/asset' && req.method === 'GET') {
        const file = imageFile(project.root, url.searchParams.get('path') ?? '');
        if (!file) return send(res, 404, { error: 'Image introuvable.' });
        res.writeHead(200, { 'Content-Type': `image/${path.extname(file).slice(1).replace('jpg', 'jpeg')}`, 'Cache-Control': 'no-cache' });
        return void fs.createReadStream(file).pipe(res);
      }
      if (url.pathname === '/api/icons' && req.method === 'GET') {
        const glyphs = iconGlyphs(project.root);
        if (!glyphs) return send(res, 200, { installed: false, icons: [] });
        const words = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const icons = Object.entries(glyphs)
          .filter(([n]) => words.every((w) => n.includes(w)))
          .slice(0, 180)
          .map(([name, code]) => ({ name, code }));
        return send(res, 200, { installed: true, icons });
      }
      if (url.pathname === '/api/icons/font' && req.method === 'GET') {
        const font = iconFont(project.root);
        if (!font) return send(res, 404, { error: 'Police d’icônes introuvable.' });
        res.writeHead(200, { 'Content-Type': 'font/ttf', 'Cache-Control': 'max-age=86400' });
        return void fs.createReadStream(font).pipe(res);
      }
      if (url.pathname === '/api/memory' && req.method === 'GET') return send(res, 200, await memoryStats());
      if (url.pathname === '/api/git' && req.method === 'GET') return send(res, 200, await gitInfo(project.root));
      if (url.pathname === '/api/git/switch' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new SourceError('Content-Type JSON attendu.', 415);
        const body = (await readJson(req)) as { branch?: unknown };
        return send(res, 200, await switchBranch(project.root, String(body.branch ?? '')));
      }
      if (url.pathname === '/api/git/branch' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new SourceError('Content-Type JSON attendu.', 415);
        const body = (await readJson(req)) as { name?: unknown; base?: unknown };
        return send(res, 200, await createBranch(project.root, String(body.name ?? '').trim(), body.base ? String(body.base) : undefined));
      }
      if (url.pathname === '/api/fonts' && req.method === 'GET') {
        // Les polices se chargent d'habitude dans l'entrée (App.tsx) ou le layout racine : dossiers du projet et entrées.
        const entries = ['App.tsx', 'App.jsx', 'App.js', 'index.ts', 'index.js'].filter((f) => fs.existsSync(path.join(project.root, f)));
        return send(res, 200, projectFonts(project.root, [...entries, ...project.sourceFiles((n) => /\.(tsx?|jsx?)$/.test(n))]));
      }
      if (url.pathname === '/api/board' && req.method === 'GET') return send(res, 200, project.board());
      if (url.pathname === '/api/board' && req.method === 'PUT') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new SourceError('Content-Type JSON attendu.', 415);
        return send(res, 200, project.saveBoard(await readJson(req)));
      }
      if (url.pathname === '/api/routes' && req.method === 'GET') return send(res, 200, project.missingRoutes());
      if (url.pathname === '/api/routes' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new SourceError('Content-Type JSON attendu.', 415);
        const body = (await readJson(req)) as { files?: string[] };
        return send(res, 200, project.generateRouteStories(Array.isArray(body.files) ? body.files : undefined));
      }
      if (url.pathname === '/api/flows' && req.method === 'GET') return send(res, 200, project.flows());
      if (url.pathname === '/api/history' && req.method === 'GET') return send(res, 200, project.history());
      if (url.pathname === '/api/undo' && req.method === 'POST') return send(res, 200, project.undo());
      if (url.pathname === '/api/redo' && req.method === 'POST') return send(res, 200, project.redo());

      const snapshots = options.snapshots?.current ?? null;
      if (url.pathname.startsWith('/api/snapshot') && !snapshots) return send(res, 200, { engine: false, reason: 'Captures désactivées (--no-snapshots).' });
      if (url.pathname === '/api/snapshots' && req.method === 'GET' && snapshots) {
        return send(res, 200, snapshots.status(deviceOf({ w: url.searchParams.get('w'), h: url.searchParams.get('h') })));
      }
      if (url.pathname === '/api/snapshots/priority' && req.method === 'POST' && snapshots) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new SourceError('Content-Type JSON attendu.', 415);
        const body = (await readJson(req)) as { w: number; h: number; ids?: unknown };
        snapshots.prioritize(deviceOf(body), Array.isArray(body.ids) ? body.ids.map(String) : []);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/snapshots/refresh' && req.method === 'POST' && snapshots) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new SourceError('Content-Type JSON attendu.', 415);
        const body = (await readJson(req)) as { w: number; h: number; ids?: unknown };
        snapshots.refresh(deviceOf(body), Array.isArray(body.ids) ? body.ids.map(String) : undefined);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/snapshot' && req.method === 'GET' && snapshots) {
        const image = snapshots.image(url.searchParams.get('id') ?? '', deviceOf({ w: url.searchParams.get('w'), h: url.searchParams.get('h') }));
        if (!image) return send(res, 404, { error: 'Pas encore de capture.' });
        // L'URL porte la version de l'image (`v`) : une nouvelle capture a une autre URL.
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': url.searchParams.get('v') ? 'private, max-age=31536000, immutable' : 'no-store' });
        return void res.end(image);
      }

      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connecté\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      if (req.method === 'GET') return serveStatic(res, options.editorDir, url.pathname);
      send(res, 404, { error: 'Introuvable.' });
    } catch (error) {
      const status = error instanceof SourceError ? error.status : 500;
      if (status >= 500) console.error('[rn-canvas]', error);
      send(res, status, { error: (error as Error).message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      resolve({
        url: `http://localhost:${options.port}`,
        notify(event, data = {}) {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          for (const client of clients) client.write(payload);
        },
        close: () =>
          new Promise<void>((done) => {
            for (const client of clients) client.end();
            server.close(() => done());
          }),
      });
    });
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Corps brut (import d'image), borné à `max` octets. */
function readBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new SourceError('Fichier trop volumineux.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new SourceError('Requête trop volumineuse.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new SourceError('JSON invalide.'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res: http.ServerResponse, dir: string, pathname: string): void {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(dir, rel);
  if (!file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // Application monopage : toute autre route renvoie l'interface.
    const index = path.join(dir, 'index.html');
    if (!fs.existsSync(index)) return send(res, 500, { error: "L'éditeur n'est pas construit (npm run build dans rn-canvas)." });
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    return void fs.createReadStream(index).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}
