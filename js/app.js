// The full-screen, keyboard-driven interface, in the style of the DOS original.
import {
  createDatabase, addRecord, updateRecord, deleteRecords, addField, renameField, deleteField,
  moveField, sortRecords, databaseFromImport, appendImport, validateDatabase, fieldNames, defaultPrintForm,
} from './model.js';
import { compileQuery, highlightTerms } from './search.js';
import { importFiles } from './importers.js';
import { exportDelimited, exportTagged, exportNotebookText, exportJson, toBytes } from './exporters.js';
import { renderReport } from './printform.js';
import { listSaved, saveDb, loadDb, removeDb, newKey } from './storage.js';
import { SAMPLE } from './sample.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  db: null,
  key: null,
  query: '',
  sortKeys: [],
  list: null, // records shown, after search and sort
  cursor: 0,
  mode: 'home',
  back: 'browse',
  homeCursor: 0,
  editId: null,
  formIndex: 0,
  imp: null,
  message: '',
  messageIsError: false,
};

// ---------- data helpers ----------

function refreshList() {
  if (!state.db) { state.list = []; return; }
  let recs = state.db.records;
  if (state.query) {
    try {
      recs = recs.filter(compileQuery(state.query, fieldNames(state.db)));
    } catch {
      state.query = '';
    }
  }
  if (state.sortKeys.length) recs = sortRecords(recs, state.sortKeys);
  state.list = recs;
  state.cursor = Math.max(0, Math.min(state.cursor, recs.length - 1));
}

function current() {
  return state.list?.[state.cursor] ?? null;
}

function persist() {
  if (!state.db || !state.key) return;
  if (!saveDb(state.key, state.db)) {
    say('Could not save in this browser (storage may be full). Use F10 Export > Notebook file to keep a copy.', true);
  }
}

let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 400);
}

function openDb(db, key = newKey()) {
  state.db = db;
  state.key = key;
  state.query = '';
  state.sortKeys = [];
  state.cursor = 0;
  state.formIndex = 0;
  refreshList();
  persist();
  go('browse');
}

function say(msg, isError = false) {
  state.message = msg;
  state.messageIsError = isError;
  renderStatus();
}

function download(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(s) {
  return (s || 'notebook').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'notebook';
}

// Delimiters are shown escaped so invisible characters can be typed.
function showDelim(d) {
  return (d ?? '').replace(/[\x00-\x1f]/g, (c) => ({ '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' })[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
function readDelim(s) {
  return (s ?? '').replace(/\\(t|n|f|r|x[0-9a-fA-F]{2}|\\)/g, (_, c) =>
    c === 't' ? '\t' : c === 'n' ? '\n' : c === 'f' ? '\f' : c === 'r' ? '\r' : c === '\\' ? '\\' : String.fromCharCode(parseInt(c.slice(1), 16)));
}

// ---------- navigation ----------

function go(mode) {
  if (mode !== state.mode && ['browse', 'view'].includes(state.mode)) state.back = state.mode;
  state.mode = mode;
  state.message = '';
  render();
}

function goBack() {
  go(state.db ? (state.back === 'view' && current() ? 'view' : 'browse') : 'home');
}

// ---------- rendering ----------

const KEYSETS = {
  home: [['N', 'New'], ['F9', 'Import'], ['O', 'Open file'], ['S', 'Sample'], ['Del', 'Delete'], ['F1', 'Help']],
  browse: [['F1', 'Help'], ['F2', 'Edit'], ['F3', 'Add'], ['F4', 'Find'], ['F5', 'All'], ['F6', 'Sort'], ['F7', 'Print'], ['F8', 'Fields'], ['F9', 'Import'], ['F10', 'Export'], ['Del', 'Delete'], ['Esc', 'Close']],
  edit: [['F10', 'Save'], ['Esc', 'Cancel']],
  dialog: [['Esc', 'Back'], ['F1', 'Help']],
};

function render() {
  document.body.dataset.mode = state.mode;
  renderTitle();
  const views = { home: renderHome, browse: renderBrowse, view: renderView, edit: renderEdit, find: renderBrowse, sort: renderSort, fields: renderFields, print: renderPrint, import: renderImport, export: renderExport, help: renderHelp };
  views[state.mode]();
  if (state.mode === 'find') renderFind();
  else $('#findbar').hidden = true;
  renderKeys();
  renderStatus();
}

function renderTitle() {
  const db = state.db;
  let right = '';
  if (db && state.list) {
    const n = state.list.length;
    const total = db.records.length;
    right = state.query ? `Found ${n} of ${total}` : `${total} record${total === 1 ? '' : 's'}`;
    if (['browse', 'view'].includes(state.mode) && n) right = `Rec ${state.cursor + 1}/${n} · ${right}`;
  }
  $('#title').innerHTML = `<span class="brand">NOTEBOOK II</span><span class="dbname">${esc(db?.name ?? '')}</span><span class="count">${esc(right)}</span>`;
}

function renderKeys() {
  const set = state.mode === 'home' ? 'home' : ['browse', 'view', 'find'].includes(state.mode) ? 'browse' : state.mode === 'edit' ? 'edit' : 'dialog';
  let keys = KEYSETS[set];
  if (state.mode === 'view') keys = [...keys.slice(0, -1), ['PgUp', 'Prev'], ['PgDn', 'Next'], ['Esc', 'List']];
  $('#keys').innerHTML = keys.map(([k, label]) => `<button type="button" data-key="${k}"><kbd>${k}</kbd>${label}</button>`).join('');
}

function renderStatus() {
  const bits = [];
  if (state.query) bits.push(`Find: ${state.query}`);
  if (state.sortKeys.length) bits.push(`Sorted by ${state.sortKeys.map((k) => k.field + (k.descending ? ' (Z-A)' : '')).join(', ')}`);
  const el = $('#status');
  el.textContent = state.message || bits.join('   ·   ') || ' ';
  el.classList.toggle('error', !!state.message && state.messageIsError);
}

function preview(text, max = 120) {
  const one = (text ?? '').replace(/\s*\n\s*/g, ' ¶ ');
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

function renderHome() {
  const saved = listSaved();
  state.homeCursor = Math.min(state.homeCursor, Math.max(0, saved.length - 1));
  const rows = saved.map((d, i) => `
    <tr data-i="${i}" class="${i === state.homeCursor ? 'cur' : ''}">
      <td>${esc(d.name)}</td><td class="num">${d.records}</td><td>${esc(new Date(d.modified).toLocaleString())}</td>
    </tr>`).join('');
  $('#main').innerHTML = `
    <div class="panel home">
      <h2>Databases</h2>
      ${saved.length ? `<table class="grid"><thead><tr><th>Name</th><th class="num">Records</th><th>Changed</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="hint">↑ ↓ to choose, Enter to open.</p>`
      : '<p>No databases yet. Press <kbd>N</kbd> to make one, <kbd>F9</kbd> to import a file from Notebook II or another program, or <kbd>S</kbd> to try a sample.</p>'}
      <h2>Bringing in your old files</h2>
      <p>Press <kbd>F9</kbd> and choose a Notebook II database's files together: <code>NAME.DAT</code>, <code>NAME.DEF</code> and <code>NAME.IDX</code> (and <code>NAME.MSC</code> and print formats, <code>*.R00</code>, if you have them). Import also reads text that Notebook II or other programs wrote: delimited text (tab, comma, <code>|</code>, <code>~</code> or any character you name), tagged text (<code>Author: …</code> or <code>%Author:…</code> lines), and DOS characters (code page 437). Any other file can be opened with <em>Salvage</em>, which pulls out the readable text.</p>
    </div>`;
  $$('#main tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => { state.homeCursor = +tr.dataset.i; render(); });
    tr.addEventListener('dblclick', () => openSaved(+tr.dataset.i));
  });
}

function openSaved(i) {
  const d = listSaved()[i];
  if (!d) return;
  try {
    openDb(loadDb(d.key), d.key);
  } catch (e) {
    say(e.message, true);
  }
}

const PAGE = 200;

function renderBrowse() {
  const db = state.db;
  const cols = db.fields.slice(0, 4).map((f) => f.name);
  const start = Math.floor(state.cursor / PAGE) * PAGE;
  const slice = state.list.slice(start, start + PAGE);
  const rows = slice.map((r, k) => {
    const i = start + k;
    return `<tr data-i="${i}" class="${i === state.cursor ? 'cur' : ''}"><td class="num">${i + 1}</td>${cols.map((c) => `<td>${esc(preview(r.values[c]))}</td>`).join('')}</tr>`;
  }).join('');
  const more = state.list.length > PAGE ? `<p class="hint">Showing ${start + 1}–${start + slice.length} of ${state.list.length}. PgUp/PgDn moves a page.</p>` : '';
  $('#main').innerHTML = state.list.length
    ? `<table class="grid browse"><thead><tr><th class="num">#</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${more}`
    : `<div class="panel"><p>${db.records.length ? 'No records match. Press <kbd>F5</kbd> to show all records or <kbd>F4</kbd> to search again.' : 'This database is empty. Press <kbd>F3</kbd> to add a record or <kbd>F9</kbd> to import some.'}</p></div>`;
  $$('#main tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => { state.cursor = +tr.dataset.i; render(); });
    tr.addEventListener('dblclick', () => { state.cursor = +tr.dataset.i; go('view'); });
  });
  $('#main tr.cur')?.scrollIntoView({ block: 'nearest' });
}

function highlight(text, terms) {
  const safe = esc(text);
  if (!terms.length) return safe;
  const alts = terms.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return safe.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${alts})`, 'giu'), '$1<mark>$2</mark>');
}

function renderView() {
  const rec = current();
  if (!rec) { go('browse'); return; }
  const terms = highlightTerms(state.query);
  $('#main').innerHTML = `<div class="record">${state.db.fields.map(({ name }) => {
    const v = rec.values[name] ?? '';
    return `<div class="field"><div class="fname">${esc(name)}</div><div class="fval ${v.trim() ? '' : 'empty'}">${v.trim() ? highlight(v, terms) : '(blank)'}</div></div>`;
  }).join('')}</div>`;
}

function renderEdit() {
  const rec = state.editId === null ? null : state.db.records.find((r) => r.id === state.editId);
  $('#main').innerHTML = `
    <form class="record edit" id="editform">
      <h2>${rec ? 'Edit record' : 'New record'}</h2>
      ${state.db.fields.map(({ name }, i) => `
        <label class="field"><span class="fname">${esc(name)}</span>
          <textarea name="f${i}" rows="1" spellcheck="true">${esc(rec?.values[name] ?? '')}</textarea></label>`).join('')}
      <p class="hint">Fields can be any length. <kbd>F10</kbd> or <kbd>Ctrl</kbd>+<kbd>S</kbd> saves, <kbd>Esc</kbd> cancels.</p>
    </form>`;
  const grow = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
  state.dirty = false;
  $$('#editform textarea').forEach((t) => { grow(t); t.addEventListener('input', () => { grow(t); state.dirty = true; }); });
  $('#editform textarea')?.focus();
}

function saveEdit() {
  const values = {};
  state.db.fields.forEach(({ name }, i) => { values[name] = $(`#editform [name=f${i}]`).value.replace(/\s+$/, ''); });
  const rec = state.editId === null ? addRecord(state.db, values) : updateRecord(state.db, state.editId, values);
  persist();
  refreshList();
  const i = state.list.indexOf(rec);
  if (i >= 0) {
    state.cursor = i;
    go('view');
    say('Saved.');
  } else {
    go('browse');
    say('Saved. The record does not match the current search, so it is not in this list. F5 shows all.');
  }
}

function renderFind() {
  const bar = $('#findbar');
  bar.hidden = false;
  const input = $('#findinput');
  input.value = state.query;
  input.focus();
  input.select();
}

function runFind(q) {
  q = q.trim();
  try {
    compileQuery(q, fieldNames(state.db));
  } catch (e) {
    say(e.message, true);
    return;
  }
  state.query = q;
  state.cursor = 0;
  refreshList();
  go('browse');
  if (q) say(state.list.length ? `Found ${state.list.length} record${state.list.length === 1 ? '' : 's'}.` : 'No records found.', !state.list.length);
}

function fieldOptions(selected, blank) {
  return (blank ? `<option value="">${blank}</option>` : '') +
    state.db.fields.map(({ name }) => `<option ${name === selected ? 'selected' : ''}>${esc(name)}</option>`).join('');
}

function renderSort() {
  const keys = [0, 1, 2].map((i) => state.sortKeys[i] ?? { field: '', descending: false });
  $('#main').innerHTML = `
    <form class="panel" id="sortform">
      <h2>Sort</h2>
      ${keys.map((k, i) => `
        <div class="row"><label>${['First by', 'Then by', 'Then by'][i]}</label>
          <select name="f${i}">${fieldOptions(k.field, i ? '(nothing)' : '(order entered)')}</select>
          <label class="check"><input type="checkbox" name="d${i}" ${k.descending ? 'checked' : ''}> Z to A</label></div>`).join('')}
      <p class="hint">Numbers sort by value, so 9 comes before 10. Blank fields go last.</p>
      <div class="buttons"><button type="submit">Sort</button></div>
    </form>`;
  $('#sortform').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.sortKeys = [0, 1, 2].map((i) => ({ field: f.get(`f${i}`), descending: !!f.get(`d${i}`) })).filter((k) => k.field);
    refreshList();
    state.cursor = 0;
    go('browse');
  });
  $('#sortform select').focus();
}

function renderFields() {
  const db = state.db;
  $('#main').innerHTML = `
    <div class="panel" id="fields">
      <h2>Fields</h2>
      <table class="grid"><tbody>${db.fields.map(({ name }, i) => `
        <tr><td class="num">${i + 1}</td>
          <td><input data-rename="${esc(name)}" value="${esc(name)}" aria-label="Field name"></td>
          <td class="buttons">
            <button type="button" data-move="${esc(name)}" data-d="-1" ${i ? '' : 'disabled'} title="Move up">↑</button>
            <button type="button" data-move="${esc(name)}" data-d="1" ${i < db.fields.length - 1 ? '' : 'disabled'} title="Move down">↓</button>
            <button type="button" data-del="${esc(name)}">Delete</button></td></tr>`).join('')}
      </tbody></table>
      <form id="addfield" class="row"><input name="name" placeholder="New field name" aria-label="New field name"><button type="submit">Add field</button></form>
      <h2>Database name</h2>
      <div class="row"><input id="dbname" value="${esc(db.name)}" aria-label="Database name"></div>
      <p class="hint">Renaming a field keeps its contents and updates print forms. Change a name and press Enter.</p>
    </div>`;
  const done = (fn) => { try { fn(); persist(); refreshList(); render(); } catch (e) { say(e.message, true); } };
  $$('[data-rename]').forEach((inp) => inp.addEventListener('change', () => done(() => renameField(db, inp.dataset.rename, inp.value))));
  $$('[data-move]').forEach((b) => b.addEventListener('click', () => done(() => moveField(db, b.dataset.move, +b.dataset.d))));
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const n = db.records.filter((r) => (r.values[b.dataset.del] ?? '').trim()).length;
    if (confirm(`Delete the field "${b.dataset.del}"?${n ? ` Its text in ${n} record${n === 1 ? '' : 's'} will be lost.` : ''}`)) done(() => deleteField(db, b.dataset.del));
  }));
  $('#addfield').addEventListener('submit', (e) => { e.preventDefault(); done(() => addField(db, e.target.name.value)); });
  $('#dbname').addEventListener('change', (e) => done(() => { db.name = e.target.value.trim() || db.name; }));
}

function renderPrint() {
  const db = state.db;
  if (!db.printForms.length) db.printForms.push(defaultPrintForm(fieldNames(db)));
  state.formIndex = Math.min(state.formIndex, db.printForms.length - 1);
  const form = db.printForms[state.formIndex];
  $('#main').innerHTML = `
    <div class="panel print">
      <div class="printform">
        <h2>Print form</h2>
        <div class="row"><select id="formsel" aria-label="Print form">${db.printForms.map((f, i) => `<option value="${i}" ${i === state.formIndex ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
          <button type="button" id="newform">New form</button><button type="button" id="delform" ${db.printForms.length > 1 ? '' : 'disabled'}>Delete form</button></div>
        <div class="row"><label>Name</label><input id="formname" value="${esc(form.name)}"><label>Width</label><input id="formwidth" type="number" min="20" max="250" value="${form.width}"></div>
        <textarea id="template" spellcheck="false" rows="10">${esc(form.template)}</textarea>
        <div class="row"><label>Page header</label><input id="formheader" value="${esc(form.header ?? '')}" placeholder="none" size="40"></div>
        <div class="row"><label>Page footer</label><input id="formfooter" value="${esc(form.footer ?? '')}" placeholder="none" size="40"></div>
        <p class="hint"><code>{Field}</code> puts in a field, <code>{Field:20}</code> exactly 20 characters of it. <code>{#}</code> is the record's number, <code>{Date}</code> today's date, <code>{Time}</code> the time. A line written as <code>[[ … ]]</code> is left out when its fields are blank. With a header or footer the printout is cut into pages of ${form.pageLines || 66} lines; <code>{Page}</code> is the page number. Fields: ${db.fields.map((f) => `<code>{${esc(f.name)}}</code>`).join(' ')}</p>
        <div class="buttons"><button type="button" id="doprint">Print</button><button type="button" id="savetxt">Save as text</button>
          <select id="txtenc" aria-label="Text encoding"><option value="utf-8">UTF-8</option><option value="cp437">DOS (code page 437)</option></select></div>
      </div>
      <div class="printpreview"><h2>Preview — ${state.list.length} record${state.list.length === 1 ? '' : 's'}</h2><pre id="printout"></pre></div>
    </div>`;
  const update = () => {
    const text = renderReport(form, state.list.slice(0, 100), fieldNames(db)).replace(/\f/g, `${'─'.repeat(form.width)}\n`);
    $('#printout').textContent = text + (state.list.length > 100 ? `\n… and ${state.list.length - 100} more (all are printed).\n` : '');
  };
  update();
  $('#template').addEventListener('input', (e) => { form.template = e.target.value; update(); persistSoon(); });
  $('#formname').addEventListener('input', (e) => { form.name = e.target.value; persistSoon(); });
  for (const k of ['header', 'footer']) $(`#form${k}`).addEventListener('input', (e) => { form[k] = e.target.value; update(); persistSoon(); });
  $('#formname').addEventListener('change', () => render());
  $('#formwidth').addEventListener('input', (e) => { form.width = Math.max(20, Math.min(250, +e.target.value || 76)); update(); persistSoon(); });
  $('#formsel').addEventListener('change', (e) => { state.formIndex = +e.target.value; render(); });
  $('#newform').addEventListener('click', () => {
    db.printForms.push({ ...defaultPrintForm(fieldNames(db)), name: `Form ${db.printForms.length + 1}` });
    state.formIndex = db.printForms.length - 1;
    persist();
    render();
  });
  $('#delform').addEventListener('click', () => {
    if (!confirm(`Delete the print form "${form.name}"?`)) return;
    db.printForms.splice(state.formIndex, 1);
    persist();
    render();
  });
  const fullText = () => renderReport(form, state.list, fieldNames(db), { title: db.name });
  $('#doprint').addEventListener('click', () => {
    // One block per page so form feeds become page breaks.
    $('#print-area').replaceChildren(...fullText().split('\f').map((page) => Object.assign(document.createElement('div'), { className: 'page', textContent: page })));
    window.print();
  });
  $('#savetxt').addEventListener('click', () => {
    const enc = $('#txtenc').value;
    download(`${safeName(db.name)}.txt`, toBytes(fullText().replace(/\n/g, '\r\n'), enc), 'text/plain');
  });
}

// ---------- import ----------

// Several files can be chosen at once: a Notebook II database is NAME.DAT,
// NAME.DEF, NAME.IDX and NAME.MSC (plus any print formats, *.R00).
function pickFiles(onFiles) {
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
  input.addEventListener('change', async () => {
    const files = await Promise.all([...input.files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    if (files.length) onFiles(files);
  });
  input.click();
}

function startImport(files) {
  const main = files.find((f) => /\.dat$/i.test(f.name)) ?? files[0];
  const name = files.length > 1 ? files.map((f) => f.name).join(', ') : main.name;
  state.imp = { name, files, opts: { format: 'auto', encoding: 'auto' }, target: 'new', dbName: main.name.replace(/\.[^.]+$/, '') };
  parseImport();
  go('import');
}

function parseImport() {
  const imp = state.imp;
  try {
    imp.result = importFiles(imp.files, imp.opts);
    imp.error = '';
  } catch (e) {
    imp.result = null;
    imp.error = e.message;
  }
}

function renderImport() {
  const imp = state.imp;
  const r = imp.result;
  const o = r?.options ?? {};
  const delimited = r?.format === 'delimited';
  const fmtSel = (v, l) => `<option value="${v}" ${imp.opts.format === v ? 'selected' : ''}>${l}</option>`;
  const encSel = (v, l) => `<option value="${v}" ${imp.opts.encoding === v ? 'selected' : ''}>${l}</option>`;
  const shown = r ? r.records.slice(0, 25) : [];
  $('#main').innerHTML = `
    <div class="panel" id="importer">
      <h2>Import ${esc(imp.name)}</h2>
      <div class="row">
        <label>Read as</label><select data-opt="format">${fmtSel('auto', 'Detect automatically')}${fmtSel('notebook', 'Notebook II database (.DAT .DEF .IDX)')}${fmtSel('delimited', 'Delimited text')}${fmtSel('tagged', 'Tagged text (Field: value)')}${fmtSel('json', 'Notebook file (.json)')}${fmtSel('salvage', 'Salvage text from any file')}</select>
        <label>Characters</label><select data-opt="encoding">${encSel('auto', 'Detect')}${encSel('cp437', 'DOS (code page 437)')}${encSel('utf-8', 'UTF-8')}</select>
      </div>
      ${delimited ? `
      <div class="row">
        <label>Field delimiter</label><input data-delim="fieldDelim" value="${esc(showDelim(o.fieldDelim))}" list="delims" size="6">
        <label>Record delimiter</label><input data-delim="recordDelim" value="${esc(showDelim(o.recordDelim))}" list="delims" size="6">
        <label>Line break marker</label><input data-delim="newlineMarker" value="${esc(showDelim(o.newlineMarker))}" list="delims" size="6" placeholder="none">
        <label>First row is field names</label><select data-opt="header"><option value="true" ${o.header ? 'selected' : ''}>Yes</option><option value="false" ${o.header ? '' : 'selected'}>No</option></select>
      </div>
      <datalist id="delims"><option value="\\t">Tab</option><option value=",">Comma</option><option value="|"></option><option value="~"></option><option value="^"></option><option value=";"></option><option value="\\n">Line break</option><option value="\\f">Form feed</option><option value="\\x1e">Record separator</option><option value="\\x1f">Unit separator</option><option value="\\x14">¶ (DOS)</option></datalist>
      <p class="hint">Type <code>\\t</code> for tab, <code>\\n</code> for a line break, <code>\\f</code> for form feed or <code>\\xNN</code> for any character code.</p>` : ''}
      ${r?.format === 'notebook' ? `<div class="row"><label class="check"><input type="checkbox" id="incdel" ${o.includeDeleted ? 'checked' : ''} ${o.deleted || o.includeDeleted ? '' : 'disabled'}> Include records marked deleted${o.deleted ? ` (${o.deleted})` : ''}</label></div>
      ${r.printForms?.length ? `<p>Print formats: ${r.printForms.map((f) => `<code>${esc(f.name)}</code>`).join(' ')}</p>` : ''}` : ''}
      ${r?.format === 'salvage' ? `<div class="row"><label>Shortest piece</label><input type="number" min="1" data-num="minLength" value="${o.minLength}"><label>Join pieces closer than</label><input type="number" min="0" data-num="mergeGap" value="${o.mergeGap}"> bytes</div>` : ''}
      ${imp.error ? `<p class="error">${esc(imp.error)}</p>` : ''}
      ${(r?.warnings ?? []).map((w) => `<p class="warn">${esc(w)}</p>`).join('')}
      ${r ? `<p>${r.records.length} record${r.records.length === 1 ? '' : 's'}, ${r.fields.length} field${r.fields.length === 1 ? '' : 's'}: ${r.fields.map((f) => `<code>${esc(f)}</code>`).join(' ')}</p>
      <div class="scrollx"><table class="grid"><thead><tr>${r.fields.map((f) => `<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>
        ${shown.map((rec) => `<tr>${r.fields.map((f) => `<td>${esc(preview(rec[f], 60))}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      ${r.records.length > shown.length ? `<p class="hint">First ${shown.length} records shown.</p>` : ''}
      <div class="row target">
        <label class="check"><input type="radio" name="target" value="new" ${imp.target === 'new' ? 'checked' : ''}> New database named</label>
        <input id="newname" value="${esc(imp.dbName)}" aria-label="New database name">
        ${state.db ? `<label class="check"><input type="radio" name="target" value="append" ${imp.target === 'append' ? 'checked' : ''}> Add to ${esc(state.db.name)}</label>` : ''}
      </div>
      <div class="buttons"><button type="button" id="doimport" ${r.records.length ? '' : 'disabled'}>Import</button></div>` : ''}
    </div>`;
  const reparse = () => { parseImport(); render(); };
  $$('[data-opt]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.opt;
    if (k === 'header') Object.assign(imp.opts, { ...o, format: 'delimited', header: el.value === 'true' });
    else imp.opts[k] = el.value;
    if (k === 'format') for (const x of ['fieldDelim', 'recordDelim', 'newlineMarker', 'header', 'quote', 'minLength', 'mergeGap', 'includeDeleted']) delete imp.opts[x];
    reparse();
  }));
  $$('[data-delim]').forEach((el) => el.addEventListener('change', () => {
    Object.assign(imp.opts, { ...o, format: 'delimited', [el.dataset.delim]: readDelim(el.value) });
    if (!imp.opts.fieldDelim) imp.opts.fieldDelim = '\t';
    if (!imp.opts.recordDelim) imp.opts.recordDelim = '\n';
    reparse();
  }));
  $$('[data-num]').forEach((el) => el.addEventListener('change', () => { imp.opts[el.dataset.num] = Math.max(0, +el.value || 0); reparse(); }));
  $('#incdel')?.addEventListener('change', (e) => { imp.opts.includeDeleted = e.target.checked; reparse(); });
  $$('[name=target]').forEach((el) => el.addEventListener('change', () => { imp.target = el.value; }));
  $('#newname')?.addEventListener('input', (e) => { imp.dbName = e.target.value; });
  $('#doimport')?.addEventListener('click', finishImport);
}

function finishImport() {
  const { result: r, target, dbName } = state.imp;
  if (target === 'append' && state.db) {
    // Match incoming fields to existing ones regardless of case.
    const map = Object.fromEntries(r.fields.map((f) => [f, state.db.fields.find((d) => d.name.toLowerCase() === f.toLowerCase())?.name ?? f]));
    appendImport(state.db, r, map);
    persist();
    refreshList();
    state.imp = null;
    go('browse');
    say(`Added ${r.records.length} records.`);
    return;
  }
  const db = r.database ? validateDatabase(structuredClone(r.database)) : databaseFromImport(dbName.trim() || 'Imported', r);
  if (r.database && dbName.trim()) db.name = dbName.trim();
  state.imp = null;
  openDb(db);
  say(`Imported ${db.records.length} records.`);
}

// ---------- export ----------

function renderExport() {
  const n = state.list.length;
  const total = state.db.records.length;
  $('#main').innerHTML = `
    <form class="panel" id="exportform">
      <h2>Export</h2>
      <div class="row"><label>Format</label><select name="format">
        <option value="json">Notebook file (.json) — keeps fields, print forms, everything</option>
        <option value="csv">Comma-separated (.csv)</option>
        <option value="tab">Tab-delimited (.txt)</option>
        <option value="tagged">Tagged text — Field: value (.txt)</option>
        <option value="notebook">Notebook II import text — %Field:value (.txt), for the DOS program</option>
        <option value="custom">Delimited, my own characters (.txt)</option>
      </select></div>
      <div class="row custom" hidden>
        <label>Field delimiter</label><input name="fieldDelim" value="|" size="6">
        <label>Record delimiter</label><input name="recordDelim" value="\\r\\n" size="6">
        <label>Line break marker</label><input name="newlineMarker" value="\\x14" size="6">
        <label class="check"><input type="checkbox" name="header" checked> Field names in first row</label>
      </div>
      <div class="row"><label>Characters</label><select name="encoding"><option value="utf-8">UTF-8 (modern programs)</option><option value="cp437">DOS (code page 437)</option></select></div>
      <div class="row"><label>Records</label><select name="which">
        <option value="list">${state.query ? `The ${n} found` : `All ${total}`}${state.sortKeys.length ? ', in sorted order' : ''}</option>
        ${state.query ? `<option value="all">All ${total}</option>` : ''}
      </select></div>
      <div class="buttons"><button type="submit">Save file</button></div>
    </form>`;
  const form = $('#exportform');
  const sync = () => {
    $('.custom', form).hidden = form.format.value !== 'custom';
    form.encoding.disabled = form.format.value === 'json';
  };
  form.format.addEventListener('change', () => {
    if (form.format.value === 'notebook') form.encoding.value = 'cp437';
    sync();
  });
  sync();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const db = state.db;
    const recs = form.which.value === 'all' ? db.records : state.list;
    const f = fieldNames(db);
    const base = safeName(db.name);
    const enc = form.encoding.value;
    switch (form.format.value) {
      case 'json': return download(`${base}.nb2.json`, toBytes(exportJson(db, recs)), 'application/json');
      case 'csv': return download(`${base}.csv`, toBytes(exportDelimited(f, recs), enc), 'text/csv');
      case 'tab': return download(`${base}.txt`, toBytes(exportDelimited(f, recs, { fieldDelim: '\t' }), enc), 'text/plain');
      case 'tagged': return download(`${base}.txt`, toBytes(exportTagged(f, recs), enc), 'text/plain');
      case 'notebook': return download(`${base.slice(0, 8)}.txt`, toBytes(exportNotebookText(f, recs), enc), 'text/plain');
      case 'custom': return download(`${base}.txt`, toBytes(exportDelimited(f, recs, {
        fieldDelim: readDelim(form.fieldDelim.value) || '|',
        recordDelim: readDelim(form.recordDelim.value) || '\r\n',
        newlineMarker: readDelim(form.newlineMarker.value),
        header: form.header.checked,
        quote: false,
      }), enc), 'text/plain');
    }
  });
}

function renderHelp() {
  $('#main').innerHTML = $('#helptext').innerHTML;
}

// ---------- commands ----------

function newDatabase() {
  const name = prompt('Name of the new database:', 'Notes');
  if (!name) return;
  const fields = prompt('Field names, separated by commas:', 'Author, Title, Year, Keywords, Notes');
  if (fields === null) return;
  const list = [...new Set(fields.split(',').map((s) => s.trim()).filter(Boolean))];
  openDb(createDatabase(name.trim(), list.length ? list : ['Text']));
}

function deleteCurrent() {
  const rec = current();
  if (!rec) return;
  const label = preview(rec.values[state.db.fields[0].name], 50) || `record ${state.cursor + 1}`;
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
  deleteRecords(state.db, [rec.id]);
  persist();
  refreshList();
  if (!state.list.length) go('browse');
  else render();
  say('Record deleted.');
}

function moveCursor(delta) {
  if (!state.list.length) return;
  state.cursor = Math.max(0, Math.min(state.list.length - 1, state.cursor + delta));
  render();
}

function onKey(key, e) {
  const m = state.mode;
  const typing = e && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

  if (key === 'F1') return go(m === 'help' ? (state.db ? 'browse' : 'home') : 'help');

  if (m === 'home') {
    const saved = listSaved();
    if (typing) return false;
    if (key === 'ArrowDown') { state.homeCursor = Math.min(saved.length - 1, state.homeCursor + 1); render(); return; }
    if (key === 'ArrowUp') { state.homeCursor = Math.max(0, state.homeCursor - 1); render(); return; }
    if (key === 'Enter') return openSaved(state.homeCursor);
    if (key === 'n' || key === 'N') return newDatabase();
    if (key === 's' || key === 'S') return openDb(databaseFromImport(SAMPLE.name, SAMPLE));
    if (key === 'o' || key === 'O' || key === 'F9') return pickFiles(startImport);
    if (key === 'Delete' && saved[state.homeCursor]) {
      const d = saved[state.homeCursor];
      if (confirm(`Delete the database "${d.name}" from this browser? Export it first if you want a copy.`)) { removeDb(d.key); render(); }
      return;
    }
    return false;
  }

  if (m === 'edit') {
    if (key === 'F10' || key === 'Ctrl+s') return saveEdit();
    if (key === 'Escape') { if (!state.dirty || confirm('Leave without saving changes?')) goBack(); return; }
    return false;
  }

  if (m === 'find') {
    if (key === 'Escape') return go('browse');
    return false;
  }

  if (key === 'Escape') {
    if (m === 'view') return go('browse');
    if (m === 'browse') { state.db = null; state.key = null; state.list = null; return go('home'); }
    if (m === 'import' && !state.db) return go('home');
    if (m === 'help' && !state.db) return go('home');
    return goBack();
  }
  if (!state.db) return false;

  const commands = {
    F2: () => { if (current()) { state.editId = current().id; go('edit'); } },
    F3: () => { state.editId = null; go('edit'); },
    F4: () => go('find'),
    F5: () => { state.query = ''; refreshList(); go('browse'); },
    F6: () => go('sort'),
    F7: () => go('print'),
    F8: () => go('fields'),
    F9: () => pickFiles(startImport),
    F10: () => go('export'),
  };
  if (commands[key]) return commands[key]();

  if (typing) return false;
  if (m === 'browse' || m === 'view') {
    const page = m === 'view' ? 1 : 15;
    const nav = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if (m === 'view') Object.assign(nav, { ArrowRight: 1, ArrowLeft: -1 });
    if (key in nav) return moveCursor(nav[key]);
    if (key === 'Home') return moveCursor(-Infinity);
    if (key === 'End') return moveCursor(Infinity);
    if (key === 'Enter' && m === 'browse' && current()) return go('view');
    if (key === 'Delete') return deleteCurrent();
    if (key === '/') return go('find');
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  let key = e.key;
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 's') key = 'Ctrl+s';
  else if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Single letters act as commands only on the database list.
  if (key.length === 1 && state.mode !== 'home' && key !== '/') return;
  if (onKey(key, e) !== false) e.preventDefault();
});

$('#keys').addEventListener('click', (e) => {
  const b = e.target.closest('[data-key]');
  if (!b) return;
  const k = b.dataset.key;
  onKey({ Del: 'Delete', Esc: 'Escape', PgUp: 'PageUp', PgDn: 'PageDown' }[k] ?? k, null);
});

$('#findbar').addEventListener('submit', (e) => { e.preventDefault(); runFind($('#findinput').value); });

render();
