import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCp437, encodeCp437, decodeBytes } from '../js/cp437.js';
import { importFile, parseDelimited, parseTagged, parseSalvage, detectTagged } from '../js/importers.js';
import { exportDelimited, exportTagged } from '../js/exporters.js';
import { search, parseQuery } from '../js/search.js';
import { createDatabase, addRecord, sortRecords, renameField, databaseFromImport } from '../js/model.js';
import { renderRecord, wrapLine } from '../js/printform.js';

const enc = (s) => new TextEncoder().encode(s);

test('cp437 round trip', () => {
  const bytes = Uint8Array.from([0x43, 0x61, 0x66, 0x82, 0x20, 0xc9, 0xcd, 0xbb]);
  assert.equal(decodeCp437(bytes), 'Café ╔═╗');
  assert.deepEqual(encodeCp437('Café ╔═╗'), bytes);
  assert.equal(decodeBytes(bytes), 'Café ╔═╗'); // not valid UTF-8, so DOS text
  assert.equal(decodeBytes(enc('Café')), 'Café');
});

test('delimited: tab with header, DOS line ends and Ctrl-Z', () => {
  const r = importFile(enc('Author\tTitle\tYear\r\nSmith\tThe Civil War\t1990\r\nJones\tCotton Mills\t1987\r\n\x1a'));
  assert.equal(r.format, 'delimited');
  assert.deepEqual(r.fields, ['Author', 'Title', 'Year']);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[1].Title, 'Cotton Mills');
});

test('delimited: quoted CSV with commas and newlines, no header', () => {
  const r = parseDelimited('"Smith, J.","Line one\nline two",1990\n"Jones, K.","x ""quoted""",1987\n');
  assert.equal(r.options.fieldDelim, ',');
  assert.equal(r.options.header, false);
  assert.deepEqual(r.fields, ['Field 1', 'Field 2', 'Field 3']);
  assert.equal(r.records[0]['Field 1'], 'Smith, J.');
  assert.equal(r.records[0]['Field 2'], 'Line one\nline two');
  assert.equal(r.records[1]['Field 2'], 'x "quoted"');
});

test('delimited: custom record delimiter and newline marker', () => {
  const r = parseDelimited('Smith|Note one\x14note two~Jones|Other~', { fieldDelim: '|', recordDelim: '~', newlineMarker: '\x14', header: false });
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0]['Field 2'], 'Note one\nnote two');
});

test('tagged: records split by repeated tags and continuation lines', () => {
  const text = 'Author: Smith\nTitle: The Civil War\nNotes: first line\n  second line\n\nAuthor: Jones\nTitle: Mills\n';
  assert.ok(detectTagged(text));
  const r = parseTagged(text);
  assert.deepEqual(r.fields, ['Author', 'Title', 'Notes']);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].Notes, 'first line\nsecond line');
  assert.equal(r.records[1].Notes, '');
});

test('tagged: rule lines keep blank lines inside a field', () => {
  const r = parseTagged('Title: A\nNotes: para one\n\npara two\n---\nTitle: B\n');
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].Notes, 'para one\n\npara two');
});

test('export then import round trips', () => {
  const db = createDatabase('t', ['Author', 'Notes']);
  addRecord(db, { Author: 'Smith, J.', Notes: 'two\nlines "quoted"' });
  addRecord(db, { Author: 'Jones', Notes: '' });
  const f = ['Author', 'Notes'];
  for (const text of [exportDelimited(f, db.records), exportDelimited(f, db.records, { fieldDelim: '\t' }), exportTagged(f, db.records)]) {
    const r = importFile(enc(text));
    assert.deepEqual(r.fields, f, text);
    assert.deepEqual(r.records, db.records.map((x) => x.values), text);
  }
});

test('salvage pulls text out of binary', () => {
  const bytes = Uint8Array.from([0, 0, 1, 2, ...enc('Smith, John'), 0, 0, 0, 0, 5, ...enc('The Civil War'), 0, 9, 0, 0, 0, 0, 0, 0]);
  const r = importFile(bytes);
  assert.equal(r.format, 'salvage');
  assert.deepEqual(r.records.map((x) => x.Text), ['Smith, John', 'The Civil War']);
  assert.equal(parseSalvage(bytes, { mergeGap: 10 }).records.length, 1);
});

test('search language', () => {
  const db = createDatabase('t', ['Author', 'Title', 'Date of birth']);
  addRecord(db, { Author: 'Smith', Title: 'The Civil War in Georgia', 'Date of birth': '1850' });
  addRecord(db, { Author: 'Jones', Title: 'Cotton and the war', 'Date of birth': '' });
  addRecord(db, { Author: 'Café Owner', Title: 'History of coffee', 'Date of birth': '1901' });
  const ids = (q) => search(db, q).map((r) => r.id);
  assert.deepEqual(ids('war'), [1, 2]);
  assert.deepEqual(ids('"civil war"'), [1]);
  assert.deepEqual(ids('"war civil"'), []);
  assert.deepEqual(ids('author:smith'), [1]);
  assert.deepEqual(ids('title:smith'), []);
  assert.deepEqual(ids('war -smith'), [2]);
  assert.deepEqual(ids('war NOT jones'), [1]);
  assert.deepEqual(ids('smith OR jones'), [1, 2]);
  assert.deepEqual(ids('(smith OR cafe) AND hist*'), [3]);
  assert.deepEqual(ids('"date of birth":1850'), [1]);
  assert.deepEqual(ids('date_of_birth:'), [2]);
  assert.deepEqual(ids('date_of_birth:*'), [1, 3]);
  assert.deepEqual(ids('co?ton'), [2]);
  assert.throws(() => search(db, 'nosuch:x'), /No field/);
  assert.throws(() => parseQuery('(war'), /Missing/);
  assert.equal(search(db, '').length, 3);
});

test('sorting: numeric aware, empties last, descending', () => {
  const db = createDatabase('t', ['N']);
  for (const n of ['10', '', '9', 'b', 'A']) addRecord(db, { N: n });
  assert.deepEqual(sortRecords(db.records, [{ field: 'N' }]).map((r) => r.values.N), ['9', '10', 'A', 'b', '']);
  assert.deepEqual(sortRecords(db.records, [{ field: 'N', descending: true }]).map((r) => r.values.N), ['b', 'A', '10', '9', '']);
});

test('rename field updates records and print forms', () => {
  const db = databaseFromImport('t', { fields: ['A'], records: [{ A: 'x' }] });
  renameField(db, 'A', 'B');
  assert.equal(db.records[0].values.B, 'x');
  assert.match(db.printForms[0].template, /\{B\}/);
});

test('print forms: optional lines, hanging indent wrap', () => {
  const rec = { values: { Author: 'Smith', Notes: 'one two three four five six', Year: '' } };
  const out = renderRecord('{#}. {Author}\n[[Year: {Year}]]\nNotes: {Notes}', rec, ['Author', 'Notes', 'Year'], { index: 3, width: 20 });
  assert.equal(out, '3. Smith\nNotes: one two three\n       four five six');
  assert.deepEqual(wrapLine('abc', 10), ['abc']);
});
