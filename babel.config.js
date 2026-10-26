module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Ne s'active que pour le bundle web de développement.
    plugins: ['rn-canvas/babel'],
  };
};
