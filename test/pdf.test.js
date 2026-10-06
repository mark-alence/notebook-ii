import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { pdfLayout, layoutPdf, makePdf, previewPdf, PDF_FONTS } from '../js/pdf.js';
import { renderRecord, renderReport, fillPageText, upgradeForm } from '../js/printform.js';
import { validateDatabase, createDatabase } from '../js/model.js';

const fontFile = (id) => ({ id, data: readFileSync(new URL(`../fonts/${PDF_FONTS[id].file}`, import.meta.url)).toString('base64') });
const font = fontFile('mono');
const now = new Date(2026, 9, 5, 14, 30);

test('header and footer placeholders use @, so fields called Date or Page stay fields', () => {
  assert.equal(fillPageText('Page {@page} of {@pages}, {@DATE}', { page: 2, pages: 7, now }), `Page 2 of 7, ${now.toLocaleDateString()}`);
  const rec = { values: { Date: '1938-03-17', Page: '12' } };
  assert.equal(renderRecord('{Date} p.{Page} {Time} {#}', rec, ['Date', 'Page'], { index: 4 }), '1938-03-17 p.12 {Time} 4');
});

test('old forms get the @ names', () => {
  const f = upgradeForm({ name: 'Cards', width: 60, template: '{Date}', header: 'List {Date} {Time} page {Page}', footer: '' });
  assert.equal(f.header, 'List {@date} {@time} page {@page}');
  assert.equal(f.template, '{Date}');
  assert.equal(f.textPages, true);
  assert.equal(upgradeForm({ name: 'S', width: 60, template: 'x', header: '' }).textPages, false);
  const db = validateDatabase({ ...createDatabase('t', ['A']), printForms: [{ name: 'Old', width: 60, template: '{A}', header: 'Page {Page}' }] });
  assert.equal(db.printForms[0].header, 'Page {@page}');
  assert.equal(upgradeForm({ ...db.printForms[0], header: 'kept {Page}' }).header, 'kept {Page}'); // already new: untouched
});

test('a text file has its header and footer once', () => {
  const recs = [{ values: { A: 'one' } }, { values: { A: 'two' } }];
  const form = { width: 40, template: '{A}', header: 'Top {@page}/{@pages}', footer: 'Bottom', textPages: false };
  assert.equal(renderReport(form, recs, ['A'], { now }), 'Top 1/1\n\none\n\ntwo\n\nBottom\n');
});

test('PDF layout: real page sizes decide lines and characters', () => {
  const a4 = pdfLayout({ paper: 'a4', fontSize: 10 });
  const letter = pdfLayout({ paper: 'letter', fontSize: 10 });
  const big = pdfLayout({ paper: 'a4', fontSize: 14 });
  assert.equal(a4.chars, 81);
  assert.ok(letter.room < a4.room && letter.chars > a4.chars);
  assert.ok(big.room < a4.room && big.chars < a4.chars);
  assert.equal(pdfLayout({ paper: 'a4', fontSize: 10, header: 'h', footer: 'f' }).room, a4.room - 4);
});

test('PDF pages keep each record whole when it fits, and wrap long lines', () => {
  const blocks = Array.from({ length: 30 }, (_, i) => `R${i + 1}\n${'word '.repeat(40).trim()}\nend`);
  const { layout, pages } = layoutPdf(blocks, { paper: 'a4', fontSize: 10 });
  for (const page of pages) {
    assert.ok(page.length <= layout.room);
    assert.ok(page.every((l) => l.length <= layout.chars));
    assert.match(page[0], /^R\d+$/); // every page starts with a record, not the middle of one
  }
  assert.equal(pages.flat().filter((l) => /^R\d+$/.test(l)).length, 30);
});

test('a real PDF: one page per laid-out page, every character kept', () => {
  const blocks = Array.from({ length: 25 }, (_, i) => `Record ${i + 1}\nZażółć gęślą jaźń — Ç é ╔═╗ CO 96/728`);
  const options = { paper: 'letter', fontSize: 12, header: 'Notes {@date} page {@page} of {@pages}', footer: 'End', now };
  const { bytes, pages } = makePdf(blocks, { jsPDF, font, title: 'Test', ...options });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-'));
  assert.equal(pages, layoutPdf(blocks, options).pages.length);
  assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, pages);
  assert.match(text, /\/BaseFont \/DejaVuSansMono/);
  assert.match(text, /\/MediaBox \[0 0 612\.\d* 792\.\d*\]/);
  const preview = previewPdf(blocks, options);
  assert.match(preview, /── page 1 of \d+/);
  assert.match(preview, /Notes .* page 1 of \d+\n\nRecord 1/);
});

test('PDF in a serif or sans-serif font: lines break by the real widths of the letters', () => {
  const words = 'iiii '.repeat(60).trim(); // narrow letters: more per line than in monospace
  const wide = 'MMMM '.repeat(60).trim();
  const blocks = [`${words}\n${wide}`];
  for (const id of ['serif', 'sans']) {
    const { bytes, pages } = makePdf(blocks, { jsPDF, font: fontFile(id), paper: 'a4', fontSize: 10, now });
    const text = Buffer.from(bytes).toString('latin1');
    assert.match(text, new RegExp(`/BaseFont /${PDF_FONTS[id].family}`));
    assert.equal(pages, 1);
    // The same measuring the PDF used, through jsPDF.
    const doc = new jsPDF({ unit: 'mm' });
    doc.addFileToVFS(PDF_FONTS[id].file, fontFile(id).data);
    doc.addFont(PDF_FONTS[id].file, PDF_FONTS[id].family, 'normal');
    doc.setFont(PDF_FONTS[id].family, 'normal');
    const { layout, pages: laid } = layoutPdf(blocks, { paper: 'a4', fontSize: 10, measure: (s) => doc.getStringUnitWidth(s) });
    const lines = laid[0];
    const narrow = lines.filter((l) => l.startsWith('i'));
    const broad = lines.filter((l) => l.startsWith('M'));
    assert.ok(narrow[0].length > layout.chars, 'narrow letters fill more than a monospace line');
    assert.ok(broad[0].length < layout.chars, 'wide letters fill less');
    for (const l of lines) assert.ok(doc.getStringUnitWidth(l) * 10 * 25.4 / 72 <= layout.width + 1e-6);
  }
});
