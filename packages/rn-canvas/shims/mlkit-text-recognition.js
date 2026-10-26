'use strict';
// Reconnaissance de texte : aucun texte détecté dans le canevas.
const { createShim } = require('./_shim');

const recognize = async () => ({ text: '', blocks: [] });
module.exports = createShim('@react-native-ml-kit/text-recognition', null, {
  default: { recognize },
  recognize,
  TextRecognitionScript: { LATIN: 'Latin', CHINESE: 'Chinese', DEVANAGARI: 'Devanagari', JAPANESE: 'Japanese', KOREAN: 'Korean' },
});
