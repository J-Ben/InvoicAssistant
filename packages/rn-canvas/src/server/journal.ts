/**
 * Historique local du projet (node_modules/.cache/rn-canvas/journal.json, comme les captures) :
 * - les chargements : un enregistrement par lancement de l'éditeur (attente d'Expo, durée de la
 *   capture de chaque écran, écrans chargés en direct), pour comparer d'un lancement à l'autre ;
 * - les modifications faites depuis l'éditeur : modifications, annulations, créations, avec l'heure.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ChangeEntry, LoadSession, ScreenTiming } from '../shared/protocol.ts';

interface JournalData {
  sessions: LoadSession[];
  changes: ChangeEntry[];
}

const MAX_SESSIONS = 50;
const MAX_CHANGES = 2000;

export class Journal {
  private file: string;
  private data: JournalData;
  private session: LoadSession | null = null;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(root: string) {
    this.file = path.join(root, 'node_modules', '.cache', 'rn-canvas', 'journal.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<JournalData>;
      this.data = { sessions: Array.isArray(raw.sessions) ? raw.sessions : [], changes: Array.isArray(raw.changes) ? raw.changes : [] };
    } catch {
      this.data = { sessions: [], changes: [] };
    }
  }

  /** Nouveau lancement de l'éditeur : ses temps de chargement s'enregistrent à part. */
  startSession(version: string): void {
    const now = new Date().toISOString();
    this.session = { id: now, startedAt: now, updatedAt: now, version, device: null, appReadyMs: null, reused: 0, screens: [] };
    this.data.sessions.push(this.session);
    this.data.sessions = this.data.sessions.slice(-MAX_SESSIONS);
    this.save();
  }

  appReady(ms: number): void {
    if (!this.session || this.session.appReadyMs !== null) return;
    this.session.appReadyMs = ms;
    this.touch();
  }

  /** Captures déjà à jour au lancement (aucune attente pour elles). */
  reused(count: number, device: string): void {
    if (!this.session) return;
    this.session.reused = count;
    this.session.device = device;
    this.touch();
  }

  screen(timing: ScreenTiming): void {
    if (!this.session) return;
    this.session.screens.push(timing);
    this.touch();
  }

  change(entry: Omit<ChangeEntry, 'at'>): void {
    this.data.changes.push({ at: new Date().toISOString(), ...entry });
    if (this.data.changes.length > MAX_CHANGES) this.data.changes = this.data.changes.slice(-MAX_CHANGES);
    this.save();
  }

  sessions(): LoadSession[] {
    return [...this.data.sessions].reverse();
  }

  changes(limit = 300): ChangeEntry[] {
    return this.data.changes.slice(-limit).reverse();
  }

  private touch() {
    if (this.session) this.session.updatedAt = new Date().toISOString();
    this.save();
  }

  /** Écriture regroupée : une capture toutes les quelques secondes ne doit pas réécrire le fichier à chaque fois. */
  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 500);
    this.saveTimer.unref?.();
  }

  flush(): void {
    clearTimeout(this.saveTimer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch {
      // Dossier en lecture seule : l'historique reste en mémoire pour ce lancement.
    }
  }
}
