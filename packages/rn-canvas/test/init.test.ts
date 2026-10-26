import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addBabelPlugin } from '../src/cli/patch.ts';

test('init ajoute le plugin en tête de plugins existants', () => {
  const code = `module.exports = function (api) {\n  return {\n    presets: ['babel-preset-expo'],\n    plugins: [\n      ['module-resolver', {}],\n      'react-native-reanimated/plugin',\n    ],\n  };\n};\n`;
  assert.equal(
    addBabelPlugin(code),
    code.replace("    plugins: [\n", "    plugins: [\n      // rn-canvas : actif seulement pour le bundle web de développement.\n      'rn-canvas/babel',\n"),
  );
});

test('init crée plugins après presets', () => {
  const code = `module.exports = function (api) {\n  api.cache(true);\n  return {\n    presets: ['babel-preset-expo'],\n  };\n};\n`;
  assert.ok(addBabelPlugin(code)!.includes("    presets: ['babel-preset-expo'],\n    plugins: ['rn-canvas/babel'],\n"), addBabelPlugin(code)!);
});

test('forme inconnue : pas de modification', () => {
  assert.equal(addBabelPlugin('module.exports = require("./shared-babel");'), null);
});
