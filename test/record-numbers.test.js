import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, addRecord, deleteRecords, databaseFromImport, appendImport, withRecordNumbers, recordNumbersIn } from '../js/model.js';
import { search, parseIdRanges, inIdRanges } from '../js/search.js';
import { exportDelimited, exportVertical } from '../js/exporters.js';
import { importFile } from '../js/importers.js';
import { renderRecord } from '../js/printform.js';
import { encodeCp437 } from '../js/cp437.js';

function sample(n = 20) {
  const db = createDatabase('t', ['Title', 'Notes']);
  for (let i = 1; i <= n; i++) addRecord(db, { Title: `Book ${i}`, Notes: i % 2 ? 'odd' : 'even' });
  return db;
}

test('record numbers: ranges and lists', () => {
  assert.deepEqual(parseIdRanges('12-40, 55, #61'), [[12, 40], [55, 55], [61, 61]]);
  assert.deepEqual(parseIdRanges('500-'), [[500, Infinity]]);
  assert.deepEqual(parseIdRanges('-40'), [[0, 40]]);
  assert.ok(inIdRanges(30, parseIdRanges('12-40')));
  assert.ok(!inIdRanges(41, parseIdRanges('12-40')));
  assert.throws(() => parseIdRanges('abc'));
  assert.throws(() => parseIdRanges(''));
});

test('record numbers: #127 in a search', () => {
  const db = sample();
  const ids = (q) => search(db, q).map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(ids('#7'), [7]);
  assert.deepEqual(ids('#3-6'), [3, 4, 5, 6]);
  assert.deepEqual(ids('#18-'), [18, 19, 20]);
  assert.deepEqual(ids('#2,4,19'), [2, 4, 19]);
  assert.deepEqual(ids('#3-6 odd'), [3, 5]);
  assert.deepEqual(ids('-#2-19'), [1, 20]);
  assert.deepEqual(ids('#5 OR #9'), [5, 9]);
  assert.deepEqual(ids('(#1-3) even'), [2]);
  // A # inside a word is still text.
  addRecord(db, { Title: 'C# notes', Notes: '' });
  assert.deepEqual(ids('c#'), [21]);
});

test('record numbers: survive a CSV export and import into a new notebook', () => {
  const db = sample(5);
  deleteRecords(db, [2]);
  const shape = withRecordNumbers(db.fields.map((f) => f.name), db.records);
  assert.deepEqual(shape.fields, ['Record#', 'Title', 'Notes']);
  const imported = importFile(new TextEncoder().encode(exportDelimited(shape.fields, shape.records)));
  const back = databaseFromImport('back', imported);
  assert.deepEqual(back.fields.map((f) => f.name), ['Title', 'Notes']);
  assert.deepEqual(back.records.map((r) => [r.id, r.values.Title]), [[1, 'Book 1'], [3, 'Book 3'], [4, 'Book 4'], [5, 'Book 5']]);
  assert.equal(addRecord(back, { Title: 'new' }).id, 6);
  // Vertical text too.
  const vert = importFile(encodeCp437(exportVertical(shape.fields, shape.records)));
  assert.deepEqual(databaseFromImport('v', vert).records.map((r) => r.id), [1, 3, 4, 5]);
});

test('record numbers: appending gives new numbers and drops the column', () => {
  const db = sample(3);
  appendImport(db, { fields: ['Record#', 'Title'], records: [{ 'Record#': '1', Title: 'again' }] });
  assert.deepEqual(db.fields.map((f) => f.name), ['Title', 'Notes']);
  assert.deepEqual(db.records.map((r) => r.id), [1, 2, 3, 4]);
});

test('record numbers: an unusable Record# column stays a field', () => {
  const twice = { fields: ['Record#', 'Title'], records: [{ 'Record#': '#4', Title: 'a' }, { 'Record#': '4', Title: 'b' }] };
  assert.match(recordNumbersIn(twice).problem, /twice/);
  const db = databaseFromImport('t', twice);
  assert.deepEqual(db.fields.map((f) => f.name), ['Record#', 'Title']);
  assert.deepEqual(db.records.map((r) => r.id), [1, 2]);
  assert.match(recordNumbersIn({ fields: ['record #'], records: [{ 'record #': 'x' }] }).problem, /no number/);
  // A notebook with its own Record# field exports it as it is.
  assert.deepEqual(withRecordNumbers(['Record#', 'A'], []).fields, ['Record#', 'A']);
});

test('record numbers: {Record#} and {#id} in a custom form', () => {
  const rec = { id: 127, values: { Title: 'X' } };
  assert.equal(renderRecord('{#}. {#id} {Title}', rec, ['Title'], { index: 3 }), '3. #127 X');
  assert.equal(renderRecord('{Record#} [{record #:5}] {Title}', rec, ['Title']), '127 [127  ] X');
  // A field of the notebook's own called Record# comes first.
  assert.equal(renderRecord('{Record#}', { id: 5, values: { 'Record#': 'mine' } }, ['Record#']), 'mine');
});
