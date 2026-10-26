'use strict';
// Pas de biométrie dans le canevas : l'app se comporte comme sur un appareil sans Face ID / empreinte.
const { createShim, tryLoad } = require('./_shim');

module.exports = createShim('expo-local-authentication', tryLoad(() => require('expo-local-authentication')), {
  hasHardwareAsync: async () => false,
  isEnrolledAsync: async () => false,
  supportedAuthenticationTypesAsync: async () => [],
  getEnrolledLevelAsync: async () => 0,
  authenticateAsync: async () => ({ success: false, error: 'not_available', warning: 'rn-canvas : biométrie indisponible sur le web' }),
  cancelAuthenticate: async () => {},
});
