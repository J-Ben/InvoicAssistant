import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, jsxElements } from '../src/server/ast.ts';
import { gradientOf } from '../src/server/inspect.ts';

const CODE = `import { LinearGradient } from 'expo-linear-gradient';
export const A = ({ tint, colors }) => (
  <View>
    <LinearGradient colors={['#FF0000', colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
    <View style={styles.card}>
      {tint && <LinearGradient colors={[tint, darken(tint)]} style={StyleSheet.absoluteFill} />}
      <Text>Carte</Text>
    </View>
    <LinearGradient colors={palette} start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }} />
    <Text>Sans dégradé</Text>
  </View>
);`;

test('dégradé : élément lui-même, calque de fond conditionnel, couleurs calculées, direction', () => {
  const src = parse(CODE, 'A.tsx');
  const [root, own, card, , , dynamic, plain] = jsxElements(src.ast);
  assert.equal(gradientOf(src, 'A.tsx', root), null);
  assert.equal(gradientOf(src, 'A.tsx', plain), null);

  const g = gradientOf(src, 'A.tsx', own)!;
  assert.equal(g.own, true);
  assert.equal(g.direction, 'horizontal');
  assert.deepEqual(g.stops!.map((s) => s.code), ["'#FF0000'", 'colors.primary']);

  const layer = gradientOf(src, 'A.tsx', card)!;
  assert.equal(layer.own, false);
  assert.equal(layer.loc, 'A.tsx:6:15');
  assert.equal(layer.direction, 'vertical');
  assert.deepEqual(layer.stops!.map((s) => s.code), ['tint', 'darken(tint)']);

  const custom = gradientOf(src, 'A.tsx', dynamic)!;
  assert.equal(custom.stops, null);
  assert.equal(custom.colorsCode, 'palette');
  assert.equal(custom.direction, 'custom');
});

test('expressions composées : valeurs simples, jetons, noms en portée, appels déjà présents', async () => {
  const { valueCode } = await import('../src/server/edit.ts');
  const src = parse(CODE, 'A.tsx');
  const scope = ['colors', 'tint', 'darken', 'styles'];
  const ok = (code: string) => valueCode(src, { kind: 'expression', code }, scope);
  assert.equal(ok("[colors.primary, '#FFF', tint + '70']"), "[colors.primary, '#FFF', tint + '70']");
  assert.equal(ok('{ x: 1, y: -0.5 }'), '{ x: 1, y: -0.5 }');
  assert.equal(ok('[tint, darken(tint)]'), '[tint, darken(tint)]');
  assert.throws(() => ok('[darken(colors.primary)]'), /non autorisée/);
  assert.throws(() => ok("[fetch('https://x')]"), /non autorisée/);
  assert.throws(() => ok('[(() => 1)()]'), /non autorisée/);
  assert.throws(() => ok('[secret]'), /pas accessible/);
  assert.throws(() => ok('{ [k]: 1 }'), /non autorisée/);
});
