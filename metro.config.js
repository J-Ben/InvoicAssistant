// withRnCanvas : dans le canevas uniquement, remplace les modules natifs sans version web.
const { getDefaultConfig } = require('expo/metro-config');
const { withRnCanvas } = require('rn-canvas/metro');

module.exports = withRnCanvas(getDefaultConfig(__dirname));
