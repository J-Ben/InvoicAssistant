import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyUrl } from '../src/editor/urls.ts';

const story = { id: 'canvas/Accueil.canvas.tsx#Actuel', file: 'canvas/Accueil.canvas.tsx', exportName: 'Actuel', title: 'Actuel' };

test('isolé : un sous-domaine de localhost stable par écran', () => {
  const url = new URL(storyUrl('http://localhost:8081', story, true));
  assert.match(url.hostname, /^accueil-actuel-[a-z0-9]+\.localhost$/);
  assert.equal(url.port, '8081');
  assert.equal(url.searchParams.get('rnc-story'), story.id);
  assert.equal(storyUrl('http://localhost:8081', story, true), storyUrl('http://localhost:8081', story, true));
  const other = storyUrl('http://localhost:8081', { ...story, id: 'canvas/Accueil.canvas.tsx#Vide', exportName: 'Vide' }, true);
  assert.notEqual(new URL(other).hostname, url.hostname);
});

test("non isolé, ou hôte autre que localhost : l'URL de l'app telle quelle", () => {
  assert.equal(new URL(storyUrl('http://localhost:8081', story, false)).hostname, 'localhost');
  assert.equal(new URL(storyUrl('http://192.168.1.10:8081', story, true)).hostname, '192.168.1.10');
});

test('génération : un autre sous-domaine (stockage neuf) pour le même écran', () => {
  const base = new URL(storyUrl('http://localhost:8081', story, true)).hostname;
  const next = new URL(storyUrl('http://localhost:8081', story, true, 1)).hostname;
  assert.match(next, /^accueil-actuel-[a-z0-9]+-g1\.localhost$/);
  assert.notEqual(next, base);
  assert.equal(storyUrl('http://localhost:8081', story, true, 0), storyUrl('http://localhost:8081', story, true));
});
