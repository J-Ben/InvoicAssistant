/**
 * Moteur de captures : un Chrome sans fenêtre affiche les écrans un par un et en garde une image.
 *
 * Le canevas montre ces images ; seul l'écran sur lequel on travaille tourne en direct dans
 * l'éditeur. Au lieu d'une copie de l'app par écran dans le navigateur de l'utilisateur, il y en a
 * une ou deux, ici, hors de son navigateur, et les écrans sont affichés l'un après l'autre dans le
 * même onglet : le bundle de l'app n'est téléchargé et compilé qu'une fois.
 *
 * Les images sont gardées sur disque (node_modules/.cache/rn-canvas/snapshots) avec l'empreinte du
 * code de leur écran (voir deps.ts) : une image n'est refaite que si ce code a changé.
 */
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { SnapshotInfo, SnapshotState, SnapshotStatus, StoryEntry } from '../shared/protocol.ts';
import { Browser, engineUnavailable, findBrowser, type Page, sleep } from './cdp.ts';
import { DependencyGraph } from './deps.ts';
import type { Project } from './project.ts';
import { storyUrl } from '../shared/urls.ts';

/** Version du format des captures : la changer refait toutes les images. */
const FORMAT = 'v1';
/**
 * Onglets du navigateur des captures, une fois l'app compilée : chacun fait tourner une copie de
 * l'app (un cœur, quelques centaines de Mo). La moitié des cœurs, de 2 à 4.
 */
const CONCURRENCY = Math.min(4, Math.max(2, Math.floor(os.cpus().length / 2)));
const PIXEL_RATIO = 2;
/** Écran affiché et DOM immobile depuis ce délai : on capture. */
const QUIET = 600;
/**
 * Attente maximale d'un écran une fois l'app compilée, et du premier (compilation par Metro). Même
 * compilée, l'app d'un gros projet compile encore à la demande le code de chaque route (expo-router) :
 * plusieurs dizaines de secondes pour un écran jamais affiché.
 */
const MAX_WAIT = 60_000;
const COLD_WAIT = 240_000;
/** Navigateur des captures fermé après ce délai sans rien à capturer (il redémarre au besoin). */
const IDLE_CLOSE = 30_000;
/**
 * Délai pour qu'une page chargée réponde à une évaluation simple. Au premier écran, la page exécute
 * pour la première fois tout le code de l'app : plusieurs secondes sur un gros projet.
 */
const PING_WAIT = 5_000;
const COLD_PING_WAIT = 60_000;
/** Erreurs « Maximum update depth exceeded » au-delà desquelles l'écran est déclaré en boucle. */
const LOOP_ERRORS = 5;

export interface DeviceSize {
  width: number;
  height: number;
}

interface Entry {
  version: string;
  state: SnapshotState;
  message?: string;
}

type Notify = (event: string, data?: unknown) => void;

/** Onglet qui ne répond plus (écran qui bloque son JavaScript) : il est fermé, un neuf prend la suite. */
class StuckPage extends Error {}

/** `promise`, ou une erreur StuckPage au bout de `ms`. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StuckPage(`${what} : pas de réponse après ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Script posé dans chaque page avant l'app : relève ce que le runtime signale (écran affiché, erreur, boucle). */
const COLLECTOR = `(() => {
  const state = { shown: false, error: null, loops: 0 };
  window.__rncCapture = state;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'rn-canvas') return;
    if (data.type === 'tree' && data.tree && data.tree.length) state.shown = true;
    if (data.type === 'error') state.error = data.message;
  });
  const error = console.error;
  console.error = function (...args) {
    if (args.some((a) => String(a && a.message ? a.message : a).includes('Maximum update depth exceeded'))) state.loops++;
    return error.apply(this, args);
  };
})();`;

/** Attend que l'écran soit affiché et immobile (ou une erreur, ou le délai). */
const waiter = (max: number) => `new Promise((resolve) => {
  const start = Date.now();
  let last = Date.now();
  const observer = new MutationObserver(() => { last = Date.now(); });
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const finish = (state, message) => {
    observer.disconnect();
    const s = window.__rncCapture || {};
    resolve({ state, message: message || null, loops: s.loops || 0 });
  };
  const tick = () => {
    const s = window.__rncCapture || {};
    const now = Date.now();
    if (s.error) return finish('error', s.error);
    if (s.loops >= ${LOOP_ERRORS} && now - start > 2000) return finish('loop');
    const fonts = !document.fonts || document.fonts.status !== 'loading';
    const images = [...document.images].every((img) => img.complete);
    if (s.shown && fonts && images && now - last > ${QUIET}) return finish('ok');
    if (now - start > ${max}) return finish(s.shown ? 'ok' : 'empty');
    setTimeout(tick, 100);
  };
  tick();
})`;

export class SnapshotEngine {
  private readonly project: Project;
  private readonly notify: Notify;
  private readonly dir: string;
  private readonly indexFile: string;
  private readonly graph: DependencyGraph;
  private index: Record<string, Entry>;
  private device: DeviceSize | null = null;
  /** Empreinte actuelle du code de chaque écran. */
  private hashes = new Map<string, string>();
  private stories: StoryEntry[] = [];
  private queue: string[] = [];
  /** Écrans déjà retentés après une absence de réponse (une seule nouvelle tentative, en fin de file). */
  private retried = new Set<string>();
  private running = new Set<string>();
  private browser: Browser | null = null;
  private starting: Promise<void> | null = null;
  private warm = false;
  private stopped = false;
  private workers = 0;
  private reason: string | null;
  private saveTimer: NodeJS.Timeout | undefined;
  private changeTimer: NodeJS.Timeout | undefined;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(project: Project, notify: Notify) {
    this.project = project;
    this.notify = notify;
    this.dir = path.join(project.root, 'node_modules', '.cache', 'rn-canvas', 'snapshots');
    this.indexFile = path.join(this.dir, 'index.json');
    this.graph = new DependencyGraph(project.root);
    this.reason = engineUnavailable();
    try {
      this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      this.index = {};
    }
    this.refreshStories();
  }

  get available(): boolean {
    return this.reason === null;
  }

  private key(id: string, device: DeviceSize) {
    return `${device.width}x${device.height}|${id}`;
  }

  private file(key: string) {
    return path.join(this.dir, `${crypto.createHash('sha1').update(key).digest('hex')}.webp`);
  }

  /** Écrans du projet et empreinte de leur code ; à rappeler quand des fichiers changent. */
  refreshStories() {
    this.stories = this.project.stories().flatMap((g) => g.stories);
    const config = this.project.config.runtimeConfig;
    for (const story of this.stories) {
      this.hashes.set(story.id, this.graph.hash([story.file, config], `${FORMAT}|${PIXEL_RATIO}`));
    }
  }

  info(id: string, device: DeviceSize): SnapshotInfo {
    const entry = this.index[this.key(id, device)];
    const current = this.hashes.get(id);
    if (!entry) return { state: 'pending', version: null };
    const outdated = entry.version !== current;
    return { state: outdated ? 'stale' : entry.state, version: entry.version, ...(entry.message ? { message: entry.message } : {}) };
  }

  status(device: DeviceSize): SnapshotStatus {
    this.use(device);
    const items: Record<string, SnapshotInfo> = {};
    for (const story of this.stories) items[story.id] = this.info(story.id, device);
    return {
      engine: this.available,
      ...(this.reason ? { reason: this.reason } : {}),
      device: `${device.width}x${device.height}`,
      items,
      queued: this.queue.length + this.running.size,
      running: [...this.running].map((key) => key.slice(key.indexOf('|') + 1)),
    };
  }

  /** Image d'un écran (la dernière faite, même périmée). */
  image(id: string, device: DeviceSize): Buffer | null {
    const file = this.file(this.key(id, device));
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }

  /** Écrans visibles dans l'éditeur : capturés en premier. */
  prioritize(device: DeviceSize, ids: string[]) {
    this.use(device);
    const keys = ids.map((id) => this.key(id, device)).filter((key) => this.queue.includes(key));
    this.queue = [...keys, ...this.queue.filter((key) => !keys.includes(key))];
  }

  /** Refait les images de ces écrans (tous si `ids` est vide), même à jour. */
  refresh(device: DeviceSize, ids?: string[]) {
    this.use(device);
    for (const story of this.stories) {
      if (ids?.length && !ids.includes(story.id)) continue;
      const entry = this.index[this.key(story.id, device)];
      if (entry) entry.version = '';
    }
    this.schedule();
  }

  /** Fichier du projet modifié : les écrans qui en dépendent sont remis en file. */
  fileChanged(rel: string) {
    this.graph.invalidate(rel);
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.refreshStories();
      this.schedule();
    }, 400);
  }

  private use(device: DeviceSize) {
    if (this.device && this.device.width === device.width && this.device.height === device.height) return;
    this.device = { width: device.width, height: device.height };
    this.queue = [];
    this.schedule();
  }

  /** Met en file les écrans dont l'image manque ou est périmée, pour l'appareil affiché. */
  private schedule() {
    const device = this.device;
    if (!device || !this.available || this.stopped) return;
    const wanted = this.stories
      .filter((s) => {
        const entry = this.index[this.key(s.id, device)];
        return !entry || entry.version !== this.hashes.get(s.id);
      })
      .map((s) => this.key(s.id, device))
      .filter((key) => !this.running.has(key));
    // L'ordre déjà établi (priorités de l'éditeur) est gardé ; les nouveaux viennent après.
    this.queue = [...this.queue.filter((key) => wanted.includes(key)), ...wanted.filter((key) => !this.queue.includes(key))];
    if (this.queue.length) void this.pump();
  }

  /** Rien à capturer : le navigateur (plusieurs centaines de Mo) est rendu, puis relancé au besoin. */
  private closeWhenIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.workers > 0 || this.queue.length || this.starting || !this.browser || this.browser.closed) return;
      const browser = this.browser;
      this.browser = null;
      void browser.close();
    }, IDLE_CLOSE);
  }

  private async ensureBrowser(): Promise<void> {
    if (this.browser && !this.browser.closed) return;
    this.starting ??= (async () => {
      this.browser = await Browser.launch(findBrowser()!);
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async pump() {
    clearTimeout(this.idleTimer);
    while (this.workers < CONCURRENCY && this.queue.length) {
      this.workers++;
      void this.work().finally(() => {
        this.workers--;
        if (this.queue.length && !this.stopped) void this.pump();
        else if (this.workers === 0) this.closeWhenIdle();
      });
      // Avant que l'app soit compilée par Metro, un seul onglet : le second attendrait la même compilation.
      if (!this.warm) break;
    }
  }

  private async openPage(): Promise<Page> {
    const page = await this.browser!.newPage();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: COLLECTOR });
    // Chaque onglet se croit au premier plan (focus, minuteurs, animations à pleine vitesse).
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    return page;
  }

  private async work() {
    let page: Page | null = null;
    try {
      await this.ensureBrowser();
      await this.waitForApp();
      while (this.queue.length && !this.stopped) {
        page ??= await this.openPage();
        // L'autre onglet a pu vider la file pendant l'ouverture de celui-ci.
        const key = this.queue.shift();
        if (!key) break;
        let reached = false;
        try {
          reached = await this.capture(page, key);
        } catch (error) {
          if (!(error instanceof StuckPage)) throw error;
          // L'onglet ne répond plus : fermé (côté navigateur, ça marche même page bloquée), un neuf suit.
          void page.close();
          page = null;
        }
        // L'app n'est « chaude » (compilée par Metro) qu'après un écran qui a vraiment répondu : un premier
        // écran en échec pendant la compilation ne doit pas faire passer les suivants aux délais courts.
        if (!this.warm && reached) {
          this.warm = true;
          void this.pump();
        }
      }
      // Rien à faire : l'onglet ne doit pas continuer d'exécuter le dernier écran.
      if (page) await within(page.send('Page.navigate', { url: 'about:blank' }), 5000, 'Page vide').catch(() => {});
    } catch (error) {
      if (!this.stopped) {
        this.reason = this.browser?.closed ? `Navigateur des captures arrêté : ${(error as Error).message}` : this.reason;
        // Sur sa propre ligne : la barre de progression de Metro réécrit la ligne courante du terminal.
        console.error(`\n[rn-canvas] Captures : ${(error as Error).stack ?? (error as Error).message}`);
        this.notify('snapshots', { error: (error as Error).message });
      }
    } finally {
      if (page) await within(page.close(), 5000, 'Fermeture').catch(() => {});
    }
  }

  private async waitForApp() {
    for (let i = 0; !this.stopped; i++) {
      try {
        // Adresse légère du middleware rn-canvas (metro.cjs) : la page d'accueil de l'app déclencherait un
        // rendu serveur (expo-router en sortie static/server) à chaque essai, pendant la compilation.
        // Toute réponse (même 404, middleware absent) signifie qu'Expo écoute.
        const res = await fetch(new URL('/__rn-canvas', this.project.config.appUrl), { signal: AbortSignal.timeout(5000) });
        if (res.status < 500) return;
      } catch {
        // Expo démarre encore.
      }
      if (i === 0) this.notify('snapshots', { waiting: this.project.config.appUrl });
      await sleep(2000);
    }
  }

  /** Capture un écran ; vrai si la page a répondu (l'app est donc compilée et s'exécute). */
  private async capture(page: Page, key: string): Promise<boolean> {
    const device = this.device!;
    const id = key.slice(key.indexOf('|') + 1);
    const version = this.hashes.get(id);
    if (!version || !key.startsWith(`${device.width}x${device.height}|`)) return false;
    this.running.add(key);
    let reached = false;
    this.notify('snapshots', { running: id });
    try {
      // Même adresse que dans l'éditeur : un sous-domaine par écran, donc un stockage à lui. Sur une même
      // origine, deux onglets ne peuvent pas ouvrir la même base SQLite (OPFS) en même temps.
      const file = id.slice(0, id.lastIndexOf('#'));
      const url = new URL(storyUrl(this.project.config.appUrl, { id, file, exportName: id.slice(id.lastIndexOf('#') + 1) }, this.project.config.isolateStories));
      const origin = url.origin;
      // Chaque écran part d'un stockage vide, comme dans son sous-domaine de l'éditeur.
      await within(page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }), 10_000, 'Stockage').catch((error) => {
        if (error instanceof StuckPage) throw error;
      });
      await within(page.send('Emulation.setDeviceMetricsOverride', { width: device.width, height: device.height, deviceScaleFactor: PIXEL_RATIO, mobile: true }), 10_000, 'Taille');
      url.searchParams.set('rnc-capture', '1');
      const max = this.warm ? MAX_WAIT : COLD_WAIT;
      const loaded = new Promise<void>((resolve) => {
        const off = page.on('Page.loadEventFired', () => {
          off();
          resolve();
        });
      });
      // La page précédente peut être bloquée (boucle) : la quitter peut ne jamais aboutir.
      await within(page.send('Page.navigate', { url: url.toString() }), max, 'Chargement');
      await Promise.race([loaded, sleep(max)]);
      // Un écran qui bloque la page (boucle, calcul sans fin, mémoire) est écarté en quelques secondes,
      // pour ne pas retenir la file : il ne répond plus, ou ne répond pas avant la fin de l'attente.
      await within(page.evaluate('1'), this.warm ? PING_WAIT : COLD_PING_WAIT, 'Réponse de la page');
      const result = await Promise.race([
        page.evaluate<{ state: 'ok' | 'error' | 'loop' | 'empty'; message: string | null }>(waiter(max)),
        sleep(max + 5000).then(() => null),
      ]);
      if (!result) throw new StuckPage("pas de réponse pendant l'attente de l'affichage");
      reached = true;
      const shot = await within(page.send<{ data: string }>('Page.captureScreenshot', { format: 'webp', quality: 82 }), 20_000, 'Capture');
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file(key), Buffer.from(shot.data, 'base64'));
      const state: SnapshotState = result.state === 'empty' ? 'ok' : result.state;
      const message =
        result.state === 'loop'
          ? (result.message ?? 'Boucle de rendu (« Maximum update depth exceeded ») : un effet relance le rendu sans fin.')
          : result.state === 'empty'
            ? "Rien d'affiché après le délai : données vides ou redirection ?"
            : (result.message ?? undefined);
      this.retried.delete(key);
      this.index[key] = { version, state, ...(message ? { message } : {}) };
      this.save();
      this.notify('snapshot', { id, device: `${device.width}x${device.height}`, info: this.info(id, device) });
    } catch (error) {
      const stuck = error instanceof StuckPage;
      // Pas de réponse : souvent une machine chargée (compilation, autres onglets) plutôt qu'une boucle.
      // L'écran repasse une fois en fin de file avant d'être déclaré bloqué.
      if (stuck && !this.retried.has(key)) {
        this.retried.add(key);
        this.queue.push(key);
        throw error;
      }
      this.retried.delete(key);
      this.index[key] = stuck
        ? { version, state: 'loop', message: `L'écran ne répond plus (${(error as Error).message}) : boucle ou calcul sans fin ?` }
        : { version, state: 'error', message: `Capture impossible : ${(error as Error).message}` };
      this.save();
      this.notify('snapshot', { id, device: `${device.width}x${device.height}`, info: this.info(id, device) });
      if (stuck || this.browser?.closed) throw error;
    } finally {
      this.running.delete(key);
      // Code modifié pendant la capture : l'image faite est déjà périmée, l'écran repasse en file.
      if (this.hashes.get(id) !== version) this.schedule();
    }
    return reached;
  }

  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.indexFile, JSON.stringify(this.index));
    }, 500);
  }

  async close() {
    this.stopped = true;
    clearTimeout(this.idleTimer);
    this.queue = [];
    clearTimeout(this.saveTimer);
    if (Object.keys(this.index).length) {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.indexFile, JSON.stringify(this.index));
    }
    await this.browser?.close();
  }
}
