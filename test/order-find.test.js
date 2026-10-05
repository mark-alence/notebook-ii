import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, addRecord, orderRecords, previousEntered } from '../js/model.js';
import { findInTexts } from '../js/search.js';
import { cssVars, DEFAULTS } from '../js/appearance.js';

const db = () => {
  const d = createDatabase('t', ['Title', 'Year']);
  for (const [t, y] of [['B', '1990'], ['A', '1980'], ['C', '1990'], ['D', '']]) addRecord(d, { Title: t, Year: y });
  return d;
};
const titles = (recs) => recs.map((r) => r.values.Title).join('');

test('list order: newest first by default, oldest first on request', () => {
  const d = db();
  assert.equal(titles(orderRecords(d.records, [])), 'DCAB');
  assert.equal(titles(orderRecords(d.records, [], 'newest')), 'DCAB');
  assert.equal(titles(orderRecords(d.records, [], 'oldest')), 'BACD');
  assert.equal(titles(d.records), 'BACD'); // the notebook itself is not reordered
});

test('records alike in the sort field follow the date-entered order', () => {
  const d = db();
  assert.equal(titles(orderRecords(d.records, [{ field: 'Year' }])), 'ACBD');
  assert.equal(titles(orderRecords(d.records, [{ field: 'Year' }], 'oldest')), 'ABCD');
  assert.equal(titles(orderRecords(d.records, [{ field: 'Year', descending: true }])), 'CBAD');
});

test('"previous" is the record made just before, whatever the list order', () => {
  const d = db();
  const [b, a, c] = d.records;
  assert.equal(previousEntered(d.records, c), a);
  assert.equal(previousEntered(d.records, a), b);
  assert.equal(previousEntered(d.records, b), null);
  assert.equal(previousEntered([c, b], c), b);
});

test('find in a record: text, patterns, and unfinished patterns', () => {
  const texts = ['Cocoa prices', 'Governor reported that cocoa prices fell.\nCocoa again.', '', 'CO 96/728'];
  assert.deepEqual(findInTexts(texts, 'cocoa').matches, [
    { field: 0, start: 0, end: 5 }, { field: 1, start: 23, end: 28 }, { field: 1, start: 42, end: 47 },
  ]);
  assert.deepEqual(findInTexts(texts, '96/7').matches, [{ field: 3, start: 3, end: 7 }]);
  assert.deepEqual(findInTexts(texts, '/pric\\w+/').matches.map((m) => m.field), [0, 1]);
  assert.deepEqual(findInTexts(texts, '/^Cocoa/c').matches.map((m) => [m.field, m.start]), [[0, 0]]);
  assert.deepEqual(findInTexts(texts, '/^Cocoa/cm').matches.map((m) => [m.field, m.start]), [[0, 0], [1, 42]]);
  assert.deepEqual(findInTexts(texts, '(x)').matches, []);
  assert.deepEqual(findInTexts(texts, '  ').matches, []);
  assert.match(findInTexts(texts, '/coc').error, /needs a \//);
  assert.match(findInTexts(texts, '/a(/').error, /does not work/);
  assert.equal(findInTexts(texts, '/x*/').matches.length, 0); // empty matches are skipped
});

test('appearance: CSS for each choice, nothing for the defaults', () => {
  assert.deepEqual(cssVars(DEFAULTS), {});
  assert.match(cssVars({ ...DEFAULTS, font: 'serif' })['--font'], /Georgia/);
  assert.match(cssVars({ ...DEFAULTS, font: 'custom', custom: 'Courier "New"' })['--font'], /^"Courier New", ui-monospace/);
  assert.deepEqual(cssVars({ ...DEFAULTS, font: 'custom', custom: '  ' }), {});
  assert.equal(cssVars({ ...DEFAULTS, size: 99 })['--font-size'], '32px');
  assert.equal(cssVars({ ...DEFAULTS, size: 18.4 })['--font-size'], '18px');
  assert.equal(cssVars({ ...DEFAULTS, spacing: 'relaxed' })['--lh'], '1.7');
});
