import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Journal } from '../src/server/journal.ts';

test('historique : un lancement par session, temps des écrans, modifications, conservé sur disque', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rnc-journal-'));
  const first = new Journal(root);
  first.startSession('0.8.22');
  first.appReady(12_000);
  first.appReady(99_000);
  first.reused(3, '393x852');
  first.screen({ id: 'canvas/A.canvas.tsx#Actuel', ms: 4200, kind: 'capture', ok: true });
  first.screen({ id: 'canvas/B.canvas.tsx#Actuel', ms: 1800, kind: 'live', ok: true });
  first.change({ action: 'edit', label: 'Rayon 12', file: 'src/Card.tsx' });
  first.change({ action: 'undo', label: 'Rayon 12', file: 'src/Card.tsx' });
  first.flush();

  // Lancement suivant : l'historique précédent est relu, le nouveau lancement passe en tête.
  const second = new Journal(root);
  second.startSession('0.8.22');
  second.flush();
  const [latest, previous] = new Journal(root).sessions();
  assert.equal(latest.screens.length, 0);
  assert.equal(previous.appReadyMs, 12_000, 'seule la première réponse d’Expo compte');
  assert.equal(previous.reused, 3);
  assert.equal(previous.device, '393x852');
  assert.deepEqual(previous.screens.map((s) => [s.kind, s.ms]), [['capture', 4200], ['live', 1800]]);
  assert.deepEqual(new Journal(root).changes().map((c) => c.action), ['undo', 'edit']);
});
