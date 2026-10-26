import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Project } from '../src/server/project.ts';

const APP_TEXT = `import React from 'react';
import { Text } from 'react-native';
import { useTheme } from '@shared/theme';
import { SIZES } from '../constants';

export function AppText({ children, variant = 'body1', color, style }: Props) {
  const { colors, typography } = useTheme();
  const extra = { fontSize: SIZES.md };
  return (
    <Text style={[typography[variant], { color: color ?? colors.text }, extra, style]}>{children}</Text>
  );
}
`;

test("l'origine des styles calculés est expliquée (prop, hook, variable, import)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-canvas-origins-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/AppText.tsx'), APP_TEXT);
  const result = new Project(root).inspect('src/AppText.tsx:10:4', 'Text');
  const sources = result.style.sources;

  assert.deepEqual(sources.map((s) => [s.kind, s.ref]), [
    ['unknown', 'typography[variant]'],
    ['inline', 'inline'],
    ['unknown', 'extra'],
    ['unknown', 'style'],
  ]);
  assert.deepEqual(sources[0].origins?.map((o) => [o.name, o.kind, o.detail, o.line]), [
    ['typography', 'hook', 'useTheme()', 7],
    ['variant', 'prop', 'prop de AppText', 6],
  ]);
  assert.deepEqual(sources[1].properties[0].value.origins?.map((o) => [o.name, o.kind]), [
    ['color', 'prop'],
    ['colors', 'hook'],
  ]);
  assert.deepEqual(sources[2].origins?.map((o) => [o.name, o.kind, o.detail]), [['extra', 'local', '{ fontSize: SIZES.md }']]);
  assert.deepEqual(sources[3].origins?.map((o) => [o.name, o.kind]), [['style', 'prop']]);
});
