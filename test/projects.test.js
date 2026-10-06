import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Browser storage, for the tests.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { saveDb, loadDb, listSaved, listProjects, addProject, renameProject, removeProject, currentProject, setCurrentProject } = await import('../js/storage.js');
const { createDatabase } = await import('../js/model.js');

function keep(key, name, project) {
  const db = createDatabase(name, ['A']);
  if (project !== undefined) db.project = project;
  saveDb(key, db);
}

beforeEach(() => store.clear());

test('projects: made empty, or found on collections; collections from before have none', () => {
  keep('a', 'Old', undefined);
  keep('b', 'Thesis notes', 'Thesis');
  addProject('Book');
  assert.deepEqual(listProjects(), ['Book', 'Thesis']);
  assert.deepEqual(listSaved().map((d) => [d.name, d.project]), [['Thesis notes', 'Thesis'], ['Old', '']]);
  assert.throws(() => addProject('  '), /needs a name/);
  assert.throws(() => addProject('book'), /already a project/);
});

test('projects: renaming moves the collections; deleting leaves them Unfiled', () => {
  keep('a', 'One', 'Thesis');
  keep('b', 'Two', 'Thesis');
  keep('c', 'Three', 'Book');
  setCurrentProject('Thesis');
  renameProject('Thesis', 'Dissertation');
  assert.equal(loadDb('a').project, 'Dissertation');
  assert.equal(loadDb('b').project, 'Dissertation');
  assert.equal(loadDb('c').project, 'Book');
  assert.equal(currentProject(), 'Dissertation');
  assert.deepEqual(listProjects(), ['Book', 'Dissertation']);
  assert.throws(() => renameProject('Dissertation', 'book'), /already a project/);
  removeProject('Dissertation');
  assert.equal(loadDb('a').project, '');
  assert.equal(listSaved().length, 3); // no collection deleted
  assert.deepEqual(listProjects(), ['Book']);
  assert.equal(currentProject(), '*');
});
