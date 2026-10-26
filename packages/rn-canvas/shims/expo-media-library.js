'use strict';
// Médiathèque : permission refusée, rien n'est enregistré.
const { createShim } = require('./_shim');

module.exports = createShim('expo-media-library', null, {
  saveToLibraryAsync: async () => {},
  createAssetAsync: async (uri) => ({ id: 'rn-canvas-asset', uri, filename: String(uri).split('/').pop(), mediaType: 'photo', width: 0, height: 0, creationTime: Date.now(), modificationTime: Date.now(), duration: 0 }),
  getAssetsAsync: async () => ({ assets: [], endCursor: '', hasNextPage: false, totalCount: 0 }),
  getAlbumsAsync: async () => [],
  getAlbumAsync: async () => null,
  MediaType: { audio: 'audio', photo: 'photo', video: 'video', unknown: 'unknown' },
  SortBy: { default: 'default', creationTime: 'creationTime', modificationTime: 'modificationTime', mediaType: 'mediaType', width: 'width', height: 'height', duration: 'duration' },
});
