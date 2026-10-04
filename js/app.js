// The full-screen interface, in the style of the DOS original: a title bar, the
// screen, a status line and a command bar. Every command has a name, a letter
// key and a place in the command palette (Ctrl+K); the original F-keys still
// work too.
import {
  createDatabase, addRecord, updateRecord, deleteRecords, addField, renameField, deleteField,
  moveField, sortRecords, carryOver, copiesFromPrevious, setFieldCopy, setFieldOption, fieldLines, shownInList, touchRecord, LAYOUTS, databaseFromImport, appendImport, validateDatabase, fieldNames, defaultPrintForm,
} from './model.js';
import { compileQuery, highlightTerms } from './search.js';
import { importFiles } from './importers.js';
import { exportDelimited, exportTagged, exportNotebookText, exportVertical, exportJson, toBytes } from './exporters.js';
import { renderReport } from './printform.js';
import { listSaved, saveDb, loadDb, removeDb, newKey } from './storage.js';
import { SAMPLE } from './sample.js';
import { getTheme, setTheme, nextTheme } from './theme.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const CTRL = MAC ? '⌘' : 'Ctrl ';

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
  viewId: null, // the record open on the record screen
  viewSnapshot: null, // its values when it was opened, for Revert
  viewIsNew: false,
  editField: 0, // the field that last had the cursor on the record screen
  copySource: null, // the record "Copy previous" copies from
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

function viewed() {
  return state.db?.records.find((r) => r.id === state.viewId) ?? null;
}

// Asks the browser not to clear this site's storage when space runs low.
let askedToKeep = false;
function persist() {
  if (!state.db || !state.key) return;
  if (!askedToKeep) { askedToKeep = true; navigator.storage?.persist?.().catch(() => {}); }
  if (!saveDb(state.key, state.db)) {
    say('Could not save in this browser (storage may be full). Use Export > Notebook file to keep a copy.', true);
  }
}

let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 400);
}

// Write anything still waiting when the tab is hidden, closed or reloaded.
function flush() {
  if (!persistTimer) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  persist();
}
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

function openDb(db, key = newKey()) {
  state.db = db;
  state.key = key;
  state.query = '';
  state.sortKeys = (db.sortKeys ?? []).filter((k) => db.fields.some((f) => f.name === k.field));
  state.cursor = 0;
  state.formIndex = 0;
  $('#search').value = '';
  refreshList();
  persist();
  go('browse');
  if (needsBackup(db)) say(`This notebook has not been backed up for a while. Backup (${keyLabel('Ctrl+Shift+s')}) saves a copy as a file.`);
}

// The notebook remembers its sort; "order entered" is no sort at all.
function setSort(keys) {
  state.sortKeys = keys;
  state.db.sortKeys = keys;
  persist();
}

const WEEK = 7 * 24 * 3600 * 1000;
function needsBackup(db) {
  if (!db.records.length) return false;
  if (!db.lastBackup) return Date.now() - Date.parse(db.created ?? db.modified) > WEEK;
  return db.modified > db.lastBackup && Date.now() - Date.parse(db.lastBackup) > WEEK;
}

// Notebooks live in this browser's storage, which is lost if the browser's
// site data is cleared. A backup is the same file Export > Notebook file
// makes; Import reads it back.
function backupDb() {
  const db = state.db;
  leaveRecord();
  db.lastBackup = new Date().toISOString();
  download(`${safeName(db.name)}-${db.lastBackup.slice(0, 10)}.nb2.json`, toBytes(exportJson(db)), 'application/json');
  persist();
  if (state.mode === 'view') render();
  say('Backup saved to your downloads. Import reads it back.');
}

function closeDb() {
  leaveRecord();
  persist();
  state.db = null; state.key = null; state.list = null; state.query = '';
  go('home');
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
  if (state.mode === 'view' && mode !== 'view') leaveRecord();
  if (mode !== state.mode && ['browse', 'view'].includes(state.mode)) state.back = state.mode;
  state.mode = mode;
  state.message = '';
  render();
}

function goBack() {
  go(state.db ? 'browse' : 'home');
}

// ---------- commands ----------
//
// key: the letter (or key name) that runs it; fkey: the original F-key;
// where: the screens it belongs to; bar: shown on the command bar there.

const COMMANDS = [
  { id: 'newdb', label: 'New notebook', key: 'n', where: ['home'], bar: true, run: () => go('newdb') },
  { id: 'sample', label: 'Open the sample', key: 's', where: ['home'], bar: true, run: () => openDb(databaseFromImport(SAMPLE.name, SAMPLE)) },
  { id: 'open', label: 'Open selected database', key: 'Enter', where: ['home'], run: () => openSaved(state.homeCursor) },
  { id: 'deldb', label: 'Delete selected database', key: 'Delete', where: ['home'], bar: true, run: () => deleteSavedDb() },

  { id: 'back', label: 'Back to the list', key: 'Escape', where: ['view'], bar: true, run: () => go('browse') },
  { id: 'prev', label: 'Previous record', key: 'PageUp', where: ['view'], bar: true, run: () => moveRecord(-1) },
  { id: 'next', label: 'Next record', key: 'PageDown', where: ['view'], bar: true, run: () => moveRecord(1) },
  { id: 'new', label: 'New note', key: 'n', fkey: 'F3', where: ['browse', 'view'], bar: true, run: () => newRecord() },
  { id: 'edit', label: 'Edit record', key: 'e', fkey: 'F2', where: ['browse', 'view'], run: () => editRecord() },
  { id: 'copyprev', label: 'Copy previous (the fields ticked "Copy with F5")', key: 'Ctrl+d', fkey: 'F5', barKey: 'F5', where: ['view'], bar: true, run: () => copyFromPrevious(false) },
  { id: 'copyfield', label: 'Copy this field from previous', key: 'Ctrl+Shift+d', fkey: 'F6', barKey: 'F6', where: ['view'], bar: true, run: () => copyFromPrevious(true) },
  { id: 'save', label: 'Save', key: 'Ctrl+s', fkey: 'F10', barKey: 'F10', where: ['view'], bar: true, run: () => saveRecord() },
  { id: 'revert', label: 'Revert changes to this record', where: ['view'], bar: true, run: () => revertRecord() },
  { id: 'find', label: 'Find', key: '/', fkey: 'F4', where: ['browse', 'view'], bar: true, run: () => focusSearch() },
  { id: 'all', label: 'Show all records', fkey: 'F5', where: ['browse'], run: () => clearSearch() },
  { id: 'sort', label: 'Sort…', key: 's', fkey: 'F6', where: ['browse'], bar: true, run: () => go('sort') },
  { id: 'print', label: 'Print', key: 'p', fkey: 'F7', where: ['browse', 'view'], bar: true, run: () => go('print') },
  { id: 'fields', label: 'Fields', fkey: 'F8', where: ['browse', 'view'], bar: true, run: () => go('fields') },
  { id: 'import', label: 'Import', key: 'i', fkey: 'F9', where: ['home', 'browse', 'view'], bar: true, run: () => pickFiles(startImport) },
  { id: 'export', label: 'Export', key: 'x', fkey: 'F10', where: ['browse', 'view'], bar: true, run: () => go('export') },
  { id: 'backup', label: 'Backup: save a copy as a file', key: 'Ctrl+Shift+s', where: ['browse', 'view'], bar: true, run: () => backupDb() },
  { id: 'delete', label: 'Delete record', key: 'Delete', where: ['browse', 'view'], bar: true, run: () => deleteCurrent() },
  { id: 'close', label: 'Close database', key: 'Escape', where: ['browse'], bar: true, run: () => closeDb() },
  { id: 'dback', label: 'Back', key: 'Escape', where: ['sort', 'fields', 'print', 'import', 'export', 'help', 'newdb'], bar: true, run: () => (state.db ? go('browse') : go('home')) },
  { id: 'help', label: 'Help', key: '?', fkey: 'F1', where: ['home', 'browse', 'view', 'sort', 'fields', 'print', 'import', 'export'], bar: true, run: () => go('help') },
  { id: 'theme', label: 'Light or dark screen', key: 'Alt+t', where: ['*'], run: () => cycleTheme() },
  { id: 'palette', label: 'Commands', key: 'Ctrl+k', where: ['*'], bar: true, run: () => openPalette() },
];

const KEY_NAMES = { Escape: 'Esc', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn', Enter: 'Enter' };
const MOD_NAMES = MAC ? { Ctrl: '⌘', Shift: '⇧', Alt: '⌥' } : { Ctrl: 'Ctrl+', Shift: 'Shift+', Alt: 'Alt+' };
function keyLabel(key) {
  if (!key) return '';
  const parts = key.split('+');
  const k = parts.pop() || '+';
  return parts.map((m) => MOD_NAMES[m]).join('') + (KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k));
}

function available(c) {
  if (!(c.where.includes('*') || c.where.includes(state.mode))) return false;
  if (['browse', 'view'].includes(state.mode) && !state.db) return false;
  return true;
}

function runCommand(id) {
  const c = COMMANDS.find((x) => x.id === id);
  if (c && available(c)) c.run();
}

// ---------- rendering ----------

function render() {
  document.body.dataset.mode = state.mode;
  renderTitle();
  const views = { home: renderHome, newdb: renderNewDb, browse: renderBrowse, view: renderView, sort: renderSort, fields: renderFields, print: renderPrint, import: renderImport, export: renderExport, help: renderHelp };
  views[state.mode]();
  renderKeys();
  renderStatus();
}

function renderTitle() {
  const db = state.db;
  let right = '';
  if (db && state.list) {
    const n = state.list.length;
    const total = db.records.length;
    right = state.query ? `${n} of ${total} found` : `${total} record${total === 1 ? '' : 's'}`;
    if (state.mode === 'view' && n) {
      const i = state.list.findIndex((r) => r.id === state.viewId);
      if (i >= 0) right = `${i + 1} of ${n}${state.query ? ' found' : ''}`;
    }
  }
  $('#title .dbname').textContent = db?.name ?? '';
  $('#title .count').textContent = right;
  const search = $('#search');
  search.hidden = !db;
  search.placeholder = `Find (/)   e.g. smith  author:smith  year>1980`;
  $('#themebtn').textContent = { auto: 'Auto', light: 'Light', dark: 'Dark' }[getTheme()];
}

function renderKeys() {
  const shown = COMMANDS.filter((c) => c.bar && available(c) && !(c.id === 'revert' && !recordChanged()));
  $('#keys').innerHTML = shown.map((c) => {
    const k = keyLabel(c.barKey ?? c.key);
    return `<button type="button" data-cmd="${c.id}" title="${esc(c.label)}${k ? ` (${esc(k)})` : ''}"><span>${esc(barLabel(c))}</span>${k ? `<kbd>${esc(k)}</kbd>` : ''}</button>`;
  }).join('');
}

const SHORT = { newdb: 'New', sample: 'Sample', deldb: 'Delete', back: 'List', prev: 'Prev', next: 'Next', copyprev: 'Copy previous', copyfield: 'Copy field', revert: 'Revert', delete: 'Delete', close: 'Close', dback: 'Back', new: 'New note', sort: 'Sort', backup: 'Backup' };
function barLabel(c) {
  return SHORT[c.id] ?? c.label;
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
      <h2>Notebooks</h2>
      ${saved.length ? `<table class="grid"><thead><tr><th>Name</th><th class="num">Records</th><th>Changed</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="hint">Click a database to open it, or use ↑ ↓ and Enter.</p>`
      : '<p>No notebooks yet. Press <kbd>N</kbd> to make one, <kbd>I</kbd> to import a file from Notebook II or another program, or <kbd>S</kbd> to try a sample.</p>'}
      <p class="hint">Every command is on the bar at the bottom, and <kbd>${esc(keyLabel('Ctrl+k'))}</kbd> lists them all.</p>
      <p class="warn">Notebooks are kept in this browser only. Clearing the browser's history or site data deletes them, and they are not on your other devices. Inside a notebook, <em>Backup</em> (<kbd>${esc(keyLabel('Ctrl+Shift+s'))}</kbd>) saves a copy as a file; Import reads it back.</p>
      <h2>Bringing in your old files</h2>
      <p>Press <kbd>I</kbd> (Import) and choose a Notebook II database's files together: <code>NAME.DAT</code>, <code>NAME.DEF</code> and <code>NAME.IDX</code> (and <code>NAME.MSC</code> and print formats, <code>*.R00</code>, if you have them). Import also reads text that Notebook II or other programs wrote: delimited text (tab, comma, <code>|</code>, <code>~</code> or any character you name), tagged text (<code>Author: …</code> or <code>%Author:…</code> lines), and DOS characters (code page 437). Any other file can be opened with <em>Salvage</em>, which pulls out the readable text.</p>
    </div>`;
  $$('#main tbody tr').forEach((tr) => tr.addEventListener('click', () => openSaved(+tr.dataset.i)));
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

function deleteSavedDb() {
  const d = listSaved()[state.homeCursor];
  if (!d) return;
  if (confirm(`Delete the database "${d.name}" from this browser? Export it first if you want a copy.`)) { removeDb(d.key); render(); }
}

const PAGE = 200;

function renderBrowse() {
  const db = state.db;
  let cols = db.fields.filter((f) => shownInList(db, f)).map((f) => f.name);
  if (!cols.length) cols = [db.fields[0].name];
  const start = Math.floor(state.cursor / PAGE) * PAGE;
  const slice = state.list.slice(start, start + PAGE);
  const rows = slice.map((r, k) => {
    const i = start + k;
    return `<tr data-i="${i}" class="${i === state.cursor ? 'cur' : ''}"><td class="num">${i + 1}</td>${cols.map((c) => `<td>${esc(preview(r.values[c]))}</td>`).join('')}</tr>`;
  }).join('');
  const more = state.list.length > PAGE ? `<p class="hint">Showing ${start + 1}–${start + slice.length} of ${state.list.length}. PgUp/PgDn moves a page.</p>` : '';
  const sortMark = (c) => {
    const k = state.sortKeys[0];
    return k?.field === c ? (k.descending ? ' ▼' : ' ▲') : '';
  };
  $('#main').innerHTML = state.list.length
    ? `<table class="grid browse"><thead><tr><th class="num">#</th>${cols.map((c) => `<th><button type="button" class="sorthead" data-sort="${esc(c)}" title="Sort by ${esc(c)}">${esc(c)}${sortMark(c)}</button></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${more}`
    : `<div class="panel"><p>${db.records.length ? 'No records match. Clear the search box (Esc in it) to show all records.' : 'This database is empty. Press <kbd>N</kbd> for a new note or <kbd>I</kbd> to import some.'}</p></div>`;
  $$('#main tbody tr').forEach((tr) => tr.addEventListener('click', () => { state.cursor = +tr.dataset.i; openRecord(); }));
  $$('#main [data-sort]').forEach((b) => b.addEventListener('click', () => sortByColumn(b.dataset.sort)));
  $('#main tr.cur')?.scrollIntoView({ block: 'nearest' });
}

// A column heading sorts by that field; clicking again reverses, then a third
// click goes back to the order the records were entered.
function sortByColumn(field) {
  const k = state.sortKeys[0];
  if (k?.field !== field) setSort([{ field, descending: false }]);
  else if (!k.descending) setSort([{ field, descending: true }]);
  else setSort([]);
  const id = current()?.id;
  refreshList();
  state.cursor = Math.max(0, state.list.findIndex((r) => r.id === id));
  render();
}

function highlight(text, terms) {
  const safe = esc(text);
  if (!terms.length) return safe;
  const alts = terms.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return safe.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${alts})`, 'giu'), '$1<mark>$2</mark>');
}

// ---------- the record screen: read and edit in one place ----------

function openRecord(rec = current(), { isNew = false, focus = false } = {}) {
  if (!rec) return;
  state.viewId = rec.id;
  state.viewSnapshot = { ...rec.values };
  state.viewIsNew = isNew;
  if (!isNew) state.copySource = previousInList(rec);
  go('view');
  if (focus) focusField(isNew ? 0 : state.editField);
}

function previousInList(rec) {
  const order = state.list?.some((r) => r.id === rec.id) ? state.list : state.db.records;
  const i = order.findIndex((r) => r.id === rec.id);
  return i > 0 ? order[i - 1] : null;
}

function newRecord() {
  // "Previous" for a new note is the record you were on.
  const from = state.mode === 'view' ? viewed() : current() ?? state.db.records[state.db.records.length - 1] ?? null;
  leaveRecord();
  const rec = addRecord(state.db, {});
  state.copySource = from;
  openRecord(rec, { isNew: true, focus: true });
  say(from ? `New note. ${keyLabel('Ctrl+d')} fills in ${copyList()} from the previous one.` : 'New note.');
}

function editRecord() {
  if (state.mode === 'browse') openRecord(current(), { focus: true });
  else focusField(state.editField);
}

function focusField(i) {
  const areas = $$('#recordform textarea');
  (areas[i] ?? areas[0])?.focus();
}

function recordChanged() {
  const rec = viewed();
  return !!(rec && state.viewSnapshot && state.db.fields.some(({ name }) => (rec.values[name] ?? '') !== (state.viewSnapshot[name] ?? '')));
}

// Leaving the record screen: a new note left blank is dropped, and the list is
// brought up to date (the record may no longer match the search).
function leaveRecord() {
  const rec = viewed();
  state.viewId = null;
  if (!rec) return;
  for (const { name } of state.db.fields) rec.values[name] = (rec.values[name] ?? '').replace(/\s+$/, '');
  if (state.viewIsNew && !Object.values(rec.values).some((v) => v.trim())) deleteRecords(state.db, [rec.id]);
  persist();
  refreshList();
  const i = state.list.findIndex((r) => r.id === rec.id);
  if (i >= 0) state.cursor = i;
}

function moveRecord(delta) {
  const rec = viewed();
  leaveRecord();
  const list = state.list;
  let i = list.findIndex((r) => r.id === rec?.id);
  if (i < 0) i = state.cursor - (delta > 0 ? 1 : 0);
  const j = Math.max(0, Math.min(list.length - 1, i + delta));
  if (!list[j]) return go('browse');
  state.cursor = j;
  openRecord(list[j]);
}

function renderView() {
  const rec = viewed();
  if (!rec) { go('browse'); return; }
  const terms = highlightTerms(state.query);
  $('#main').innerHTML = `
    <form class="record" id="recordform" autocomplete="off">
      ${state.db.fields.map(({ name }, i) => `
        <label class="field"><span class="fname">${esc(name)}</span>
          <span class="fwrap"><textarea name="f${i}" rows="1" spellcheck="true" placeholder="(blank)" style="min-height: calc(${fieldLines(state.db.fields[i])} * 1.4em + 2px)">${esc(rec.values[name] ?? '')}</textarea>${terms.length && (rec.values[name] ?? '').trim() ? `<span class="fmark" aria-hidden="true">${highlight(rec.values[name], terms)}</span>` : ''}</span></label>`).join('')}
      <p class="hint">Fields can be any length, and changes are saved as you type. <kbd>F5</kbd> copies ${esc(copyList())} from ${state.copySource ? 'the previous record' : 'the previous record (there is none here)'} into blank fields; <kbd>F6</kbd> copies just the field you are in. <kbd>Tab</kbd> moves between fields, <kbd>Esc</kbd> leaves a field and then goes back to the list.</p>
      <p class="meta">${recordMeta(rec)}</p>
    </form>`;
  $$('#recordform textarea').forEach((t, i) => {
    growField(t);
    t.addEventListener('input', () => {
      growField(t);
      t.parentElement.querySelector('.fmark')?.remove();
      const name = state.db.fields[i].name;
      const wasChanged = recordChanged();
      rec.values[name] = t.value;
      touchRecord(state.db, rec);
      persistSoon();
      if (wasChanged !== recordChanged()) renderKeys();
    });
    t.addEventListener('focus', () => { state.editField = i; });
  });
  $('#recordform').addEventListener('submit', (e) => e.preventDefault());
}

function recordMeta(rec) {
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null);
  const bits = [`Record ${rec.id}`];
  if (rec.created) bits.push(`created ${when(rec.created)}`);
  if (rec.modified && when(rec.modified) !== when(rec.created)) bits.push(`changed ${when(rec.modified)}`);
  return esc(bits.join(' · '));
}

// Changes are saved as you type; F10 or Ctrl+S saves at once and says so.
function saveRecord() {
  clearTimeout(persistTimer);
  persist();
  say('Saved.');
}

// Ctrl+Home and Ctrl+End: the start of the first field, the end of the last.
function recordEdge(end) {
  const areas = $$('#recordform textarea');
  const t = end ? areas[areas.length - 1] : areas[0];
  if (!t) return;
  t.focus();
  const at = end ? t.value.length : 0;
  t.setSelectionRange(at, at);
  t.scrollIntoView({ block: end ? 'end' : 'start' });
  if (!end) $('#main').scrollTop = 0;
}

// Fields grow to fit their text, and fit again when the window changes width.
function growField(t) {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + 2}px`;
}
window.addEventListener('resize', () => $$('#recordform textarea').forEach(growField));

function revertRecord() {
  const rec = viewed();
  if (!rec || !recordChanged()) return;
  Object.assign(rec.values, state.viewSnapshot);
  persist();
  render();
  say('Changes to this record undone.');
}

function copyList() {
  const names = state.db.fields.filter(copiesFromPrevious).map((f) => f.name);
  if (!names.length) return 'no fields (choose them in Fields)';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function copyFromPrevious(onlyCurrentField) {
  const from = state.copySource;
  if (!from) return say('There is no previous record to copy from.', true);
  const areas = $$('#recordform textarea');
  const values = {};
  state.db.fields.forEach(({ name }, i) => { values[name] = areas[i].value; });
  const field = state.db.fields[state.editField];
  const copied = carryOver(state.db, from, values, onlyCurrentField ? field?.name : null);
  state.db.fields.forEach(({ name }, i) => {
    if (!copied.includes(name)) return;
    areas[i].value = values[name];
    areas[i].dispatchEvent(new Event('input'));
  });
  const firstBlank = areas.findIndex((a) => !a.value.trim());
  areas[onlyCurrentField || firstBlank < 0 ? state.editField : firstBlank]?.focus();
  if (copied.length) return say(`Copied ${copied.join(', ')} from the previous record.`);
  if (onlyCurrentField) return say(`The previous record's ${field?.name ?? 'field'} is blank or the same.`);
  say('Nothing to copy: those fields are already filled in or blank in the previous record.');
}

// ---------- search box ----------

function focusSearch() {
  if (state.mode !== 'browse' && state.mode !== 'view') go('browse');
  const s = $('#search');
  s.focus();
  s.select();
}

function clearSearch() {
  $('#search').value = '';
  applySearch('');
}

// Runs as you type. A search that is not finished yet ("author:" with an
// unknown field, an open bracket) keeps the last good result on screen.
function applySearch(q) {
  q = q.trim();
  try {
    compileQuery(q, fieldNames(state.db));
  } catch (e) {
    say(e.message, true);
    return false;
  }
  if (q === state.query) return true;
  if (state.mode === 'view') go('browse');
  state.query = q;
  state.cursor = 0;
  refreshList();
  state.message = q ? (state.list.length ? `Found ${state.list.length} record${state.list.length === 1 ? '' : 's'}.` : 'No records found.') : '';
  state.messageIsError = !!q && !state.list.length;
  render();
  return true;
}

let searchTimer = null;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applySearch(e.target.value), 150);
});
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (e.target.value) clearSearch();
    else e.target.blur();
  } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(searchTimer);
    if (applySearch(e.target.value)) {
      e.target.blur();
      if (state.mode !== 'browse') go('browse');
      if (e.key === 'Enter' && state.list.length === 1) openRecord();
    }
  }
});


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
    setSort([0, 1, 2].map((i) => ({ field: f.get(`f${i}`), descending: !!f.get(`d${i}`) })).filter((k) => k.field));
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
      <div class="scrollx"><table class="grid fields"><thead><tr><th class="num">#</th><th>Name</th><th>Copy with F5</th><th>Lines</th><th>In list</th><th></th></tr></thead><tbody>${db.fields.map((field, i) => { const { name } = field; return `
        <tr><td class="num">${i + 1}</td>
          <td><input data-rename="${esc(name)}" value="${esc(name)}" aria-label="Field name"></td>
          <td><input type="checkbox" data-copy="${esc(name)}" ${copiesFromPrevious(field) ? 'checked' : ''} aria-label="Copy ${esc(name)} with F5"></td>
          <td><input type="number" min="1" max="40" data-lines="${esc(name)}" value="${fieldLines(field)}" aria-label="Lines shown for ${esc(name)}"></td>
          <td><input type="checkbox" data-list="${esc(name)}" ${shownInList(db, field) ? 'checked' : ''} aria-label="Show ${esc(name)} in the list"></td>
          <td class="buttons">
            <button type="button" data-move="${esc(name)}" data-d="-1" ${i ? '' : 'disabled'} title="Move up">↑</button>
            <button type="button" data-move="${esc(name)}" data-d="1" ${i < db.fields.length - 1 ? '' : 'disabled'} title="Move down">↓</button>
            <button type="button" data-del="${esc(name)}">Delete</button></td></tr>`; }).join('')}
      </tbody></table></div>
      <form id="addfield" class="row"><input name="name" placeholder="New field name" aria-label="New field name"><button type="submit">Add field</button></form>
      <h2>Notebook name</h2>
      <div class="row"><input id="dbname" value="${esc(db.name)}" aria-label="Notebook name"></div>
      <p class="hint">Every field holds text of any length; dates, numbers and anything else are typed as text (a date written <code>1938-03-17</code> sorts in date order, and <code>1938-03-17 (approx.)</code> still does).</p>
      <p class="hint"><strong>Copy with F5</strong>: on a record, <kbd>F5</kbd> copies these fields from the previous record into the ones still blank, so a new note from the same source needs only the note. <strong>Lines</strong>: how much room the field gets when a record opens; it grows as you type either way. <strong>In list</strong>: shown as a column in the list of records.</p>
      <p class="hint">Renaming a field keeps its contents and updates print forms. Change a name and press Enter. <kbd>Esc</kbd> goes back to the records.</p>
    </div>`;
  const done = (fn) => { try { fn(); persist(); refreshList(); render(); } catch (e) { say(e.message, true); } };
  $$('[data-rename]').forEach((inp) => inp.addEventListener('change', () => done(() => renameField(db, inp.dataset.rename, inp.value))));
  $$('[data-copy]').forEach((c) => c.addEventListener('change', () => done(() => setFieldCopy(db, c.dataset.copy, c.checked))));
  $$('[data-lines]').forEach((c) => c.addEventListener('change', () => done(() => setFieldOption(db, c.dataset.lines, 'lines', c.value))));
  $$('[data-list]').forEach((c) => c.addEventListener('change', () => done(() => setFieldOption(db, c.dataset.list, 'list', c.checked))));
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
        <option value="vertical">Vertical text — one record after another, for reading (.txt)</option>
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
      case 'json':
        if (recs.length === db.records.length) { db.lastBackup = new Date().toISOString(); persist(); }
        return download(`${base}.nb2.json`, toBytes(exportJson(db, recs)), 'application/json');
      case 'vertical': return download(`${base}.txt`, toBytes(exportVertical(f, recs), enc), 'text/plain');
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
  $$('#main [data-key-label]').forEach((el) => { el.textContent = keyLabel(el.dataset.keyLabel); });
}

// ---------- commands that need more than one line ----------

// A new notebook starts from one of a few layouts, then opens on Fields so the
// fields can be named and set up before the first record.
function renderNewDb() {
  $('#main').innerHTML = `
    <form class="panel" id="newdbform">
      <h2>New notebook</h2>
      <div class="row"><label for="nbname">Name</label><input id="nbname" name="name" value="Notes" required></div>
      <h2>Start with</h2>
      ${LAYOUTS.map((l, i) => `
        <label class="check layout"><input type="radio" name="layout" value="${l.id}" ${i ? '' : 'checked'}>
          <span><strong>${esc(l.name)}</strong><br><span class="hint">${l.fields.map((f) => esc(f.name)).join(' · ')}</span></span></label>`).join('')}
      <p class="hint">Every field holds text of any length. You can rename, add, remove and reorder fields on the next screen, and at any time later.</p>
      <div class="buttons"><button type="submit">Make notebook</button></div>
    </form>`;
  const form = $('#newdbform');
  form.name.focus();
  form.name.select();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const layout = LAYOUTS.find((l) => l.id === form.layout.value) ?? LAYOUTS[0];
    const name = form.name.value.trim() || 'Notes';
    openDb(createDatabase(name, layout.fields));
    go('fields');
    say(`Notebook "${name}" made. Set up its fields here, then press Esc to start adding notes.`);
  });
}

function deleteCurrent() {
  const rec = state.mode === 'view' ? viewed() : current();
  if (!rec) return;
  const label = preview(rec.values[state.db.fields[0].name], 50) || 'this record';
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
  if (state.mode === 'view') state.viewId = null;
  deleteRecords(state.db, [rec.id]);
  persist();
  refreshList();
  go('browse');
  say('Record deleted.');
}

function moveCursor(delta) {
  if (!state.list.length) return;
  state.cursor = Math.max(0, Math.min(state.list.length - 1, state.cursor + delta));
  render();
}

function cycleTheme() {
  const t = nextTheme(getTheme());
  setTheme(t);
  renderTitle();
  say({ auto: 'Screen follows your computer\'s light or dark setting.', light: 'Light screen.', dark: 'Dark screen.' }[t]);
}

// ---------- command palette ----------
//
// Ctrl+K (⌘K on a Mac): type part of a command's name, or a field's name to
// sort by it or search in it.

const palette = { open: false, items: [], sel: 0 };

function paletteItems() {
  const items = COMMANDS.filter((c) => c.id !== 'palette' && c.id !== 'open' && available(c) && !(c.id === 'revert' && !recordChanged()))
    .map((c) => ({ label: c.label, hint: keyLabel(c.key) || c.fkey || '', run: c.run }));
  if (state.db && ['browse', 'view'].includes(state.mode)) {
    for (const { name } of state.db.fields) {
      items.push({ label: `Sort by ${name}`, hint: '', run: () => { if (state.mode === 'view') go('browse'); setSort([]); sortByColumn(name); } });
      items.push({ label: `Find in ${name}…`, hint: '', run: () => { const s = $('#search'); focusSearch(); s.value = `${/\s/.test(name) ? `"${name}"` : name}:`; } });
    }
  }
  return items;
}

function openPalette() {
  palette.open = true;
  palette.sel = 0;
  $('#palette').hidden = false;
  const input = $('#pinput');
  input.value = '';
  renderPalette();
  input.focus();
}

function closePalette() {
  palette.open = false;
  $('#palette').hidden = true;
}

function renderPalette() {
  const words = $('#pinput').value.toLowerCase().split(/\s+/).filter(Boolean);
  // Names that start with what was typed come first, then word starts, then the rest.
  const rank = (label) => {
    const l = label.toLowerCase();
    if (!words.length || l.startsWith(words[0])) return 0;
    return words.every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(l)) ? 1 : 2;
  };
  palette.items = paletteItems()
    .filter((it) => words.every((w) => it.label.toLowerCase().includes(w)))
    .map((it, i) => ({ it, i, r: rank(it.label) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.it);
  palette.sel = Math.min(palette.sel, Math.max(0, palette.items.length - 1));
  $('#plist').innerHTML = palette.items.length
    ? palette.items.map((it, i) => `<li role="option" data-i="${i}" class="${i === palette.sel ? 'cur' : ''}" aria-selected="${i === palette.sel}"><span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</li>`).join('')
    : '<li class="none">No command matches.</li>';
  $('#plist li.cur')?.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(i) {
  const it = palette.items[i];
  closePalette();
  it?.run();
}

$('#pinput').addEventListener('input', () => { palette.sel = 0; renderPalette(); });
$('#pinput').addEventListener('keydown', (e) => {
  const n = palette.items.length;
  if (e.key === 'ArrowDown') palette.sel = (palette.sel + 1) % Math.max(n, 1);
  else if (e.key === 'ArrowUp') palette.sel = (palette.sel - 1 + n) % Math.max(n, 1);
  else if (e.key === 'Enter') { e.preventDefault(); return runPaletteItem(palette.sel); }
  else if (e.key === 'Escape') { e.preventDefault(); return closePalette(); }
  else return;
  e.preventDefault();
  renderPalette();
});
$('#plist').addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) runPaletteItem(+li.dataset.i); });
$('#palette').addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });

// ---------- keys ----------

function keyName(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.altKey && !ctrl && /^Key[A-Z]$/.test(e.code)) return `Alt+${e.code.slice(3).toLowerCase()}`;
  if (e.altKey && !ctrl && (e.key === 'PageUp' || e.key === 'PageDown')) return `Alt+${e.key}`;
  if (ctrl) return `Ctrl+${e.shiftKey ? 'Shift+' : ''}${e.key.toLowerCase()}`;
  if (e.altKey) return null;
  return e.key;
}

function onKey(key, e) {
  const m = state.mode;
  const target = e?.target;
  const inRecordField = target?.closest?.('#recordform');
  const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

  if (key === 'Ctrl+s') return saveRecord();
  if (m === 'view' && (key === 'Alt+PageUp' || key === 'Alt+PageDown')) return moveRecord(key === 'Alt+PageUp' ? -1 : 1);
  if (m === 'view' && (key === 'Ctrl+home' || key === 'Ctrl+end')) return recordEdge(key === 'Ctrl+end');

  // Old F-keys: the command that had it on this screen.
  if (/^F\d+$/.test(key)) {
    const c = COMMANDS.find((x) => x.fkey === key && available(x));
    if (c) return c.run();
    return key === 'F1' ? go('help') : false;
  }

  const modified = key.includes('+');
  if (typing && !modified) {
    if (inRecordField) {
      if (key === 'Escape') { target.blur(); say('Esc again goes back to the list.'); return; }
      return false;
    }
    if (key === 'Escape') return runCommand('dback');
    return false;
  }

  if (m === 'home' && !typing) {
    const saved = listSaved();
    if (key === 'ArrowDown') { state.homeCursor = Math.min(saved.length - 1, state.homeCursor + 1); render(); return; }
    if (key === 'ArrowUp') { state.homeCursor = Math.max(0, state.homeCursor - 1); render(); return; }
    if (key === 'o' || key === 'O') return runCommand('import');
  }
  if (m === 'browse' && !typing) {
    const nav = { ArrowDown: 1, ArrowUp: -1, PageDown: 15, PageUp: -15 };
    if (key in nav) return moveCursor(nav[key]);
    if (key === 'Home') return moveCursor(-Infinity);
    if (key === 'End') return moveCursor(Infinity);
    if (key === 'Enter') return openRecord();
    if (key === 'f' || key === 'F') return focusSearch();
  }
  if (m === 'view' && !typing) {
    if (key === 'ArrowRight') return moveRecord(1);
    if (key === 'ArrowLeft') return moveRecord(-1);
    if (key === 'Enter') return editRecord();
    if (key === 'f' || key === 'F') return focusSearch();
  }

  const k = key.length === 1 ? key.toLowerCase() : key;
  const c = COMMANDS.find((x) => x.key && (x.key.length === 1 ? x.key.toLowerCase() : x.key) === k && available(x));
  if (c) return c.run();
  return false;
}

document.addEventListener('keydown', (e) => {
  if (palette.open) return;
  const key = keyName(e);
  if (!key) return;
  // Leave browser and text-editing shortcuts alone (copy, paste, undo …).
  if (key.startsWith('Ctrl+') && !['Ctrl+s', 'Ctrl+Shift+s', 'Ctrl+k', 'Ctrl+d', 'Ctrl+Shift+d', 'Ctrl+home', 'Ctrl+end'].includes(key)) return;
  if ((key === 'Ctrl+home' || key === 'Ctrl+end') && state.mode !== 'view') return;
  if (onKey(key, e) !== false) e.preventDefault();
});

$('#keys').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) runCommand(b.dataset.cmd);
});

$('#themebtn').addEventListener('click', cycleTheme);

render();
