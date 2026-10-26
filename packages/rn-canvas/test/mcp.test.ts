import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleRpc, mcpTools } from '../src/server/mcp.ts';
import { Project } from '../src/server/project.ts';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-canvas-mcp-'));
  fs.mkdirSync(path.join(root, 'src/theme'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/theme/colors.ts'), `export const colors = { primary: '#C67C4E' };\n`);
  fs.writeFileSync(
    path.join(root, 'src/Screen.tsx'),
    `import { View, Text } from 'react-native';\nimport { colors } from './theme/colors';\n\nexport const Screen = () => (\n  <View>\n    <Text>Bonjour</Text>\n  </View>\n);\n`,
  );
  fs.writeFileSync(path.join(root, 'rn-canvas.json'), JSON.stringify({ theme: { file: 'src/theme/colors.ts', export: 'colors' } }));
  const project = new Project(root);
  const tools = mcpTools(project);
  let id = 0;
  const call = (name: string, args: Record<string, unknown> = {}) =>
    handleRpc(tools, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, '0.0.0') as {
      result: { content: { text: string }[]; isError?: boolean };
    };
  return { root, call, tools };
}

test('initialize, tools/list et notifications', () => {
  const { tools } = fixture();
  const init = handleRpc(tools, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, '1.2.3') as { result: { protocolVersion: string; serverInfo: { version: string } } };
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.version, '1.2.3');
  assert.equal(handleRpc(tools, { jsonrpc: '2.0', method: 'notifications/initialized' }, '0'), null);
  const list = handleRpc(tools, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, '0') as { result: { tools: { name: string }[] } };
  assert.ok(list.result.tools.some((t) => t.name === 'set_style'));
  const unknown = handleRpc(tools, { jsonrpc: '2.0', id: 3, method: 'nope' }, '0') as { error: { code: number } };
  assert.equal(unknown.error.code, -32601);
});

test('list_elements → set_style avec jeton → set_text', () => {
  const { root, call } = fixture();
  const outline = JSON.parse(call('list_elements', { file: 'src/Screen.tsx' }).result.content[0].text);
  assert.deepEqual(outline, [
    { loc: 'src/Screen.tsx:5:2', name: 'View', children: [{ loc: 'src/Screen.tsx:6:4', name: 'Text', text: 'Bonjour', children: [] }] },
  ]);
  call('set_style', { loc: 'src/Screen.tsx:6:4', name: 'Text', key: 'color', value: 'colors.primary' });
  call('set_text', { loc: 'src/Screen.tsx:6:4', name: 'Text', text: 'Salut' });
  assert.ok(fs.readFileSync(path.join(root, 'src/Screen.tsx'), 'utf8').includes('<Text style={{ color: colors.primary }}>Salut</Text>'));
});

test('les erreurs métier reviennent en isError, pas en exception', () => {
  const { call } = fixture();
  const res = call('set_text', { loc: 'src/Screen.tsx:99:0', name: 'Text', text: 'x' });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /Aucun élément/);
});
