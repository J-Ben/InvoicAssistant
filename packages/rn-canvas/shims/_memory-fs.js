'use strict';
// Stockage en mémoire partagé par les remplacements d'expo-file-system (API moderne et legacy).

const entries = new Map(); // uri → { type: 'file' | 'dir', content, mtime }

function normalize(uri) {
  return String(uri).replace(/\/+$/, '');
}

function join(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .map((p, i) => (i === 0 ? String(p).replace(/\/+$/, '') : String(p).replace(/^\/+|\/+$/g, '')))
    .join('/');
}

function nameOf(uri) {
  return normalize(uri).split('/').pop() || '';
}

function parentOf(uri) {
  const parts = normalize(uri).split('/');
  parts.pop();
  return parts.join('/');
}

const memory = {
  has: (uri) => entries.has(normalize(uri)),
  mtime: (uri) => entries.get(normalize(uri))?.mtime ?? 0,
  readFile: (uri) => {
    const e = entries.get(normalize(uri));
    return e && e.type === 'file' ? e.content : null;
  },
  writeFile: (uri, content) => {
    memory.makeDir(parentOf(uri));
    entries.set(normalize(uri), { type: 'file', content, mtime: Date.now() });
  },
  makeDir: (uri) => {
    const key = normalize(uri);
    if (!key || /^[a-z]+:\/*$/i.test(key) || entries.has(key)) return;
    entries.set(key, { type: 'dir', content: null, mtime: Date.now() });
    memory.makeDir(parentOf(key));
  },
  remove: (uri) => {
    const key = normalize(uri);
    for (const k of [...entries.keys()]) if (k === key || k.startsWith(`${key}/`)) entries.delete(k);
  },
  children: (uri) => {
    const key = normalize(uri);
    return [...entries.entries()].filter(([k]) => parentOf(k) === key).map(([k, e]) => ({ uri: k, type: e.type }));
  },
};

module.exports = { memory, join, nameOf, parentOf };
