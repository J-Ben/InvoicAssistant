import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const plugin = require('../babel.cjs');

const root = path.resolve('/projet');
const transform = (code: string, caller: Record<string, unknown>, filename = path.join(root, 'src/Screen.tsx')) =>
  babel.transformSync(code, {
    filename,
    root,
    babelrc: false,
    configFile: false,
    caller: { name: 'test', ...caller },
    plugins: [plugin, ['@babel/plugin-syntax-typescript', { isTSX: true }]],
  }).code as string;

const SOURCE = `const A = () => (\n  <View>\n    <Text.Inner>Salut</Text.Inner>\n    <>\n      <Image />\n    </>\n  </View>\n);`;

test('instrumente chaque élément JSX en développement web', () => {
  const out = transform(SOURCE, { isDev: true, platform: 'web' });
  assert.ok(out.includes('__rnc="src/Screen.tsx:2:2:View"'), out);
  assert.ok(out.includes('__rnc="src/Screen.tsx:3:4:Text.Inner"'), out);
  assert.ok(out.includes('__rnc="src/Screen.tsx:5:6:Image"'), out);
  assert.equal((out.match(/__rnc=/g) ?? []).length, 3, 'les fragments ne sont pas instrumentés');
});

test('ne touche ni au natif, ni à la production, ni à node_modules', () => {
  assert.ok(!transform(SOURCE, { isDev: true, platform: 'ios' }).includes('__rnc'));
  assert.ok(!transform(SOURCE, { isDev: false, platform: 'web' }).includes('__rnc'));
  const lib = transform(SOURCE, { isDev: true, platform: 'web' }, path.join(root, 'node_modules/lib/index.js'));
  assert.ok(!lib.includes('__rnc'));
});
