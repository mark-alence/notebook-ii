import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importFile, importFiles, parseNotebookDb, parseReportFormat, looksLikeNotebookDat } from '../js/importers.js';
import { encodeCp437 } from '../js/cp437.js';
import { search } from '../js/search.js';
import { createDatabase, addRecord, databaseFromImport, renameField } from '../js/model.js';
import { renderRecord, renderReport } from '../js/printform.js';

// NOTES.* and CARDS.R00 were made with Notebook II 2.31 itself (in DOSBox):
// four records typed in, the paragraph break in record 1's Notes, then record
// 2's Year changed from 1984 to 1985 and record 3 marked deleted. So the .DAT
// holds stale copies of records 2 and 3, and the .IDX flags record 3 with 0xFF.
const fixture = (name) => ({ name, bytes: new Uint8Array(readFileSync(new URL(`fixtures/native/${name}`, import.meta.url))) });
const NOTES = ['NOTES.DAT', 'NOTES.DEF', 'NOTES.IDX', 'NOTES.MSC'].map(fixture);

test('native: database made by Notebook II, read through its index', () => {
  const r = importFiles(NOTES);
  assert.equal(r.format, 'notebook');
  assert.deepEqual(r.fields, ['Author', 'Title', 'Year', 'Notes']);
  assert.deepEqual(r.records, [
    { Author: 'Davis, Natalie Zemon', Title: 'The Return of Martin Guerre', Year: '1983', Notes: 'Village imposture case, 1560.\nCompare with the film.' },
    { Author: 'Darnton, Robert', Title: 'The Great Cat Massacre', Year: '1985', Notes: '' },
    { Author: 'Ginzburg, Carlo', Title: 'The Cheese and the Worms', Year: '1980', Notes: 'Menocchio, a miller.' },
  ]);
  assert.match(r.warnings.join(), /1 record marked deleted/);
});

test('native: deleted records can be kept, flagged in a Deleted field', () => {
  const r = importFiles(NOTES, { includeDeleted: true });
  assert.deepEqual(r.fields, ['Author', 'Title', 'Year', 'Notes', 'Deleted']);
  assert.equal(r.records.length, 4);
  assert.equal(r.records[2].Author, 'Spence, Jonathan');
  assert.deepEqual(r.records.map((x) => x.Deleted), ['', '', 'yes', '']);
});

test('native: file names in any case, order and with backups', () => {
  const shuffled = [...NOTES].reverse().map((f) => ({ ...f, name: f.name.toLowerCase() }));
  shuffled.push({ name: 'notes.bdt', bytes: Uint8Array.of(0x58, 0, 0x80) });
  assert.equal(importFiles(shuffled).records.length, 3);
});

test('native: .DAT alone is detected and read in file order', () => {
  const dat = NOTES[0].bytes;
  assert.ok(looksLikeNotebookDat(dat));
  const r = importFile(dat);
  assert.equal(r.format, 'notebook');
  assert.deepEqual(r.fields, ['Field 1', 'Field 2', 'Field 3', 'Field 4']);
  // Every stored copy: 4 originals, then the edited record 2 and record 3 again.
  assert.deepEqual(r.records.map((x) => x['Field 3']), ['1983', '1984', '1984', '1980', '1985', '1984']);
  assert.match(r.warnings.join(), /without the \.IDX/);
  assert.match(r.warnings.join(), /\.DEF/);
  assert.deepEqual(importFiles([NOTES[0], NOTES[1]]).fields, ['Author', 'Title', 'Year', 'Notes']);
});

test('native: a .DEF or .IDX without the .DAT asks for it', () => {
  assert.throws(() => importFiles([NOTES[1]]), /\.DAT/);
  assert.throws(() => importFiles([NOTES[1], NOTES[2]]), /\.DAT/);
});

// Build a database the way Notebook II lays it out, for cases the fixture lacks.
function makeDb(fields, records) {
  const def = new Uint8Array(1200);
  fields.forEach((f, i) => def.set(encodeCp437(f), i * 24));
  const chunks = [];
  const idx = new Uint8Array(records.length * 105);
  const view = new DataView(idx.buffer);
  let offset = 0;
  records.forEach((values, r) => {
    view.setUint32(r * 105 + 101, offset, true);
    const parts = values.map((v) => [...encodeCp437(v.replace(/\n/g, '\r')), 0]);
    parts.forEach((p, f) => view.setUint16(r * 105 + 1 + f * 2, p.length, true));
    const rec = [...parts.flat(), 0x80];
    chunks.push(...rec);
    offset += rec.length;
  });
  return { dat: Uint8Array.from(chunks), def, idx };
}

test('native: index lengths keep Ç (byte 0x80) inside a field', () => {
  const db = makeDb(['Name', 'Place'], [['Ça va', 'Curaçao'], ['Two', 'Ölands\nnorra']]);
  const r = parseNotebookDb(db);
  assert.deepEqual(r.records, [{ Name: 'Ça va', Place: 'Curaçao' }, { Name: 'Two', Place: 'Ölands\nnorra' }]);
});

test('native: records saved before a heading was added', () => {
  const db = makeDb(['A', 'B', 'C'], [['x', 'y', 'z'], ['old', 'record']]);
  assert.deepEqual(parseNotebookDb(db).records[1], { A: 'old', B: 'record', C: '' });
});

test('native: an index from another database is reported, not trusted', () => {
  const db = makeDb(['A'], [['first'], ['second']]);
  const other = makeDb(['A'], [['a much longer value'], ['x']]);
  const r = parseNotebookDb({ ...db, idx: other.idx });
  assert.match(r.warnings.join(), /do not match/);
});

test('native: custom print format (.R00) becomes a print form', () => {
  const form = parseReportFormat(fixture('CARDS.R00').bytes, ['Author', 'Title', 'Year', 'Notes'], 'CARDS.R00');
  assert.deepEqual(form, {
    name: 'Cards',
    width: 65,
    template: '{#}. {Author:20} ({Year:20})\n[[Notes: {Title:20}]]',
    header: 'Reading list {@date} {@time} page {@page}',
    footer: 'End of list',
    pageLines: 66,
    textPages: true,
  });
  const r = importFiles([...NOTES, fixture('CARDS.R00')]);
  assert.equal(r.printForms[0].name, 'Cards');
  const db = databaseFromImport('notes', r);
  assert.equal(db.printForms[0].name, 'Cards');
  assert.equal(db.printForms[1].name, 'Standard');
});

test('print forms: fixed-width fields; a text file has the header and footer once', () => {
  const rec = { values: { Author: 'Davis, Natalie Zemon', Year: '1983' } };
  assert.equal(renderRecord('{#}. {Author:10}|{Year:6}|', rec, ['Author', 'Year']), '1. Davis, Nat|1983  |');
  const records = [1, 2, 3, 4].map((n) => ({ values: { Author: `A${n}`, Year: '' } }));
  // Forms imported from Notebook II (textPages, pageLines) no longer cut text into pages.
  const out = renderReport({ width: 40, template: '{Author}', header: 'Page {@page} of {@pages}', footer: 'end', pageLines: 6, textPages: true }, records, ['Author', 'Year']);
  assert.equal(out, 'Page 1 of 1\n\nA1\n\nA2\n\nA3\n\nA4\n\nend\n');
});

test('rename field updates fixed-width placeholders too', () => {
  const db = databaseFromImport('t', { fields: ['A'], records: [], printForms: [{ name: 'F', width: 40, template: '{A:10} {A}' }] });
  renameField(db, 'A', 'B');
  assert.equal(db.printForms[0].template, '{B:10} {B}');
});

test('Notebook II import text: %Start: %Field: %End:', () => {
  const text = '%Start:\r\n%Author:Brest, Paul\r\n%Title:Processes\r\n%Comments:Casebook for\r\na law course.\r\n%End:\r\n%Start:   \r\n%Author:Davis\r\n%End:\r\n\x1a\x1a';
  const r = importFile(encodeCp437(text));
  assert.equal(r.format, 'tagged');
  assert.deepEqual(r.fields, ['Author', 'Title', 'Comments']);
  assert.deepEqual(r.records, [
    { Author: 'Brest, Paul', Title: 'Processes', Comments: 'Casebook for\na law course.' },
    { Author: 'Davis', Title: '', Comments: '' },
  ]);
});

test('search: Notebook II Select conditions', () => {
  const db = createDatabase('t', ['Author', 'Year']);
  for (const [a, y] of [['Smith, John', '1975'], ['Jones', '1983'], ['smithers', '1990'], ['Adams', '']]) addRecord(db, { Author: a, Year: y });
  const ids = (q) => search(db, q).map((r) => r.id);
  assert.deepEqual(ids('author=smith'), [1, 3]);
  assert.deepEqual(ids('-author=smith'), [2, 4]);
  assert.deepEqual(ids('year>1980'), [2, 3]);
  assert.deepEqual(ids('year>=1983'), [2, 3]);
  assert.deepEqual(ids('year<1983'), [1]);
  assert.deepEqual(ids('year<=1983 author>a'), [1, 2]);
  assert.deepEqual(ids('author<=jones'), [2, 4]);
  assert.deepEqual(ids('author>jones'), [1, 3]);
  assert.deepEqual(ids('"author"=jo'), [2]);
  assert.deepEqual(ids('year>1980 OR author=adams'), [2, 3, 4]);
  assert.throws(() => search(db, 'year>'), /Nothing to compare/);
});
