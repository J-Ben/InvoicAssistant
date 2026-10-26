'use strict';
// expo-file-system/legacy dans le canevas : mêmes fichiers en mémoire que l'API moderne.
const { createShim } = require('./_shim');
const { memory, nameOf } = require('./_memory-fs');

const documentDirectory = 'file:///rn-canvas/document/';
const cacheDirectory = 'file:///rn-canvas/cache/';

module.exports = createShim('expo-file-system/legacy', null, {
  documentDirectory,
  cacheDirectory,
  bundleDirectory: 'file:///rn-canvas/bundle/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  getInfoAsync: async (uri) => ({ exists: memory.has(uri), isDirectory: false, uri, size: (memory.readFile(uri) ?? '').length, modificationTime: memory.mtime(uri) }),
  readAsStringAsync: async (uri) => memory.readFile(uri) ?? '',
  writeAsStringAsync: async (uri, content) => memory.writeFile(uri, String(content)),
  deleteAsync: async (uri) => memory.remove(uri),
  makeDirectoryAsync: async (uri) => memory.makeDir(uri),
  readDirectoryAsync: async (uri) => memory.children(uri).map((c) => nameOf(c.uri)),
  copyAsync: async ({ from, to }) => memory.writeFile(to, memory.readFile(from) ?? from),
  moveAsync: async ({ from, to }) => {
    memory.writeFile(to, memory.readFile(from) ?? from);
    memory.remove(from);
  },
  downloadAsync: async (url, uri) => {
    memory.writeFile(uri, url);
    return { uri, status: 200, headers: {}, mimeType: null };
  },
  getFreeDiskStorageAsync: async () => 1e9,
  getTotalDiskCapacityAsync: async () => 1e10,
});
