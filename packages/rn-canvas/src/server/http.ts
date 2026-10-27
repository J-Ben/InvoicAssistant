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
import { SourceError } from './inspect.ts';
import type { Project } from './project.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  editorDir: string;
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
      if (url.pathname === '/api/flows' && req.method === 'GET') return send(res, 200, project.flows());
      if (url.pathname === '/api/history' && req.method === 'GET') return send(res, 200, project.history());
      if (url.pathname === '/api/undo' && req.method === 'POST') return send(res, 200, project.undo());
      if (url.pathname === '/api/redo' && req.method === 'POST') return send(res, 200, project.redo());

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
