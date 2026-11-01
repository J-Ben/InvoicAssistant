/**
 * Chrome sans fenêtre (headless), piloté par le protocole DevTools : sert au moteur de captures.
 *
 * Pas de dépendance (puppeteer…) : un navigateur Chromium déjà installé (Chrome, Chromium, Brave, Edge)
 * est lancé avec un profil temporaire, et piloté par le WebSocket intégré à Node (22 et plus).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAC_BROWSERS = ['Google Chrome', 'Chromium', 'Brave Browser', 'Microsoft Edge'].map((app) => `/Applications/${app}.app/Contents/MacOS/${app}`);
const LINUX_BROWSERS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser', 'microsoft-edge'];
const WINDOWS_BROWSERS = [
  'Google\\Chrome\\Application\\chrome.exe',
  'Chromium\\Application\\chrome.exe',
  'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'Microsoft\\Edge\\Application\\msedge.exe',
];

/** Navigateur Chromium à utiliser : `RN_CANVAS_CHROME`, sinon le premier trouvé. */
export function findBrowser(): string | null {
  const env = process.env.RN_CANVAS_CHROME;
  if (env) return fs.existsSync(env) ? env : null;
  if (process.platform === 'darwin') return MAC_BROWSERS.find((p) => fs.existsSync(p)) ?? null;
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
    for (const root of roots) for (const rel of WINDOWS_BROWSERS) if (fs.existsSync(path.join(root, rel))) return path.join(root, rel);
    return null;
  }
  for (const name of LINUX_BROWSERS) {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Pourquoi le moteur ne peut pas démarrer ; null s'il le peut. */
export function engineUnavailable(): string | null {
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'function') return `Node ${process.versions.node} n'a pas de WebSocket intégré : Node 22 ou plus est requis pour les captures.`;
  if (!findBrowser()) return 'Aucun navigateur Chromium trouvé (Chrome, Chromium, Brave, Edge) : indiquez-en un avec RN_CANVAS_CHROME=/chemin/vers/chrome.';
  return null;
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; method: string };
type Listener = (params: any, sessionId?: string) => void;

export class Browser {
  private ws!: WebSocket;
  private process!: ChildProcess;
  private profile!: string;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<Listener>>();
  closed = false;

  static async launch(executable: string): Promise<Browser> {
    const browser = new Browser();
    await browser.start(executable);
    return browser;
  }

  private async start(executable: string) {
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-canvas-chrome-'));
    const args = [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${this.profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--hide-scrollbars',
      // Les onglets de capture sont en arrière-plan : sans ces options, Chrome y ralentit les minuteurs
      // (jusqu'à un par minute), et l'attente d'un écran stable dépasse son délai sans raison.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=IntensiveWakeUpThrottling',
      '--mute-audio',
      // Mémoire : un écran qui s'emballe plante vite (tas JavaScript plafonné) au lieu de grimper à
      // plusieurs Go. (Pas de limite de processus de rendu : deux onglets dans le même processus, un écran
      // bloqué bloquerait aussi l'autre capture ; pas de --disable-gpu : les captures en sont ralenties.)
      '--js-flags=--max-old-space-size=512',
      'about:blank',
    ];
    this.process = spawn(executable, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    this.process.on('exit', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('Navigateur des captures arrêté.'));
      this.pending.clear();
    });
    // Le navigateur écrit son port de débogage dans le profil.
    const portFile = path.join(this.profile, 'DevToolsActivePort');
    const deadline = Date.now() + 20_000;
    while (!fs.existsSync(portFile) || fs.readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (this.closed) throw new Error('Le navigateur des captures a quitté au démarrage.');
      if (Date.now() > deadline) throw new Error('Le navigateur des captures ne répond pas.');
      await sleep(100);
    }
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('Connexion au navigateur des captures impossible.')), { once: true });
    });
    this.ws.addEventListener('message', (event) => this.onMessage(String(event.data)));
    this.ws.addEventListener('close', () => {
      this.closed = true;
    });
  }

  private onMessage(raw: string) {
    const message = JSON.parse(raw);
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method} : ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
  }

  send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Navigateur des captures arrêté.'));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method: string, listener: Listener): () => void {
    const set = this.listeners.get(method) ?? new Set();
    set.add(listener);
    this.listeners.set(method, set);
    return () => set.delete(listener);
  }

  /** Nouvel onglet, avec sa session (protocole « à plat »). */
  async newPage(): Promise<Page> {
    const { targetId } = await this.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    return new Page(this, targetId, sessionId);
  }

  async close() {
    const exited = this.process.exitCode !== null || this.process.signalCode !== null ? Promise.resolve() : new Promise<void>((resolve) => this.process.once('exit', () => resolve()));
    if (!this.closed) {
      try {
        await Promise.race([this.send('Browser.close'), sleep(2000)]);
      } catch {
        // Déjà arrêté.
      }
    }
    // Le navigateur écrit encore dans son profil en s'arrêtant : on attend sa sortie avant de l'effacer.
    if (!(await Promise.race([exited.then(() => true), sleep(3000).then(() => false)]))) {
      this.process.kill('SIGKILL');
      await Promise.race([exited, sleep(2000)]);
    }
    this.closed = true;
    try {
      fs.rmSync(this.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Profil temporaire : le système le videra.
    }
  }
}

export class Page {
  readonly browser: Browser;
  readonly targetId: string;
  readonly sessionId: string;

  constructor(browser: Browser, targetId: string, sessionId: string) {
    this.browser = browser;
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    return this.browser.send<T>(method, params, this.sessionId);
  }

  on(method: string, listener: (params: any) => void): () => void {
    return this.browser.on(method, (params, sessionId) => {
      if (sessionId === this.sessionId) listener(params);
    });
  }

  /** Évalue une expression (promesse attendue) et renvoie sa valeur. */
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value as T;
  }

  close() {
    return this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
