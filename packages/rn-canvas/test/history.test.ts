import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Project } from '../src/server/project.ts';

const CODE = `export const A = () => (\n  <View>\n    <Text>Un</Text>\n    <Text>Deux</Text>\n  </View>\n);\n`;
const F = 'src/A.tsx';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-canvas-history-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, F), CODE);
  return { project: new Project(root), read: () => fs.readFileSync(path.join(root, F), 'utf8'), write: (c: string) => fs.writeFileSync(path.join(root, F), c) };
}

test('annuler puis rétablir restaure le fichier à l’octet près, avec la bonne sélection', () => {
  const { project, read } = fixture();
  assert.deepEqual(project.history(), { undo: null, redo: null });

  const edit = project.edit({ op: 'setText', loc: `${F}:3:4`, name: 'Text', value: 'Premier' });
  assert.deepEqual(edit.history, { undo: 'texte de <Text>', redo: null });
  project.edit({ op: 'remove', loc: `${F}:4:4`, name: 'Text' });
  const afterBoth = read();

  const u1 = project.undo();
  assert.equal(u1.loc, `${F}:4:4`, "après annulation d'une suppression, l'élément est resélectionnable");
  assert.ok(read().includes('<Text>Deux</Text>'));
  project.undo();
  assert.equal(read(), CODE);
  assert.throws(() => project.undo(), /Rien à annuler/);

  project.redo();
  const r2 = project.redo();
  assert.equal(read(), afterBoth);
  assert.equal(r2.loc, null);
  assert.deepEqual(r2.history, { undo: 'suppression de <Text>', redo: null });
});

test('une nouvelle modification vide la pile « rétablir »', () => {
  const { project } = fixture();
  project.edit({ op: 'setText', loc: `${F}:3:4`, name: 'Text', value: 'A' });
  project.undo();
  assert.equal(project.history().redo, 'texte de <Text>');
  project.edit({ op: 'setProp', loc: `${F}:3:4`, name: 'Text', prop: 'numberOfLines', value: { kind: 'literal', value: 1 } });
  assert.equal(project.history().redo, null);
});

test('jamais d’écrasement d’un changement fait en dehors de l’éditeur', () => {
  const { project, read, write } = fixture();
  project.edit({ op: 'setText', loc: `${F}:3:4`, name: 'Text', value: 'A' });
  write(read() + '// modifié à la main\n');
  assert.throws(() => project.undo(), /modifié en dehors/);
  assert.ok(read().endsWith('// modifié à la main\n'));
  assert.equal(project.history().undo, null, 'l’historique devenu invalide est abandonné');
});

test('une modification refusée ne crée pas d’entrée', () => {
  const { project } = fixture();
  assert.throws(() => project.edit({ op: 'setText', loc: `${F}:9:9`, name: 'Text', value: 'x' }));
  assert.equal(project.history().undo, null);
});
