'use strict';
/**
 * expo-file-system dans le canevas : un système de fichiers en mémoire, propre à l'écran.
 * Couvre l'API moderne (File, Directory, Paths) ; le reste passe par le remplacement générique.
 */
const { createShim } = require('./_shim');
const { memory, join, nameOf, parentOf } = require('./_memory-fs');

class FsEntry {
  constructor(...parts) {
    this.uri = join(...parts.map((p) => (p && typeof p === 'object' && 'uri' in p ? p.uri : String(p))));
  }
  get name() {
    return nameOf(this.uri);
  }
  get extension() {
    const m = /\.[^./]+$/.exec(this.name);
    return m ? m[0] : '';
  }
  get parentDirectory() {
    return new Directory(parentOf(this.uri));
  }
  get exists() {
    return memory.has(this.uri);
  }
  delete() {
    memory.remove(this.uri);
  }
  info() {
    return { exists: this.exists, uri: this.uri, size: this.size ?? 0, modificationTime: memory.mtime(this.uri) };
  }
}

class File extends FsEntry {
  create() {
    if (!this.exists) memory.writeFile(this.uri, '');
  }
  write(content) {
    memory.writeFile(this.uri, typeof content === 'string' ? content : String(content));
  }
  text() {
    return Promise.resolve(this.textSync());
  }
  textSync() {
    return memory.readFile(this.uri) ?? '';
  }
  base64() {
    return Promise.resolve(this.base64Sync());
  }
  base64Sync() {
    const text = this.textSync();
    return typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(text))) : text;
  }
  bytes() {
    return Promise.resolve(new TextEncoder().encode(this.textSync()));
  }
  get size() {
    return (memory.readFile(this.uri) ?? '').length;
  }
  get type() {
    return '';
  }
  copy(destination) {
    const target = destination instanceof Directory ? new File(destination, this.name) : new File(destination);
    // Fichier inconnu (photo choisie dans la galerie, blob:…) : on garde son URI d'origine comme contenu.
    target.write(memory.readFile(this.uri) ?? this.uri);
  }
  move(destination) {
    const target = destination instanceof Directory ? new File(destination, this.name) : new File(destination);
    this.copy(target);
    this.delete();
    this.uri = target.uri;
  }
}

class Directory extends FsEntry {
  create() {
    memory.makeDir(this.uri);
  }
  list() {
    return memory.children(this.uri).map((child) => (child.type === 'dir' ? new Directory(child.uri) : new File(child.uri)));
  }
  createFile(name) {
    const file = new File(this, name);
    file.create();
    return file;
  }
  createDirectory(name) {
    const dir = new Directory(this, name);
    dir.create();
    return dir;
  }
  get size() {
    return 0;
  }
}

class Paths {
  static get document() {
    return new Directory('file:///rn-canvas/document/');
  }
  static get cache() {
    return new Directory('file:///rn-canvas/cache/');
  }
  static get bundle() {
    return new Directory('file:///rn-canvas/bundle/');
  }
  static join(...parts) {
    return join(...parts.map((p) => (p && typeof p === 'object' && 'uri' in p ? p.uri : String(p))));
  }
  static basename(path) {
    return nameOf(String(path));
  }
  static dirname(path) {
    return parentOf(String(path));
  }
  static extname(path) {
    const m = /\.[^./]+$/.exec(String(path));
    return m ? m[0] : '';
  }
  static get availableDiskSpace() {
    return 1e9;
  }
  static get totalDiskSpace() {
    return 1e10;
  }
}

module.exports = createShim('expo-file-system', null, {
  File,
  Directory,
  Paths,
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  FileMode: { ReadOnly: 'r', WriteOnly: 'w', ReadWrite: 'rw' },
});
