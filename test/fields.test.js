import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, addRecord, updateRecord, fieldLines, shownInList, setFieldOption, listColumns, setListColumns, moveListColumn, renameField, deleteField, LAYOUTS, copiesFromPrevious } from '../js/model.js';
import { exportVertical } from '../js/exporters.js';
import { importFile } from '../js/importers.js';

test('layouts for a new notebook carry their field settings', () => {
  const archive = LAYOUTS.find((l) => l.id === 'archive');
  const db = createDatabase('Ghana', archive.fields);
  assert.deepEqual(db.fields.map((f) => f.name), ['Header', 'Note', 'Citation', 'Date']);
  assert.deepEqual(db.fields.filter(copiesFromPrevious).map((f) => f.name), ['Citation']);
  assert.equal(fieldLines(db.fields[1]), 10);
  assert.equal(fieldLines(db.fields[0]), 1);
  archive.fields[0].copy = true; // the layout itself is not changed by the notebook
  assert.equal(db.fields[0].copy, false);
  archive.fields[0].copy = false;
});

test('field lines: long-text names start taller, and the setting is kept in range', () => {
  const db = createDatabase('t', ['Author', 'Notes', 'Document']);
  assert.deepEqual(db.fields.map(fieldLines), [1, 8, 8]);
  setFieldOption(db, 'Author', 'lines', '3');
  setFieldOption(db, 'Notes', 'lines', 400);
  setFieldOption(db, 'Document', 'lines', 'x');
  assert.deepEqual(db.fields.map(fieldLines), [3, 40, 1]);
});

test('in list: first four until chosen, never none', () => {
  const db = createDatabase('t', ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(db.fields.map((f) => shownInList(db, f)), [true, true, true, true, false]);
  setFieldOption(db, 'E', 'list', true);
  setFieldOption(db, 'A', 'list', false);
  assert.deepEqual(db.fields.map((f) => shownInList(db, f)), [false, true, true, true, true]);
  for (const n of ['B', 'C', 'D']) setFieldOption(db, n, 'list', false);
  assert.throws(() => setFieldOption(db, 'E', 'list', false), /at least one/);
});

test('records keep when they were created and changed', async () => {
  const db = createDatabase('t', ['A']);
  const r = addRecord(db, { A: 'x' });
  assert.ok(r.created && r.created === r.modified);
  await new Promise((ok) => setTimeout(ok, 5));
  updateRecord(db, r.id, { A: 'y' });
  assert.ok(r.modified > r.created);
});

test('the remembered sort follows renamed and deleted fields', () => {
  const db = createDatabase('t', ['A', 'B']);
  db.sortKeys = [{ field: 'A', descending: true }, { field: 'B', descending: false }];
  renameField(db, 'A', 'Date');
  deleteField(db, 'B');
  assert.deepEqual(db.sortKeys, [{ field: 'Date', descending: true }]);
});

test('vertical text: readable, keeps paragraphs, and reads back in', () => {
  const fields = ['Author', 'Title', 'Year', 'Keywords', 'Notes'];
  const records = [
    { values: { Author: 'Polly Hill', Title: 'The Migrant Cocoa-Farmers of Southern Ghana', Year: '1963', Keywords: '', Notes: 'Long note begins here.\n\nA second paragraph.' } },
    { values: { Author: 'Gareth Austin', Title: 'Labour, Land, and Capital in Ghana', Year: '2005', Keywords: 'labour; land', Notes: 'Short.' } },
  ];
  const text = exportVertical(fields, records);
  assert.match(text, /^Author:   Polly Hill\r\nTitle:    The Migrant/);
  assert.match(text, /\r\nNotes:\r\nLong note begins here\.\r\n\r\nA second paragraph\.\r\n/);
  assert.match(text, /\r\n-{60}\r\n/);
  const back = importFile(new TextEncoder().encode(text));
  assert.deepEqual(back.fields, fields);
  assert.deepEqual(back.records, records.map((r) => r.values));
});

test('list columns: own order, apart from the fields; older notebooks keep theirs', () => {
  const db = createDatabase('t', ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(listColumns(db), ['A', 'B', 'C', 'D']); // until chosen: the first four
  setFieldOption(db, 'A', 'list', false); // an older notebook's "In list" ticks
  setFieldOption(db, 'E', 'list', true);
  assert.deepEqual(listColumns(db), ['B', 'C', 'D', 'E']);
  setListColumns(db, ['E', 'B']);
  assert.deepEqual(listColumns(db), ['E', 'B']);
  assert.deepEqual(db.fields.map((f) => f.name), ['A', 'B', 'C', 'D', 'E']); // record order untouched
  moveListColumn(db, 'B', -1);
  assert.deepEqual(listColumns(db), ['B', 'E']);
  moveListColumn(db, 'B', -1); // already first
  assert.deepEqual(listColumns(db), ['B', 'E']);
  renameField(db, 'E', 'Year');
  assert.deepEqual(listColumns(db), ['B', 'Year']);
  deleteField(db, 'B');
  assert.deepEqual(listColumns(db), ['Year']);
  assert.throws(() => setListColumns(db, []), /at least one column/);
  assert.throws(() => setListColumns(db, ['Nope']), /at least one column/);
  setListColumns(db, ['Year', 'A', 'A', 'Nope']);
  assert.deepEqual(listColumns(db), ['Year', 'A']);
  deleteField(db, 'Year');
  deleteField(db, 'A');
  assert.deepEqual(listColumns(db), ['C']); // never empty: falls back to the first field
});
