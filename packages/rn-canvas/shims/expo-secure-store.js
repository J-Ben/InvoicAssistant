'use strict';
// Stockage « sécurisé » simulé dans le localStorage de l'écran (chaque écran a sa propre origine).
const { createShim, tryLoad } = require('./_shim');

const PREFIX = 'rn-canvas:secure-store:';
const storage = () => (typeof window !== 'undefined' && window.localStorage) || null;
const get = (key) => storage()?.getItem(PREFIX + key) ?? null;
const set = (key, value) => storage()?.setItem(PREFIX + key, String(value));
const remove = (key) => storage()?.removeItem(PREFIX + key);

module.exports = createShim('expo-secure-store', tryLoad(() => require('expo-secure-store')), {
  isAvailableAsync: async () => true,
  getItemAsync: async (key) => get(key),
  setItemAsync: async (key, value) => set(key, value),
  deleteItemAsync: async (key) => remove(key),
  getItem: get,
  setItem: set,
  canUseBiometricAuthentication: () => false,
});
