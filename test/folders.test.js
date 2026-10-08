import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Browser storage, for the tests.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { listFolders, addFolder, currentFolder, setCurrentFolder } = await import('../js/storage.js');

beforeEach(() => store.clear());

test('folders: newest first, each once, at most 20', () => {
  addFolder('/a');
  addFolder('/b');
  addFolder('/a');
  assert.deepEqual(listFolders(), ['/a', '/b']);
  for (let i = 0; i < 25; i++) addFolder(`/f${i}`);
  assert.equal(listFolders().length, 20);
  assert.equal(listFolders()[0], '/f24');
});

test('folders: the current one is remembered while it is on the list', () => {
  assert.equal(currentFolder(), '');
  addFolder('/work');
  setCurrentFolder('/work');
  assert.equal(currentFolder(), '/work');
  setCurrentFolder('/elsewhere');
  assert.equal(currentFolder(), '');
});
