import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, addRecord, carryOver, copiesFromPrevious, setFieldCopy, renameField } from '../js/model.js';

const db = () => {
  const d = createDatabase('t', ['Author', 'Title', 'Year', 'Pages', 'Keywords', 'Notes']);
  addRecord(d, { Author: 'Davis, Natalie Zemon', Title: 'The Return of Martin Guerre', Year: '1983', Pages: '12-14', Keywords: 'law', Notes: 'Village case.' });
  return d;
};

test('copy from previous: source fields by default, not notes, pages or keywords', () => {
  const d = db();
  assert.deepEqual(d.fields.filter(copiesFromPrevious).map((f) => f.name), ['Author', 'Title', 'Year']);
  const values = { Author: '', Title: '', Year: '', Pages: '', Keywords: '', Notes: 'A new note' };
  assert.deepEqual(carryOver(d, d.records[0], values), ['Author', 'Title', 'Year']);
  assert.deepEqual(values, { Author: 'Davis, Natalie Zemon', Title: 'The Return of Martin Guerre', Year: '1983', Pages: '', Keywords: '', Notes: 'A new note' });
});

test('copy from previous never overwrites what you typed', () => {
  const d = db();
  const values = { Author: 'Someone else', Title: '', Year: ' ', Pages: '', Keywords: '', Notes: '' };
  assert.deepEqual(carryOver(d, d.records[0], values), ['Title', 'Year']);
  assert.equal(values.Author, 'Someone else');
  assert.deepEqual(carryOver(d, d.records[0], values), []);
  assert.deepEqual(carryOver(d, null, values), []);
});

test('copy one field replaces it, even one F5 skips', () => {
  const d = db();
  const values = { Author: 'Typo', Title: '', Year: '', Pages: '', Keywords: '', Notes: '' };
  assert.deepEqual(carryOver(d, d.records[0], values, 'Pages'), ['Pages']);
  assert.deepEqual(carryOver(d, d.records[0], values, 'Author'), ['Author']);
  assert.equal(values.Author, 'Davis, Natalie Zemon');
  assert.deepEqual(carryOver(d, d.records[0], values, 'Author'), []);
});

test('the fields F5 copies can be chosen, and survive a rename', () => {
  const d = db();
  setFieldCopy(d, 'Keywords', true);
  setFieldCopy(d, 'Year', false);
  renameField(d, 'Keywords', 'Subjects');
  assert.deepEqual(d.fields.filter(copiesFromPrevious).map((f) => f.name), ['Author', 'Title', 'Subjects']);
  assert.throws(() => setFieldCopy(d, 'Nope', true), /No field/);
});
