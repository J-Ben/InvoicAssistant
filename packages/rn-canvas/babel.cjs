'use strict';
/**
 * Plugin Babel rn-canvas.
 *
 * Ajoute à chaque élément JSX du projet une prop `__rnc="fichier:ligne:colonne:Nom"`
 * qui permet à l'éditeur de retrouver l'élément dans le code source.
 *
 * Il ne s'active que pour le bundle web de développement (caller Expo `isDev` +
 * `platform === 'web'`) : les bundles natifs et de production ne sont pas touchés.
 * La valeur est une chaîne (primitive) pour ne pas casser `React.memo`.
 */
const path = require('path');

const PROP = '__rnc';

/** @param {import('@babel/core').ConfigAPI & { types: typeof import('@babel/types') }} api */
module.exports = function rnCanvasBabelPlugin(api, options = {}) {
  const t = api.types;
  const enabled =
    options.force === true ||
    api.caller((caller) => Boolean(caller && caller.isDev && caller.platform === 'web'));

  if (!enabled) return { name: 'rn-canvas', visitor: {} };

  return {
    name: 'rn-canvas',
    visitor: {
      JSXOpeningElement(nodePath, state) {
        const filename = state.file.opts.filename;
        if (!filename || filename.includes(`${path.sep}node_modules${path.sep}`)) return;

        const { node } = nodePath;
        const loc = nodePath.parent.loc;
        if (!loc) return;

        const name = jsxName(node.name);
        if (!name || name === 'Fragment' || name.endsWith('.Fragment')) return;
        if (node.attributes.some((a) => t.isJSXAttribute(a) && a.name.name === PROP)) return;

        const root = options.root || state.file.opts.root || state.cwd || process.cwd();
        const file = path.relative(root, filename).split(path.sep).join('/');
        const value = `${file}:${loc.start.line}:${loc.start.column}:${name}`;

        node.attributes.push(t.jsxAttribute(t.jsxIdentifier(PROP), t.stringLiteral(value)));
      },
    },
  };
};

function jsxName(name) {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return `${jsxName(name.object)}.${name.property.name}`;
  return null;
}
