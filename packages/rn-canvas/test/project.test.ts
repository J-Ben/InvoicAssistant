import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Project } from '../src/server/project.ts';

const SCREEN = `import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export const Card = ({ title }: { title: string }) => {
    return (
        <View style={styles.card}>
            <Text style={[styles.title, { fontSize: 18 }]}>Bonjour</Text>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.card} />
            <Text>
                Plusieurs mots
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        padding: 16,
        backgroundColor: colors.surface,
    },
    title: {
        color: '#2D2D2D',
    },
});
`;

const COLORS = `export const colors = {
    primary: '#C67C4E',
    surface: '#FFFFFF',
};
`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-canvas-'));
  fs.mkdirSync(path.join(root, 'src/screens'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/theme'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/screens/Card.tsx'), SCREEN);
  fs.writeFileSync(path.join(root, 'src/theme/colors.ts'), COLORS);
  fs.writeFileSync(
    path.join(root, 'src/screens/Card.canvas.tsx'),
    `import { Card } from './Card';\nexport default { title: 'Carte', component: Card };\nexport const Default = { props: { title: 'A' } };\nexport const LongTitle = { props: { title: 'B' } };\n`,
  );
  fs.writeFileSync(path.join(root, 'rn-canvas.json'), JSON.stringify({ theme: { file: 'src/theme/colors.ts', export: 'colors' } }));
  const project = new Project(root);
  const read = (file = 'src/screens/Card.tsx') => fs.readFileSync(path.join(root, file), 'utf8');
  return { root, project, read };
}

const VIEW = 'src/screens/Card.tsx:7:8';
const TITLE = 'src/screens/Card.tsx:8:12';
const DYNAMIC = 'src/screens/Card.tsx:9:12';
const MULTILINE = 'src/screens/Card.tsx:11:12';

test('inspect résout les styles StyleSheet, les tableaux et les jetons', () => {
  const { project } = fixture();
  const view = project.inspect(VIEW, 'View');
  assert.equal(view.style.sources.length, 1);
  assert.deepEqual(
    { kind: view.style.sources[0].kind, ref: view.style.sources[0].ref, usages: view.style.sources[0].usages },
    { kind: 'stylesheet', ref: 'styles.card', usages: 2 },
  );
  assert.deepEqual(view.style.sources[0].properties.map((p) => [p.key, p.value.kind, p.value.code]), [
    ['padding', 'number', '16'],
    ['backgroundColor', 'expression', 'colors.surface'],
  ]);
  assert.ok(view.scope.includes('colors'));

  const title = project.inspect(TITLE, 'Text');
  assert.deepEqual(title.style.sources.map((s) => s.kind), ['stylesheet', 'inline']);
  assert.deepEqual(title.text, { editable: true, value: 'Bonjour', code: null });

  assert.deepEqual(project.inspect(DYNAMIC).text, { editable: false, value: null, code: 'title' });
  assert.equal(project.inspect(MULTILINE).text?.value, 'Plusieurs mots');
});

test('un emplacement ou un nom périmé est refusé (409)', () => {
  const { project } = fixture();
  assert.throws(() => project.inspect('src/screens/Card.tsx:7:9'), { status: 409 });
  assert.throws(() => project.inspect(VIEW, 'Text'), { status: 409 });
});

test('les chemins hors projet sont refusés', () => {
  const { project } = fixture();
  assert.throws(() => project.inspect('../etc/passwd:1:0'), { status: 403 });
  assert.throws(() => project.inspect('node_modules/x/index.js:1:0'), { status: 403 });
});

test('setStyle sur la feuille de style ne touche que la valeur', () => {
  const { project, read } = fixture();
  project.edit({ op: 'setStyle', loc: VIEW, name: 'View', key: 'padding', value: { kind: 'literal', value: 24 }, target: { kind: 'stylesheet', ref: 'styles.card' } });
  assert.equal(read(), SCREEN.replace('padding: 16', 'padding: 24'));
});

test('setStyle accepte un jeton en portée et refuse le reste', () => {
  const { project, read } = fixture();
  project.edit({ op: 'setStyle', loc: VIEW, name: 'View', key: 'backgroundColor', value: { kind: 'expression', code: 'colors.primary' }, target: { kind: 'stylesheet', ref: 'styles.card' } });
  assert.ok(read().includes('backgroundColor: colors.primary'));
  assert.throws(
    () => project.edit({ op: 'setStyle', loc: VIEW, name: 'View', key: 'color', value: { kind: 'expression', code: 'theme.x' }, target: { kind: 'instance' } }),
    /n'est pas accessible/,
  );
  assert.throws(
    () => project.edit({ op: 'setStyle', loc: VIEW, name: 'View', key: 'color', value: { kind: 'expression', code: 'alert(1)' }, target: { kind: 'instance' } }),
    /non autorisée/,
  );
});

test("setStyle sur l'instance ajoute une surcharge sans toucher au style partagé", () => {
  const { project, read } = fixture();
  const result = project.edit({ op: 'setStyle', loc: VIEW, name: 'View', key: 'margin', value: { kind: 'literal', value: 8 }, target: { kind: 'instance' } });
  assert.ok(read().includes('<View style={[styles.card, { margin: 8 }]}>'), read());
  assert.ok(read().includes('padding: 16'));
  assert.equal(result.loc, VIEW);

  // Sur un tableau qui finit par un objet : on modifie cet objet.
  project.edit({ op: 'setStyle', loc: TITLE, name: 'Text', key: 'fontSize', value: { kind: 'literal', value: 20 }, target: { kind: 'instance' } });
  project.edit({ op: 'setStyle', loc: TITLE, name: 'Text', key: 'color', value: { kind: 'literal', value: 'red' }, target: { kind: 'instance' } });
  assert.ok(read().includes(`{ fontSize: 20, color: 'red' }`), read());
  // Retirer les clés une à une, puis la dernière déballe le tableau.
  project.edit({ op: 'setStyle', loc: TITLE, name: 'Text', key: 'color', value: { kind: 'remove' }, target: { kind: 'instance' } });
  project.edit({ op: 'setStyle', loc: TITLE, name: 'Text', key: 'fontSize', value: { kind: 'remove' }, target: { kind: 'instance' } });
  assert.ok(read().includes('<Text style={styles.title}>Bonjour</Text>'), read());

  // Ajout dans un objet multi-ligne : même indentation, virgule finale respectée.
  project.edit({ op: 'setStyle', loc: VIEW, name: 'View', key: 'gap', value: { kind: 'literal', value: 4 }, target: { kind: 'stylesheet', ref: 'styles.card' } });
  assert.ok(read().includes('        backgroundColor: colors.surface,\n        gap: 4,\n    },'), read());
});

test('setText conserve la mise en forme et protège les caractères JSX', () => {
  const { project, read } = fixture();
  project.edit({ op: 'setText', loc: TITLE, name: 'Text', value: 'Salut' });
  assert.equal(read(), SCREEN.replace('>Bonjour<', '>Salut<'));

  project.edit({ op: 'setText', loc: MULTILINE, name: 'Text', value: 'Un seul' });
  assert.ok(read().includes('<Text>\n                Un seul\n            </Text>'));

  project.edit({ op: 'setText', loc: TITLE, name: 'Text', value: 'a {b}' });
  assert.ok(read().includes(`{'a {b}'}`), read());

  assert.throws(() => project.edit({ op: 'setText', loc: DYNAMIC, name: 'Text', value: 'x' }), /dynamique/);
});

test('setProp écrit des chaînes en attribut et le reste en expression', () => {
  const { project, read } = fixture();
  project.edit({ op: 'setProp', loc: VIEW, name: 'View', prop: 'testID', value: { kind: 'literal', value: 'card' } });
  project.edit({ op: 'setProp', loc: VIEW, name: 'View', prop: 'pointerEvents', value: { kind: 'literal', value: 'none' } });
  project.edit({ op: 'setProp', loc: TITLE, name: 'Text', prop: 'numberOfLines', value: { kind: 'literal', value: 2 } });
  assert.ok(read().includes('<View style={styles.card} testID="card" pointerEvents="none">'), read());
  assert.ok(read().includes('numberOfLines={2}'));
  project.edit({ op: 'setProp', loc: VIEW, name: 'View', prop: 'testID', value: { kind: 'remove' } });
  assert.ok(!read().includes('testID'));
  assert.throws(() => project.edit({ op: 'setProp', loc: VIEW, name: 'View', prop: 'style', value: { kind: 'remove' } }));
});

test("l'emplacement renvoyé suit l'élément quand une édition décale le code au-dessus", () => {
  const { project } = fixture();
  const file = 'src/screens/Above.tsx';
  fs.writeFileSync(
    path.join(project.root, file),
    `const styles = StyleSheet.create({\n  box: {\n    padding: 1,\n  },\n});\nexport const A = () => <View style={styles.box} />;\n`,
  );
  const result = project.edit({ op: 'setStyle', loc: `${file}:6:23`, name: 'View', key: 'margin', value: { kind: 'literal', value: 2 }, target: { kind: 'stylesheet', ref: 'styles.box' } });
  assert.equal(result.loc, `${file}:7:23`);
  assert.equal(project.inspect(result.loc!, 'View').style.sources[0].properties.length, 2);
});

test("un élément auto-fermant reçoit du texte", () => {
  const { project } = fixture();
  fs.writeFileSync(path.join(project.root, 'src/screens/Empty.tsx'), `export const A = () => <Text style={s} />;\n`);
  project.edit({ op: 'setText', loc: 'src/screens/Empty.tsx:1:23', name: 'Text', value: 'Salut' });
  assert.equal(fs.readFileSync(path.join(project.root, 'src/screens/Empty.tsx'), 'utf8'), `export const A = () => <Text style={s}>Salut</Text>;\n`);
});

test('thème : liste et modifie les jetons', () => {
  const { project, read } = fixture();
  const theme = project.theme();
  assert.deepEqual(theme?.tokens.map((t) => [t.path, t.value.value]), [
    ['colors.primary', '#C67C4E'],
    ['colors.surface', '#FFFFFF'],
  ]);
  project.edit({ op: 'setToken', path: 'colors.primary', value: { kind: 'literal', value: '#000000' } });
  assert.equal(read('src/theme/colors.ts'), COLORS.replace('#C67C4E', '#000000'));
  assert.throws(() => project.edit({ op: 'setToken', path: 'colors.nope', value: { kind: 'literal', value: '#000' } }), /introuvable/);
});

test('stories : découverte et manifeste', () => {
  const { project, root } = fixture();
  const [group] = project.stories();
  assert.equal(group.title, 'Carte');
  assert.deepEqual(group.stories.map((s) => [s.id, s.title]), [
    ['src/screens/Card.canvas.tsx#Default', 'Default'],
    ['src/screens/Card.canvas.tsx#LongTitle', 'Long Title'],
  ]);
  assert.equal(project.writeManifest(), true);
  assert.equal(project.writeManifest(), false);
  const manifest = fs.readFileSync(path.join(root, 'rn-canvas.stories.ts'), 'utf8');
  assert.ok(manifest.includes(`"src/screens/Card.canvas.tsx": () => require("./src/screens/Card.canvas.tsx")`));
  assert.ok(manifest.includes('config: undefined'));
  assert.ok(!manifest.includes('expo-router'));
});

test('manifeste : routeur expo-router référencé quand le projet en dépend', () => {
  const { project, root } = fixture();
  const pkgFile = path.join(root, 'package.json');
  const pkg = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : {};
  fs.writeFileSync(pkgFile, JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, 'expo-router': '~58.0.0' } }));
  project.writeManifest();
  assert.ok(fs.readFileSync(path.join(root, 'rn-canvas.stories.ts'), 'utf8').includes(`router: require('expo-router').router,`));
});

test('surcharge dans un tableau de styles multi-ligne : une ligne à part, virgule finale respectée', () => {
  const { project } = fixture();
  const file = 'src/screens/Multi.tsx';
  const code = `export const A = ({ style }) => (\n  <Text\n    style={[\n      base,\n      style,\n    ]}\n  />\n);\n`;
  fs.writeFileSync(path.join(project.root, file), code);
  project.edit({ op: 'setStyle', loc: `${file}:2:2`, name: 'Text', key: 'fontSize', value: { kind: 'literal', value: 22 }, target: { kind: 'instance' } });
  assert.equal(fs.readFileSync(path.join(project.root, file), 'utf8'), code.replace('      style,\n', '      style,\n      { fontSize: 22 },\n'));
});

test('jetons locaux au composant : acceptés sur l’élément, refusés (avec explication) dans StyleSheet.create', () => {
  const { project } = fixture();
  const file = 'src/screens/Themed.tsx';
  const code = `import { useTheme } from '../theme';\nexport const A = () => {\n  const { colors, spacing } = useTheme();\n  return <View style={styles.box} />;\n};\nconst styles = StyleSheet.create({ box: { gap: 1 } });\n`;
  fs.writeFileSync(path.join(project.root, file), code);
  const loc = `${file}:4:9`;
  assert.ok(project.inspect(loc, 'View').scope.includes('spacing'));
  project.edit({ op: 'setStyle', loc, name: 'View', key: 'gap', value: { kind: 'expression', code: 'spacing.md' }, target: { kind: 'instance' } });
  assert.ok(fs.readFileSync(path.join(project.root, file), 'utf8').includes('style={[styles.box, { gap: spacing.md }]}'));
  assert.throws(
    () => project.edit({ op: 'setStyle', loc, name: 'View', key: 'gap', value: { kind: 'expression', code: 'colors.bg' }, target: { kind: 'stylesheet', ref: 'styles.box' } }),
    /n'existe que dans le composant/,
  );
  project.edit({ op: 'setProp', loc, name: 'View', prop: 'tint', value: { kind: 'expression', code: 'colors.bg' } });
  assert.ok(fs.readFileSync(path.join(project.root, file), 'utf8').includes('tint={colors.bg}'));
});

test("addStory : nouvelle variante à partir d'une existante, avec le stockage capturé", () => {
  const { project, root } = fixture();
  const file = 'src/screens/Card.canvas.tsx';
  const result = project.edit({ op: 'addStory', file, base: 'Default', exportName: 'AvecDonnees', storage: { '@messages': '[{"id":"1"}]' } });
  assert.equal(result.loc, null);
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(code.endsWith(`export const AvecDonnees = {\n  ...Default,\n  storage: {\n    "@messages": "[{\\"id\\":\\"1\\"}]"\n  },\n};\n`), code);
  assert.ok(project.stories()[0].stories.some((s) => s.exportName === 'AvecDonnees'));
  assert.throws(() => project.edit({ op: 'addStory', file, base: 'Default', exportName: 'AvecDonnees', storage: {} }), /existe déjà/);
  assert.throws(() => project.edit({ op: 'addStory', file, base: 'Default', exportName: 'avec espace', storage: {} }), /invalide/);
  assert.throws(() => project.edit({ op: 'addStory', file: 'src/screens/Card.tsx', base: 'Default', exportName: 'X', storage: {} }), /canvas/);
  project.undo();
  assert.ok(!fs.readFileSync(path.join(root, file), 'utf8').includes('AvecDonnees'));
});

test('écran de composant : modale ouverte, rappels neutres, exemple du composant, pas d\'écrasement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rnc-modal-'));
  fs.mkdirSync(path.join(root, 'src/components'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rn-canvas.json'), JSON.stringify({ include: ['src', 'canvas'] }));
  fs.writeFileSync(
    path.join(root, 'src/components/PriceModal.tsx'),
    `interface PriceModalProps { visible: boolean; label: string; item: Item; onClose: () => void }\nexport function PriceModal(props: PriceModalProps) { return null; }\n`,
  );
  const project = new Project(root);
  const first = project.createComponentStory('src/components/PriceModal.tsx', 'PriceModal');
  assert.deepEqual(first, { story: 'canvas/components/PriceModal.canvas.tsx#Exemple', file: 'canvas/components/PriceModal.canvas.tsx', created: true });
  const code = fs.readFileSync(path.join(root, first.file), 'utf8');
  assert.ok(code.includes(`import { PriceModal } from "../../src/components/PriceModal";`));
  assert.ok(code.includes(`example: "PriceModal"`));
  assert.ok(code.includes('props: { visible: true, onClose: () => {} }'));
  assert.ok(code.includes('props attendues : label, item'));
  assert.ok(fs.readFileSync(path.join(root, 'rn-canvas.stories.ts'), 'utf8').includes('PriceModal.canvas.tsx'));
  assert.equal(project.createComponentStory('src/components/PriceModal.tsx', 'PriceModal').created, false);
  assert.throws(() => project.createComponentStory('src/components/PriceModal.tsx', 'Nope'), /introuvable/);
});
