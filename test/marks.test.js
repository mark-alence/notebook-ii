import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, addRecord, setMarked, markedRecords, validateDatabase } from '../js/model.js';
import { search, highlightPatterns } from '../js/search.js';
import { exportJson } from '../js/exporters.js';
import { importFile } from '../js/importers.js';

function sample() {
  const db = createDatabase('t', ['Title', 'Year']);
  for (let i = 1; i <= 6; i++) addRecord(db, { Title: `Book ${i}`, Year: String(1980 + i) });
  return db;
}

test('marks: set, count and clear without touching the records', () => {
  const db = sample();
  const before = db.records[1].modified;
  assert.equal(setMarked(db, [db.records[1], db.records[3]], true), 2);
  assert.equal(setMarked(db, [db.records[1]], true), 0);
  assert.deepEqual(markedRecords(db).map((r) => r.id), [2, 4]);
  assert.equal(db.records[1].modified, before);
  assert.equal(setMarked(db, db.records, false), 2);
  assert.equal(markedRecords(db).length, 0);
  assert.ok(!('marked' in db.records[1]));
});

test('marks: @marked in a search', () => {
  const db = sample();
  setMarked(db, db.records.filter((r) => r.id % 2), true);
  const ids = (q) => search(db, q).map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(ids('@marked'), [1, 3, 5]);
  assert.deepEqual(ids('-@marked'), [2, 4, 6]);
  assert.deepEqual(ids('@MARKED year>1983'), [5]);
  assert.deepEqual(ids('@marked OR #2'), [1, 2, 3, 5]);
  assert.deepEqual(ids('(@marked) #1-3'), [1, 3]);
  assert.deepEqual(highlightPatterns('@marked'), []);
  // Inside a word it is plain text.
  addRecord(db, { Title: 'me@marked.org', Year: '' });
  assert.deepEqual(ids('me@marked'), [7]);
});

test('marks: kept in a notebook backup', () => {
  const db = sample();
  setMarked(db, [db.records[2]], true);
  const back = importFile(new TextEncoder().encode(exportJson(db)));
  const restored = validateDatabase(back.database);
  assert.deepEqual(markedRecords(restored).map((r) => r.id), [3]);
});
