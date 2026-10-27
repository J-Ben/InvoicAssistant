import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Project } from '../src/server/project.ts';

const SCREEN = `import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../components/Card';

export const Screen = () => {
    return (
        <View>
            <Text>Un</Text>
            <Text>Deux</Text>
            <View style={box}>
                <Card title="A" />
            </View>
            <View />
        </View>
    );
};
`;

const CARD = `import React from 'react';
import { View } from 'react-native';

interface BadgeProps {
    label: string;
    count: number;
    onPress: () => void;
    tone?: string;
}

export const Badge = ({ label }: BadgeProps) => <View />;
export const Card = ({ title }: { title: string }) => <View />;
export const helper = () => 1;
`;

const F = 'src/screens/Screen.tsx';
const ROOT = `${F}:7:8`;
const UN = `${F}:8:12`;
const DEUX = `${F}:9:12`;
const BOX = `${F}:10:12`;
const CARD_EL = `${F}:11:16`;
const EMPTY = `${F}:13:12`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-canvas-structure-'));
  fs.mkdirSync(path.join(root, 'src/screens'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/components'), { recursive: true });
  fs.writeFileSync(path.join(root, F), SCREEN);
  fs.writeFileSync(path.join(root, 'src/components/Card.tsx'), CARD);
  const project = new Project(root);
  return { project, read: () => fs.readFileSync(path.join(root, F), 'utf8') };
}

test('supprimer retire la ligne entière', () => {
  const { project, read } = fixture();
  const result = project.edit({ op: 'remove', loc: DEUX, name: 'Text' });
  assert.equal(result.loc, null);
  assert.equal(read(), SCREEN.replace('            <Text>Deux</Text>\n', ''));
});

test("la racine d'un composant ne peut pas être supprimée", () => {
  const { project } = fixture();
  assert.throws(() => project.edit({ op: 'remove', loc: ROOT, name: 'View' }), /enfant direct/);
});

test('dupliquer insère une copie juste après, sur sa propre ligne', () => {
  const { project, read } = fixture();
  const result = project.edit({ op: 'duplicate', loc: BOX, name: 'View' });
  assert.ok(read().includes(`            </View>\n            <View style={box}>\n                <Card title="A" />\n            </View>\n            <View />`), read());
  assert.equal(result.loc, `${F}:13:12`);
});

test('déplacer avant / après / dedans, avec réindentation', () => {
  {
    const { project, read } = fixture();
    const result = project.edit({ op: 'move', loc: DEUX, name: 'Text', target: UN, targetName: 'Text', position: 'before' });
    assert.ok(read().includes('            <Text>Deux</Text>\n            <Text>Un</Text>\n'), read());
    assert.equal(result.loc, `${F}:8:12`);
  }
  {
    const { project, read } = fixture();
    const result = project.edit({ op: 'move', loc: UN, name: 'Text', target: BOX, targetName: 'View', position: 'inside' });
    assert.ok(read().includes('                <Card title="A" />\n                <Text>Un</Text>\n            </View>'), read());
    assert.equal(result.loc, `${F}:11:16`);
  }
  {
    // Dans un élément auto-fermant : il est ouvert pour accueillir l'enfant.
    const { project, read } = fixture();
    project.edit({ op: 'move', loc: CARD_EL, name: 'Card', target: EMPTY, targetName: 'View', position: 'inside' });
    assert.ok(read().includes('            <View style={box}>\n            </View>\n            <View>\n                <Card title="A" />\n            </View>\n'), read());
  }
  {
    // Remonter d'un niveau : réindentation de 16 à 12 espaces.
    const { project, read } = fixture();
    project.edit({ op: 'move', loc: CARD_EL, name: 'Card', target: UN, targetName: 'Text', position: 'after' });
    assert.ok(read().includes('            <Text>Un</Text>\n            <Card title="A" />\n            <Text>Deux</Text>'), read());
  }
});

test('déplacer un élément dans lui-même est refusé', () => {
  const { project } = fixture();
  assert.throws(() => project.edit({ op: 'move', loc: BOX, name: 'View', target: CARD_EL, targetName: 'Card', position: 'after' }), /lui-même/);
});

test('bibliothèque : composants exportés et props obligatoires', () => {
  const { project } = fixture();
  const components = project.components();
  const badge = components.find((c) => c.name === 'Badge');
  assert.deepEqual(badge, {
    name: 'Badge',
    file: 'src/components/Card.tsx',
    group: 'components',
    props: [
      { name: 'label', type: 'string' },
      { name: 'count', type: 'number' },
      { name: 'onPress', type: 'function' },
    ],
  });
  assert.ok(!components.some((c) => c.name === 'helper' || c.name === 'Screen' && c.file === null));
  assert.ok(components.some((c) => c.name === 'View' && c.file === null));
});

test("insérer ajoute l'élément et son import", () => {
  const { project, read } = fixture();
  const result = project.edit({ op: 'insert', loc: BOX, name: 'View', position: 'inside', component: { name: 'Badge', file: 'src/components/Card.tsx' } });
  assert.ok(read().includes(`import { Card, Badge } from '../components/Card';`), read());
  assert.ok(read().includes('                <Badge label="Label" count={0} onPress={() => {}} />\n            </View>'), read());
  assert.equal(result.loc, `${F}:12:16`);

  project.edit({ op: 'insert', loc: UN, name: 'Text', position: 'after', component: { name: 'ScrollView', file: null } });
  assert.ok(read().includes(`import { View, Text, ScrollView } from 'react-native';`), read());
  assert.ok(read().includes('            <Text>Un</Text>\n            <ScrollView />\n'), read());
});

test('import : un composant déjà importé par un alias n\'est pas réimporté', async () => {
  const { ensureImport } = await import('../src/server/structure.ts');
  const { parse: parseCode } = await import('../src/server/ast.ts');
  const src = parseCode(`import { AppText } from '@presentation/components/atoms/AppText';\nexport const A = () => <AppText />;\n`, 'A.tsx');
  assert.deepEqual(ensureImport(src, 'AppText', '../src/presentation/components/atoms/AppText'), []);
  const other = parseCode(`import { AppText } from 'some-lib';\nexport const A = () => <AppText />;\n`, 'A.tsx');
  assert.throws(() => ensureImport(other, 'AppText', '../src/presentation/components/atoms/AppText'), /déjà défini/);
});

test('tsconfig : commentaires retirés sans toucher aux chaînes', async () => {
  const { stripJsonComments } = await import('../src/server/project.ts');
  const raw = `{ // racine\n  "paths": { "@app/*": ["./src/*"] }, /* bloc */ "include": ["**/*.ts"] }`;
  assert.deepEqual(JSON.parse(stripJsonComments(raw)), { paths: { '@app/*': ['./src/*'] }, include: ['**/*.ts'] });
});

test("indentation : les lignes ' * ' des commentaires de bloc sont ignorées", async () => {
  const { indentUnit } = await import('../src/server/structure.ts');
  assert.equal(indentUnit(`/**\n * Doc\n */\nconst A = () => (\n  <View>\n    <Text />\n  </View>\n);\n`), '  ');
});

test('JSX inséré : texte d\'exemple pour les composants de texte, props obligatoires remplies', async () => {
  const { componentJsx } = await import('../src/server/structure.ts');
  assert.equal(componentJsx('AppText', []), '<AppText>Nouveau texte</AppText>');
  assert.equal(componentJsx('Button', [{ name: 'label', type: 'string' }, { name: 'onPress', type: 'function' }]), '<Button label="Label" onPress={() => {}} />');
  assert.equal(componentJsx('Text', []), '<Text>Nouveau texte</Text>');
});

test('JSX inséré : enfants obligatoires', async () => {
  const { componentJsx } = await import('../src/server/structure.ts');
  assert.equal(componentJsx('AppText', [{ name: 'children', type: 'unknown' }]), '<AppText>Nouveau texte</AppText>');
  assert.equal(componentJsx('Card', [{ name: 'children', type: 'unknown' }, { name: 'title', type: 'string' }]), '<Card title="Title">{null}</Card>');
});
