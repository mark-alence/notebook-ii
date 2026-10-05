// The full-screen interface, in the style of the DOS original: a title bar, the
// screen, a status line and a command bar. Every command has a name, a letter
// key and a place in the command palette (Ctrl+K); the original F-keys still
// work too.
import {
  createDatabase, addRecord, updateRecord, deleteRecords, addField, renameField, deleteField,
  moveField, orderRecords, previousEntered, withRecordNumbers, recordNumbersIn, carryOver, copiesFromPrevious, setFieldCopy, setFieldOption, fieldLines, shownInList, touchRecord, LAYOUTS, databaseFromImport, appendImport, validateDatabase, fieldNames, defaultPrintForm, setMarked, markedRecords,
} from './model.js';
import { compileQuery, highlightPatterns, findInTexts, parseIdRanges, inIdRanges } from './search.js';
import { FONTS, SPACING, SIZE, getAppearance, setAppearance, resetAppearance } from './appearance.js';
import { importFiles } from './importers.js';
import { exportDelimited, exportTagged, exportNotebookText, exportVertical, verticalBlocks, exportJson, toBytes } from './exporters.js';
import { renderReport, renderBlocks } from './printform.js';
import { PAPERS, FONT_SIZES, makePdf, previewPdf } from './pdf.js';
import { listSaved, saveDb, loadDb, removeDb, newKey, listRecent, addRecent, removeRecent } from './storage.js';
import * as platform from './platform.js';
import { SAMPLE } from './sample.js';
import { THEMES, getTheme, setTheme, nextTheme } from './theme.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const CTRL = MAC ? '⌘' : 'Ctrl ';

const state = {
  db: null,
  key: null, // where the notebook is kept in browser storage, or null
  path: null, // desktop app: the notebook's file, or null
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
  exp: null, // the Export screen's choices, kept while the notebook is open
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
  state.list = orderRecords(recs, state.sortKeys, state.db.order);
  recs = state.list;
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
  if (!state.db) return;
  if (state.path) return writeFile();
  if (!state.key) return;
  if (!askedToKeep) { askedToKeep = true; navigator.storage?.persist?.().catch(() => {}); }
  if (!saveDb(state.key, state.db)) {
    say('Could not save in this browser (storage may be full). Use Export > Notebook file to keep a copy.', true);
  }
}

// Desktop app: the notebook is a file, rewritten as it changes. Writes run one
// after another, so a slow disk never gets them out of order.
let writing = Promise.resolve();
function writeFile() {
  const { db, path } = state;
  const text = exportJson(db);
  writing = writing
    .then(() => platform.writeText(path, text))
    .then(() => addRecent({ path, name: db.name, records: db.records.length, modified: db.modified }))
    .catch((e) => say(String(e), true));
  return writing;
}

async function flushAll() {
  flush();
  await writing;
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

// key: the notebook's place in browser storage (a new one by default); path:
// its file, in the desktop app, when it was opened from or saved to one.
function openDb(db, key = newKey(), path = null) {
  state.db = db;
  state.key = path ? null : key;
  state.path = path;
  state.query = '';
  state.sortKeys = (db.sortKeys ?? []).filter((k) => db.fields.some((f) => f.name === k.field));
  state.cursor = 0;
  state.formIndex = 0;
  state.exp = null;
  $('#search').value = '';
  refreshList();
  if (path) addRecent({ path, name: db.name, records: db.records.length, modified: db.modified });
  else persist();
  platform.setTitle(`${db.name} · Notebook II`);
  go('browse');
  if (!path && platform.desktop) say(`This notebook is kept inside the app. Save As (${keyLabel('Ctrl+Shift+s')}) makes it a file you can back up and move.`);
  else if (!path && needsBackup(db)) say(`This notebook has not been backed up for a while. Backup (${keyLabel('Ctrl+Shift+s')}) saves a copy as a file.`);
}

// Without a sort field the list is in the order records were made, newest
// first unless the notebook is set to oldest first.
function setOrder(order) {
  if (state.mode === 'view') go('browse');
  const id = current()?.id;
  state.db.order = order;
  persist();
  refreshList();
  state.cursor = Math.max(0, state.list.findIndex((r) => r.id === id));
  render();
  say(order === 'oldest' ? 'Oldest records first.' : 'Newest records first.');
}

// The notebook remembers its sort; no sort fields means date-entered order.
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
async function backupDb() {
  const db = state.db;
  if (state.mode === 'view') leaveRecord();
  const stamp = new Date().toISOString();
  const saved = await download(`${safeName(db.name)}-${stamp.slice(0, 10)}${platform.desktop ? '.nb2' : '.nb2.json'}`, toBytes(exportJson(db)), 'application/json');
  if (!saved) return;
  db.lastBackup = stamp;
  persist();
  if (state.mode === 'view') render();
  say(platform.desktop ? `Copy saved as ${platform.fileName(saved)}.` : 'Backup saved to your downloads. Import reads it back.');
}

async function closeDb() {
  leaveRecord();
  persist();
  await flushAll();
  state.db = null; state.key = null; state.path = null; state.list = null; state.query = '';
  platform.setTitle('Notebook II');
  go('home');
}

// ---------- desktop app: notebooks as files ----------

async function openFile(path = null) {
  try {
    path ??= await platform.pickNotebookToOpen();
    if (!path) return;
    let db;
    try {
      db = validateDatabase(JSON.parse(await platform.readText(path)));
    } catch (e) {
      if (/read/i.test(String(e))) throw e;
      throw new Error(`${platform.fileName(path)} is not a Notebook file. To bring in other files, including Notebook II's own .DAT files, use Import.`);
    }
    if (state.db) await closeDb();
    openDb(db, null, path);
  } catch (e) {
    removeRecent(path);
    say(String(e.message ?? e), true);
    if (state.mode === 'home') render();
  }
}

// Saves the open notebook to a new file and keeps working on that file. A
// notebook that was kept inside the app moves out to the file.
async function saveAs() {
  const db = state.db;
  if (state.mode === 'view') leaveRecord();
  const path = await platform.pickNotebookPath(safeName(db.name));
  if (!path) return;
  const oldKey = state.key;
  state.path = path;
  state.key = null;
  await writeFile();
  if (oldKey) removeDb(oldKey);
  platform.setTitle(`${db.name} · Notebook II`);
  if (state.mode === 'view') render();
  say(`Saved as ${platform.fileName(path)}. Changes now go straight to that file.`);
}

function say(msg, isError = false) {
  state.message = msg;
  state.messageIsError = isError;
  renderStatus();
}

// A download in the browser, a Save dialog in the desktop app.
async function download(name, bytes, type = 'application/octet-stream') {
  try {
    return await platform.saveBytes(name, bytes, type);
  } catch (e) {
    say(String(e.message ?? e), true);
    return null;
  }
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
  if (state.mode === 'view' && mode !== 'view') { endRecordFind(); leaveRecord(); }
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
  { id: 'openfile', label: 'Open notebook file…', key: 'o', where: ['home', 'browse'], bar: true, desktop: true, run: () => openFile() },
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
  { id: 'find', label: 'Find (records in the list, or text in the record on screen)', key: '/', fkey: 'F4', where: ['browse', 'view'], bar: true, run: () => focusSearch() },
  { id: 'all', label: 'Show all records', fkey: 'F5', where: ['browse'], run: () => clearSearch() },
  { id: 'newest', label: 'Newest first (date entered)', where: ['browse', 'view'], run: () => { setSort([]); setOrder('newest'); } },
  { id: 'oldest', label: 'Oldest first (date entered)', where: ['browse', 'view'], run: () => { setSort([]); setOrder('oldest'); } },
  { id: 'sort', label: 'Sort…', key: 's', fkey: 'F6', where: ['browse'], bar: true, run: () => go('sort') },
  { id: 'print', label: 'Export with a custom form, as text or PDF…', key: 'p', fkey: 'F7', where: ['browse', 'view'], run: () => exportWith('form') },
  { id: 'fields', label: 'Fields', fkey: 'F8', where: ['browse', 'view'], bar: true, run: () => go('fields') },
  { id: 'import', label: 'Import', key: 'i', fkey: 'F9', where: ['home', 'browse', 'view'], bar: true, run: () => pickFiles(startImport) },
  { id: 'export', label: 'Export', key: 'x', fkey: 'F10', where: ['browse', 'view'], bar: true, run: () => go('export') },
  { id: 'saveas', label: 'Save notebook as…', key: 'Ctrl+Shift+s', where: ['browse', 'view'], bar: true, desktop: true, run: () => saveAs() },
  { id: 'backup', label: platform.desktop ? 'Save a copy…' : 'Backup: save a copy as a file', key: platform.desktop ? null : 'Ctrl+Shift+s', where: ['browse', 'view'], bar: !platform.desktop, run: () => backupDb() },
  { id: 'mark', label: 'Mark or unmark this record', key: 'm', where: ['browse', 'view'], run: () => toggleMark() },
  { id: 'showmarked', label: 'Show marked records', where: ['browse', 'view'], run: () => showMarked() },
  { id: 'markall', label: 'Mark all records in the list', where: ['browse', 'view'], run: () => markList(true) },
  { id: 'unmarkall', label: 'Unmark all records in the list', where: ['browse', 'view'], run: () => markList(false) },
  { id: 'clearmarks', label: 'Clear all marks in the notebook', where: ['browse', 'view'], run: () => clearMarks() },
  { id: 'delmarked', label: 'Delete marked records…', where: ['browse', 'view'], run: () => deleteMarked() },
  { id: 'delete', label: 'Delete record', key: 'Delete', where: ['browse', 'view'], bar: true, run: () => deleteCurrent() },
  { id: 'close', label: 'Close database', key: 'Escape', where: ['browse'], bar: true, run: () => closeDb() },
  { id: 'dback', label: 'Back', key: 'Escape', where: ['sort', 'fields', 'import', 'export', 'help', 'newdb', 'appearance'], bar: true, run: () => (state.db ? go('browse') : go('home')) },
  { id: 'help', label: 'Help', key: '?', fkey: 'F1', where: ['home', 'browse', 'view', 'sort', 'fields', 'import', 'export', 'appearance'], bar: true, run: () => go('help') },
  { id: 'theme', label: 'Light or dark screen', key: 'Alt+t', where: ['*'], run: () => cycleTheme() },
  { id: 'appearance', label: 'Appearance: font, size, spacing, light or dark…', where: ['*'], run: () => go('appearance') },
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
  if (c.desktop && !platform.desktop) return false;
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
  const views = { home: renderHome, appearance: renderAppearance, newdb: renderNewDb, browse: renderBrowse, view: renderView, sort: renderSort, fields: renderFields, import: renderImport, export: renderExport, help: renderHelp };
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
    const marked = markedRecords(db).length;
    if (marked) right += ` · ${marked} marked`;
  }
  $('#title .dbname').textContent = db?.name ?? '';
  $('#title .count').textContent = right;
  // One box, two jobs: in the list it finds records, on a record it finds
  // text in that record. Each keeps its own words.
  const search = $('#search');
  search.hidden = !db;
  const job = state.mode === 'view' ? 'record' : 'list';
  if (search.dataset.job !== job) {
    search.dataset.job = job;
    search.value = job === 'record' ? rf.query : state.query;
    search.placeholder = job === 'record'
      ? 'Find in this record (/)   text or /pattern/   Enter next, Shift+Enter back'
      : 'Find records (/)   e.g. smith  author:smith  year>1980';
    search.setAttribute('aria-label', job === 'record' ? 'Find in this record' : 'Find records');
  }
  $('#themebtn').textContent = { auto: 'Auto', light: 'Light', dark: 'Dark' }[getTheme()];
}

function renderKeys() {
  const shown = COMMANDS.filter((c) => c.bar && available(c) && !(c.id === 'revert' && !recordChanged()));
  $('#keys').innerHTML = shown.map((c) => {
    const k = keyLabel(c.barKey ?? c.key);
    return `<button type="button" data-cmd="${c.id}" title="${esc(c.label)}${k ? ` (${esc(k)})` : ''}"><span>${esc(barLabel(c))}</span>${k ? `<kbd>${esc(k)}</kbd>` : ''}</button>`;
  }).join('');
}

const SHORT = { print: 'Form/PDF', openfile: 'Open', saveas: 'Save as', newdb: 'New', sample: 'Sample', deldb: 'Delete', back: 'List', prev: 'Prev', next: 'Next', copyprev: 'Copy previous', copyfield: 'Copy field', revert: 'Revert', delete: 'Delete', close: 'Close', dback: 'Back', new: 'New note', sort: 'Sort', backup: 'Backup' };
function barLabel(c) {
  if (c.id === 'find') return state.mode === 'view' ? 'Find in record' : 'Find';
  return SHORT[c.id] ?? c.label;
}

function renderStatus() {
  const bits = [];
  if (state.query) bits.push(`Find: ${state.query}`);
  if (state.sortKeys.length) bits.push(`Sorted by ${state.sortKeys.map((k) => k.field + (k.descending ? ' (Z-A)' : '')).join(', ')}`);
  else if (state.db && ['browse', 'view'].includes(state.mode)) bits.push(state.db.order === 'oldest' ? 'Oldest first' : 'Newest first');
  const el = $('#status');
  el.textContent = state.message || bits.join('   ·   ') || ' ';
  el.classList.toggle('error', !!state.message && state.messageIsError);
}

function preview(text, max = 120) {
  const one = (text ?? '').replace(/\s*\n\s*/g, ' ¶ ');
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

// The start screen lists notebooks: in the desktop app, recent notebook files
// first, then any kept inside the app; on the web, those kept in this browser.
function homeEntries() {
  const files = platform.desktop ? listRecent().map((r) => ({ ...r, kind: 'file' })) : [];
  return [...files, ...listSaved().map((d) => ({ ...d, kind: 'app' }))];
}

// The folder and file name; the full path shows on hover.
function shortPath(path) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path;
}

function renderHome() {
  const entries = homeEntries();
  state.homeCursor = Math.min(state.homeCursor, Math.max(0, entries.length - 1));
  const rows = entries.map((d, i) => `
    <tr data-i="${i}" class="${i === state.homeCursor ? 'cur' : ''}">
      <td>${esc(d.name)}</td>${platform.desktop ? `<td class="where" title="${esc(d.kind === 'file' ? d.path : '')}">${esc(d.kind === 'file' ? shortPath(d.path) : 'kept in the app')}</td>` : ''}<td class="num">${d.records ?? ''}</td><td>${d.modified ? esc(new Date(d.modified).toLocaleString()) : ''}</td>
    </tr>`).join('');
  const keep = platform.desktop
    ? `<p class="hint">Each notebook is a file on your computer (<code>.nb2</code>), saved as you type. Back it up like any other document, or keep it in a synced folder. <kbd>O</kbd> opens one.</p>`
    : `<p class="warn">Notebooks are kept in this browser only. Clearing the browser's history or site data deletes them, and they are not on your other devices. Inside a notebook, <em>Backup</em> (<kbd>${esc(keyLabel('Ctrl+Shift+s'))}</kbd>) saves a copy as a file; Import reads it back.</p>`;
  $('#main').innerHTML = `
    <div class="panel home">
      <h2>${platform.desktop ? 'Recent notebooks' : 'Notebooks'}</h2>
      ${entries.length ? `<div class="scrollx"><table class="grid"><thead><tr><th>Name</th>${platform.desktop ? '<th>File</th>' : ''}<th class="num">Records</th><th>Changed</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="hint">Click a notebook to open it, or use ↑ ↓ and Enter.</p>`
      : `<p>No notebooks yet. Press <kbd>N</kbd> to make one, ${platform.desktop ? '<kbd>O</kbd> to open a notebook file, ' : ''}<kbd>I</kbd> to import a file from Notebook II or another program, or <kbd>S</kbd> to try a sample.</p>`}
      <p class="hint">Every command is on the bar at the bottom, and <kbd>${esc(keyLabel('Ctrl+k'))}</kbd> lists them all.</p>
      ${keep}
      <h2>Bringing in your old files</h2>
      <p>Press <kbd>I</kbd> (Import) and choose a Notebook II database's files together: <code>NAME.DAT</code>, <code>NAME.DEF</code> and <code>NAME.IDX</code> (and <code>NAME.MSC</code> and print formats, <code>*.R00</code>, if you have them). Import also reads text that Notebook II or other programs wrote: delimited text (tab, comma, <code>|</code>, <code>~</code> or any character you name), tagged text (<code>Author: …</code> or <code>%Author:…</code> lines), and DOS characters (code page 437). Any other file can be opened with <em>Salvage</em>, which pulls out the readable text.</p>
    </div>`;
  $$('#main tbody tr').forEach((tr) => tr.addEventListener('click', () => openSaved(+tr.dataset.i)));
}

function openSaved(i) {
  const d = homeEntries()[i];
  if (!d) return;
  if (d.kind === 'file') return openFile(d.path);
  try {
    openDb(loadDb(d.key), d.key);
  } catch (e) {
    say(e.message, true);
  }
}

function deleteSavedDb() {
  const d = homeEntries()[state.homeCursor];
  if (!d) return;
  if (d.kind === 'file') {
    removeRecent(d.path);
    render();
    return say(`Removed ${platform.fileName(d.path)} from this list. The file itself is untouched.`);
  }
  ask(`Delete the notebook "${d.name}" from ${platform.desktop ? 'the app' : 'this browser'}? Make a backup first if you want a copy.`, 'Delete').then((yes) => { if (yes) { removeDb(d.key); render(); } });
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
    return `<tr data-i="${i}" class="${i === state.cursor ? 'cur' : ''}${r.marked ? ' marked' : ''}"><td class="mk" title="${r.marked ? 'Marked: click or press M to unmark' : 'Click or press M to mark'}">${r.marked ? '✓' : ''}</td><td class="num">#${r.id}</td>${cols.map((c) => `<td>${esc(preview(r.values[c]))}</td>`).join('')}</tr>`;
  }).join('');
  const more = state.list.length > PAGE ? `<p class="hint">Showing ${start + 1}–${start + slice.length} of ${state.list.length}. PgUp/PgDn moves a page.</p>` : '';
  const sortMark = (c) => {
    const k = state.sortKeys[0];
    return k?.field === c ? (k.descending ? ' ▼' : ' ▲') : '';
  };
  $('#main').innerHTML = state.list.length
    ? `<table class="grid browse"><thead><tr><th class="mk" title="Marked records (M marks one; @marked finds them)">✓</th><th class="num" style="width: ${String(Math.max(0, db.nextId - 1)).length + 5}ch"><button type="button" class="sorthead" id="ordernum" title="Record numbers, in the order the records were made: click for newest or oldest first">#${state.sortKeys.length ? '' : state.db.order === 'oldest' ? ' ▲' : ' ▼'}</button></th>${cols.map((c) => `<th><button type="button" class="sorthead" data-sort="${esc(c)}" title="Sort by ${esc(c)}">${esc(c)}${sortMark(c)}</button></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${more}`
    : `<div class="panel"><p>${db.records.length ? 'No records match. Clear the search box (Esc in it) to show all records.' : 'This database is empty. Press <kbd>N</kbd> for a new note or <kbd>I</kbd> to import some.'}</p></div>`;
  $$('#main tbody tr').forEach((tr) => tr.addEventListener('click', (e) => {
    state.cursor = +tr.dataset.i;
    if (e.target.closest('.mk')) return toggleMark();
    openRecord();
  }));
  $$('#main [data-sort]').forEach((b) => b.addEventListener('click', () => sortByColumn(b.dataset.sort)));
  // The # heading: date-entered order, newest first, then oldest first.
  $('#ordernum')?.addEventListener('click', () => {
    const order = !state.sortKeys.length && db.order !== 'oldest' ? 'oldest' : 'newest';
    setSort([]);
    setOrder(order);
  });
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

// Marks every stretch of text a pattern matches, on the plain text, then
// escapes the rest.
function highlight(text, pats) {
  if (!pats.length) return esc(text);
  const ranges = [];
  for (const re of pats) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) && ranges.length < 5000) {
      if (!m[0].length) { re.lastIndex++; continue; }
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [a, b] of ranges) {
    if (b <= at) continue;
    const from = Math.max(a, at);
    out += esc(text.slice(at, from)) + `<mark>${esc(text.slice(from, b))}</mark>`;
    at = b;
  }
  return out + esc(text.slice(at));
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

// "Previous" for an existing record: the one before it when the list is sorted
// by a field, otherwise the one made just before it, whichever way the list
// runs.
function previousInList(rec) {
  if (!state.sortKeys.length || !state.list?.some((r) => r.id === rec.id)) return previousEntered(state.db.records, rec);
  const i = state.list.findIndex((r) => r.id === rec.id);
  return i > 0 ? state.list[i - 1] : null;
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
  const terms = highlightPatterns(state.query);
  $('#main').innerHTML = `
    <form class="record" id="recordform" autocomplete="off">
      ${state.db.fields.map(({ name }, i) => `
        <label class="field"><span class="fname">${esc(name)}</span>
          <span class="fwrap"><textarea name="f${i}" rows="1" spellcheck="true" placeholder="(blank)" style="min-height: calc(${fieldLines(state.db.fields[i])} * var(--lh, 1.4) * 1em + 2px)">${esc(rec.values[name] ?? '')}</textarea>${terms.length && (rec.values[name] ?? '').trim() ? `<span class="fmark" aria-hidden="true">${highlight(rec.values[name], terms)}</span>` : ''}</span></label>`).join('')}
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
  if (rf.query.trim()) {
    const r = findInTexts(state.db.fields.map(({ name }) => rec.values[name] ?? ''), rf.query);
    rf.matches = r.matches ?? [];
    rf.cur = 0;
    if (!r.error) paintRecordFind();
  }
}

function recordMeta(rec) {
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null);
  const bits = [`#${rec.id}`];
  if (rec.marked) bits.push('✓ marked');
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
  if (state.mode === 'view') searchTimer = setTimeout(() => updateRecordFind(), 120);
  else searchTimer = setTimeout(() => applySearch(e.target.value), 150);
});
$('#search').addEventListener('keydown', (e) => {
  if (state.mode === 'view') return recordFindKeys(e);
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
          <select name="f${i}">${fieldOptions(k.field, i ? '(nothing)' : '(date entered)')}</select>
          <label class="check"><input type="checkbox" name="d${i}" ${k.descending ? 'checked' : ''}> Z to A</label></div>`).join('')}
      <div class="row"><label>Date entered</label>
        <label class="check"><input type="radio" name="order" value="newest" ${state.db.order !== 'oldest' ? 'checked' : ''}> Newest first</label>
        <label class="check"><input type="radio" name="order" value="oldest" ${state.db.order === 'oldest' ? 'checked' : ''}> Oldest first</label></div>
      <p class="hint">With "(date entered)" the list runs in the order the records were made. Otherwise records are sorted by the fields chosen, and records alike in those fields follow the date-entered order. Numbers sort by value, so 9 comes before 10. Blank fields go last.</p>
      <div class="buttons"><button type="submit">Sort</button></div>
    </form>`;
  $('#sortform').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.db.order = f.get('order') === 'oldest' ? 'oldest' : 'newest';
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
    ask(`Delete the field "${b.dataset.del}"?${n ? ` Its text in ${n} record${n === 1 ? '' : 's'} will be lost.` : ''}`, 'Delete field').then((yes) => { if (yes) done(() => deleteField(db, b.dataset.del)); });
  }));
  $('#addfield').addEventListener('submit', (e) => { e.preventDefault(); done(() => addField(db, e.target.name.value)); });
  $('#dbname').addEventListener('change', (e) => done(() => { db.name = e.target.value.trim() || db.name; }));
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
      ${r ? importNumbersNote(r) : ''}
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

// A Record# column (from Export) holds record numbers.
function importNumbersNote(r) {
  const numbers = recordNumbersIn(r);
  if (!numbers) return '';
  if (!numbers.ids) return `<p class="warn">The ${esc(numbers.field)} column cannot be used as record numbers (${esc(numbers.problem)}), so it comes in as an ordinary field.</p>`;
  const lo = Math.min(...numbers.ids);
  const hi = Math.max(...numbers.ids);
  return `<p class="hint">The ${esc(numbers.field)} column holds record numbers (#${lo}–#${hi}). A new notebook keeps them; records added to an open notebook get new numbers, so they cannot clash.</p>`;
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
  say(`Imported ${db.records.length} records${recordNumbersIn(r)?.ids ? ', keeping their record numbers' : ''}.`);
}

// ---------- export ----------
//
// Every way of getting records out. A custom form (what Notebook II called a
// print format) and vertical text can be saved as a text file or as a PDF.

// Shown as a list, in two groups, so every choice (and PDF) is in view.
const EXPORT_GROUPS = [
  ['For reading, sharing or printing', [
    ['vertical', 'Vertical text', 'each record\'s fields one after another, notes under their label', 'text file or PDF'],
    ['form', 'Custom form', 'your own layout, with a page header and footer', 'text file or PDF'],
  ]],
  ['For other programs', [
    ['csv', 'Spreadsheet', 'comma-separated, for Excel, Numbers, LibreOffice, R', '.csv'],
    ['tab', 'Tab-delimited', 'one record per line, fields separated by tabs', '.txt'],
    ['json', 'Notebook file', 'everything, to open in Notebook II on another computer (Import)', '.nb2.json'],
    ['tagged', 'Tagged text', 'Field: value lines', '.txt'],
    ['notebook', 'Notebook II import text', '%Field:value, for the original DOS program', '.txt'],
    ['custom', 'Delimited, my own characters', 'choose the separators', '.txt'],
  ]],
];
const PAGED = ['vertical', 'form']; // formats that can also be a PDF
const NUMBERED = ['vertical', 'csv', 'tab', 'tagged', 'custom']; // can carry a Record# column

function exportState() {
  state.exp ??= {
    format: 'vertical', output: 'text', encoding: 'utf-8', which: 'list',
    paper: /^en-(US|CA)|^es-(MX|US)/.test(navigator.language) ? 'letter' : 'a4', fontSize: 10,
    fieldDelim: '|', recordDelim: '\\r\\n', newlineMarker: '\\x14', header: true,
    numbers: true, ids: '',
  };
  return state.exp;
}

function exportWith(format) {
  if (state.mode === 'view') go('browse');
  exportState().format = format;
  go('export');
}

function currentForm() {
  const db = state.db;
  if (!db.printForms.length) db.printForms.push(defaultPrintForm(fieldNames(db)));
  state.formIndex = Math.min(state.formIndex, db.printForms.length - 1);
  return db.printForms[state.formIndex];
}

function renderExport() {
  const db = state.db;
  const x = exportState();
  const n = state.list.length;
  const total = db.records.length;
  const isForm = x.format === 'form';
  const pdf = PAGED.includes(x.format) && x.output === 'pdf';
  const form = isForm ? currentForm() : null;
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  // The chosen format's settings and the Save button sit right under its
  // group, so they are in view next to the choice.
  const settings = `
        <div class="exportsettings">
        ${PAGED.includes(x.format) ? `
        <div class="row"><label>Save as</label>
          <label class="check"><input type="radio" name="output" value="text" ${pdf ? '' : 'checked'}> Text file</label>
          <label class="check"><input type="radio" name="output" value="pdf" ${pdf ? 'checked' : ''}> PDF</label></div>` : ''}
        ${pdf ? `
        <div class="row"><label>Paper</label><select name="paper">${Object.entries(PAPERS).map(([v, p]) => opt(v, p.name, x.paper)).join('')}</select>
          <label>Text size</label><select name="fontSize">${FONT_SIZES.map((s) => opt(String(s), `${s} pt`, String(x.fontSize))).join('')}</select></div>` : ''}
        ${x.format === 'custom' ? `
        <div class="row">
          <label>Field delimiter</label><input name="fieldDelim" value="${esc(x.fieldDelim)}" size="6">
          <label>Record delimiter</label><input name="recordDelim" value="${esc(x.recordDelim)}" size="6">
          <label>Line break marker</label><input name="newlineMarker" value="${esc(x.newlineMarker)}" size="6">
          <label class="check"><input type="checkbox" name="header" ${x.header ? 'checked' : ''}> Field names in first row</label>
        </div>` : ''}
        ${x.format !== 'json' && !pdf ? `<div class="row"><label>Characters</label><select name="encoding">${opt('utf-8', 'UTF-8 (modern programs)', x.encoding)}${opt('cp437', 'DOS (code page 437)', x.encoding)}</select></div>` : ''}
        <div class="row"><label>Records</label><select name="which">
          ${opt('list', `${state.query ? `The ${n} found` : `All ${total}`}, in the list's order`, x.which)}
          ${state.query ? opt('all', `All ${total}`, x.which) : ''}
          ${markedRecords(db).length || x.which === 'marked' ? opt('marked', `The ${markedRecords(db).length} marked`, x.which) : ''}
          ${opt('ids', 'These record numbers…', x.which)}
        </select>
        ${x.which === 'ids' ? `<input name="ids" value="${esc(x.ids)}" placeholder="e.g. 12-40, 55, 500-" size="22" aria-label="Record numbers"> <span id="idcount" class="hint"></span>` : ''}</div>
        ${NUMBERED.includes(x.format) ? `<div class="row"><label class="check"><input type="checkbox" name="numbers" ${x.numbers ? 'checked' : ''}> <span>Include record numbers (a <code>Record#</code> ${x.format === 'vertical' ? 'line' : 'column'}; importing into a new notebook keeps them)</span></label></div>` : ''}
        <div class="buttons"><button type="submit">${pdf ? 'Save as PDF' : 'Save file'}</button></div>
        ${isForm ? formEditor(form, pdf) : ''}
        </div>`;
  $('#main').innerHTML = `
    <form class="panel ${isForm || x.format === 'vertical' ? 'exportwide' : ''}" id="exportform">
      <div class="exportmain">
        <h2>Export</h2>
        ${EXPORT_GROUPS.map(([title, items]) => `
        <fieldset class="formatlist"><legend>${esc(title)}</legend>
          ${items.map(([v, name, about, kind]) => `<label class="check"><input type="radio" name="format" value="${v}" ${x.format === v ? 'checked' : ''}>
            <span><strong>${esc(name)}</strong> <span class="kind">${esc(kind)}</span><br><span class="hint">${esc(about)}</span></span></label>`).join('')}
        </fieldset>
        ${items.some(([v]) => v === x.format) ? settings : ''}`).join('')}
        <p class="hint">To print on paper, save a PDF and print that.</p>
      </div>
      ${isForm || x.format === 'vertical' ? `<div class="printpreview"><h2>Preview${pdf ? ' of the PDF pages' : ''}</h2><pre id="printout"></pre></div>` : ''}
    </form>`;
  const el = $('#exportform');
  // Choices that change what the screen shows redraw it; typing only updates the preview.
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.name) return;
    x[t.name] = t.type === 'checkbox' ? t.checked : t.name === 'fontSize' ? +t.value : t.value;
    if (t.name === 'format' && t.value === 'notebook') x.encoding = 'cp437';
    if (['format', 'output', 'paper', 'fontSize', 'which'].includes(t.name)) render();
    else if (t.name === 'numbers') updateExportPreview();
  });
  el.addEventListener('input', (e) => {
    if (['fieldDelim', 'recordDelim', 'newlineMarker', 'ids'].includes(e.target.name)) x[e.target.name] = e.target.value;
    if (e.target.name === 'ids') updateExportPreview();
  });
  if (isForm) wireFormEditor(form);
  updateExportPreview();
  el.addEventListener('submit', (e) => { e.preventDefault(); saveExport(); });
}

function formEditor(form, pdf) {
  const db = state.db;
  return `
    <h2>Form</h2>
    <div class="row"><select id="formsel" aria-label="Form">${db.printForms.map((f, i) => `<option value="${i}" ${i === state.formIndex ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
      <button type="button" id="newform">New form</button><button type="button" id="delform" ${db.printForms.length > 1 ? '' : 'disabled'}>Delete form</button></div>
    <div class="row"><label>Name</label><input id="formname" value="${esc(form.name)}"><label>Width</label><input id="formwidth" type="number" min="20" max="250" value="${form.width}"> characters</div>
    <label class="formlabel" for="template">Each record</label>
    <textarea id="template" spellcheck="false" rows="8">${esc(form.template)}</textarea>
    <p class="hint"><code>{Field}</code> puts in a field, <code>{Field:20}</code> exactly 20 characters of it, <code>{#}</code> the record's number. A line written as <code>[[ … ]]</code> is left out when its fields are blank. Fields: ${db.fields.map((f) => `<code>{${esc(f.name)}}</code>`).join(' ')}</p>
    <div class="row"><label for="formheader">Page header</label><input id="formheader" value="${esc(form.header ?? '')}" placeholder="none" size="40"></div>
    <div class="row"><label for="formfooter">Page footer</label><input id="formfooter" value="${esc(form.footer ?? '')}" placeholder="none" size="40"></div>
    <p class="hint">In the header and footer: <code>{@page}</code> the page number, <code>{@pages}</code> how many pages, <code>{@date}</code> today's date, <code>{@time}</code> the time — for example <code>Notes, {@date}</code> and <code>Page {@page} of {@pages}</code>.${pdf ? ' They go on every page of the PDF.' : ''}</p>
    ${pdf ? '' : `<div class="row"><label class="check"><input type="checkbox" id="textpages" ${form.textPages ? 'checked' : ''}> Cut the text file into pages of</label>
      <input id="pagelines" type="number" min="10" max="255" value="${form.pageLines || 66}" ${form.textPages ? '' : 'disabled'}> lines, with the header and footer on each (otherwise they appear once, at the start and end)</div>`}`;
}

function wireFormEditor(form) {
  const db = state.db;
  const changed = () => { updateExportPreview(); persistSoon(); };
  $('#template').addEventListener('input', (e) => { form.template = e.target.value; changed(); });
  $('#formname').addEventListener('input', (e) => { form.name = e.target.value; persistSoon(); });
  $('#formname').addEventListener('change', () => render());
  for (const k of ['header', 'footer']) $(`#form${k}`).addEventListener('input', (e) => { form[k] = e.target.value; changed(); });
  $('#formwidth').addEventListener('input', (e) => { form.width = Math.max(20, Math.min(250, +e.target.value || 76)); changed(); });
  $('#textpages')?.addEventListener('change', (e) => { form.textPages = e.target.checked; $('#pagelines').disabled = !form.textPages; changed(); });
  $('#pagelines')?.addEventListener('input', (e) => { form.pageLines = Math.max(10, Math.min(255, +e.target.value || 66)); changed(); });
  $('#formsel').addEventListener('change', (e) => { state.formIndex = +e.target.value; render(); });
  $('#newform').addEventListener('click', () => {
    db.printForms.push({ ...defaultPrintForm(fieldNames(db)), name: `Form ${db.printForms.length + 1}` });
    state.formIndex = db.printForms.length - 1;
    persist();
    render();
  });
  $('#delform').addEventListener('click', async () => {
    if (!(await ask(`Delete the form "${form.name}"?`, 'Delete form'))) return;
    db.printForms.splice(state.formIndex, 1);
    persist();
    render();
  });
  // Keep the screen's own keys out of the template and header boxes.
  for (const id of ['#template', '#formheader', '#formfooter', '#formname']) $(id).addEventListener('keydown', (e) => e.stopPropagation());
}

// The records to export: those in the list, all of them, or those with the
// numbers given (in the list's order).
function exportRecords() {
  const x = state.exp;
  if (x.which === 'all') return orderRecords(state.db.records, state.sortKeys, state.db.order);
  if (x.which === 'marked') return orderRecords(markedRecords(state.db), state.sortKeys, state.db.order);
  if (x.which !== 'ids') return state.list;
  let ranges;
  try {
    ranges = parseIdRanges(x.ids);
  } catch (e) {
    x.idsError = x.ids.trim() ? e.message : 'Type the record numbers to export, e.g. 12-40, 55, 500-';
    return [];
  }
  x.idsError = '';
  return orderRecords(state.db.records.filter((r) => inIdRanges(r.id, ranges)), state.sortKeys, state.db.order);
}

// Fields and records as exported, with a Record# column if asked for.
function exportShape(recs) {
  const fields = fieldNames(state.db);
  return NUMBERED.includes(state.exp.format) && state.exp.numbers ? withRecordNumbers(fields, recs) : { fields, records: recs };
}

// One text per record, for a form or vertical text.
function exportBlocks(recs, width) {
  const f = fieldNames(state.db);
  if (state.exp.format === 'form') return renderBlocks(currentForm(), recs, f, width ? { width } : {});
  const shape = exportShape(recs);
  return verticalBlocks(shape.fields, shape.records);
}

function pdfOptions() {
  const x = state.exp;
  const form = x.format === 'form' ? currentForm() : null;
  return { paper: x.paper, fontSize: x.fontSize, header: form?.header ?? '', footer: form?.footer ?? '', title: form ? `${state.db.name}: ${form.name}` : state.db.name };
}

function updateExportPreview() {
  const out = $('#printout');
  if (!out) return;
  const x = state.exp;
  const all = exportRecords();
  const recs = all.slice(0, 60);
  let text;
  if (x.output === 'pdf') text = previewPdf(exportBlocks(recs), pdfOptions());
  else if (x.format === 'form') text = renderReport(currentForm(), recs, fieldNames(state.db)).replace(/\f/g, `${'─'.repeat(currentForm().width)}\n`);
  else {
    const shape = exportShape(recs);
    text = exportVertical(shape.fields, shape.records).replace(/\r/g, '');
  }
  out.textContent = text + (all.length > recs.length ? `\n… and ${all.length - recs.length} more records (all are saved).\n` : '');
  const count = $('#idcount');
  if (count) {
    count.textContent = x.idsError || `${all.length} record${all.length === 1 ? '' : 's'}`;
    count.classList.toggle('error', !!x.idsError);
  }
}

// The PDF maker and its font load the first time a PDF is saved.
let pdfKit = null;
function loadPdfKit() {
  pdfKit ??= (async () => {
    if (!globalThis.jspdf) {
      await new Promise((ok, fail) => {
        const s = Object.assign(document.createElement('script'), { src: 'js/vendor/jspdf.umd.min.js', onload: ok, onerror: () => fail(new Error('Could not load the PDF maker.')) });
        document.head.append(s);
      });
    }
    const res = await fetch('fonts/DejaVuSansMono.ttf');
    if (!res.ok) throw new Error('Could not load the font for the PDF.');
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { jsPDF: globalThis.jspdf.jsPDF, font: btoa(bin) };
  })().catch((e) => { pdfKit = null; throw e; });
  return pdfKit;
}

async function saveExport() {
  const db = state.db;
  const x = state.exp;
  const recs = exportRecords();
  if (x.which === 'ids' && !recs.length) return say(x.idsError || 'No records have those numbers.', true);
  if (x.which === 'marked' && !recs.length) return say('No records are marked. Press M on a record to mark it.', true);
  const f = fieldNames(db);
  const shape = exportShape(recs);
  const base = safeName(db.name);
  const enc = x.encoding;
  if (PAGED.includes(x.format) && x.output === 'pdf') {
    say('Making the PDF…');
    try {
      const kit = await loadPdfKit();
      const { bytes, pages } = makePdf(exportBlocks(recs), { ...kit, ...pdfOptions() });
      const name = x.format === 'form' ? `${base}-${safeName(currentForm().name)}.pdf` : `${base}.pdf`;
      if (await download(name, bytes, 'application/pdf')) say(`PDF saved: ${pages} page${pages === 1 ? '' : 's'}, ${recs.length} record${recs.length === 1 ? '' : 's'}.`);
      else say('');
    } catch (e) {
      say(String(e.message ?? e), true);
    }
    return;
  }
  switch (x.format) {
    case 'json':
      if (recs.length === db.records.length) { db.lastBackup = new Date().toISOString(); persist(); }
      return download(`${base}.nb2.json`, toBytes(exportJson(db, recs)), 'application/json');
    case 'vertical': return download(`${base}.txt`, toBytes(exportVertical(shape.fields, shape.records), enc), 'text/plain');
    case 'form': return download(`${base}-${safeName(currentForm().name)}.txt`, toBytes(renderReport(currentForm(), recs, f, { title: db.name }).replace(/\n/g, '\r\n'), enc), 'text/plain');
    case 'csv': return download(`${base}.csv`, toBytes(exportDelimited(shape.fields, shape.records), enc), 'text/csv');
    case 'tab': return download(`${base}.txt`, toBytes(exportDelimited(shape.fields, shape.records, { fieldDelim: '\t' }), enc), 'text/plain');
    case 'tagged': return download(`${base}.txt`, toBytes(exportTagged(shape.fields, shape.records), enc), 'text/plain');
    case 'notebook': return download(`${base.slice(0, 8)}.txt`, toBytes(exportNotebookText(f, recs), enc), 'text/plain');
    case 'custom': return download(`${base}.txt`, toBytes(exportDelimited(shape.fields, shape.records, {
      fieldDelim: readDelim(x.fieldDelim) || '|',
      recordDelim: readDelim(x.recordDelim) || '\r\n',
      newlineMarker: readDelim(x.newlineMarker),
      header: x.header,
      quote: false,
    }), enc), 'text/plain');
  }
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const layout = LAYOUTS.find((l) => l.id === form.layout.value) ?? LAYOUTS[0];
    const name = form.name.value.trim() || 'Notes';
    const db = createDatabase(name, layout.fields);
    if (platform.desktop) {
      const path = await platform.pickNotebookPath(safeName(name));
      if (!path) return say('Not made: choose where to save the notebook file.');
      if (state.db) await closeDb();
      openDb(db, null, path);
      await writeFile();
    } else {
      openDb(db);
    }
    go('fields');
    say(`Notebook "${name}" made. Set up its fields here, then press Esc to start adding notes.`);
  });
}

// ---------- marks ----------
//
// M marks a record, to collect a hand-picked set; @marked finds them again
// and Export can take just those.

const markCount = () => markedRecords(state.db).length;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function toggleMark() {
  const rec = state.mode === 'view' ? viewed() : current();
  if (!rec) return;
  setMarked(state.db, [rec], !rec.marked);
  persistSoon();
  say(`${rec.marked ? 'Marked' : 'Unmarked'} #${rec.id}. ${plural(markCount(), 'record')} marked.`);
  if (state.mode !== 'view') return render();
  // On a record, leave the fields (and any find) as they are.
  renderTitle();
  const meta = $('#recordform .meta');
  if (meta) meta.innerHTML = recordMeta(rec);
}

function markList(on) {
  const n = setMarked(state.db, state.list, on);
  persistSoon();
  say(`${on ? 'Marked' : 'Unmarked'} ${plural(n, 'record')}. ${plural(markCount(), 'record')} marked.`);
  render();
}

function showMarked() {
  if (!markCount()) return say('No records are marked. Press M on a record to mark it.', true);
  if (state.mode !== 'browse') go('browse');
  $('#search').value = '@marked';
  applySearch('@marked');
}

async function clearMarks() {
  const n = markCount();
  if (!n) return say('No records are marked.');
  if (n > 1 && !(await ask(`Unmark all ${n} marked records?`, 'Unmark'))) return;
  setMarked(state.db, state.db.records, false);
  persistSoon();
  say('Marks cleared.');
  render();
}

async function deleteMarked() {
  const marked = markedRecords(state.db);
  if (!marked.length) return say('No records are marked.', true);
  if (!(await ask(`Delete the ${plural(marked.length, 'marked record')}? This cannot be undone.`, 'Delete'))) return;
  if (state.mode === 'view' && viewed()?.marked) state.viewId = null;
  deleteRecords(state.db, marked.map((r) => r.id));
  persist();
  refreshList();
  state.cursor = Math.min(state.cursor, Math.max(0, state.list.length - 1));
  go('browse');
  say(`Deleted ${plural(marked.length, 'record')}.`);
}

async function deleteCurrent() {
  const rec = state.mode === 'view' ? viewed() : current();
  if (!rec) return;
  const label = preview(rec.values[state.db.fields[0].name], 50) || 'this record';
  if (!(await ask(`Delete "${label}"? This cannot be undone.`, 'Delete'))) return;
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

// ---------- appearance ----------

function renderAppearance() {
  const a = getAppearance();
  const size = a.size ?? (parseFloat(getComputedStyle(document.body).fontSize) || SIZE.default);
  const sample = 'Cocoa prices, CO 96/728, 1938-03-17. The quick brown fox: 0123456789 Ç é ¶';
  const theme = getTheme();
  $('#main').innerHTML = `
    <form class="panel" id="appearanceform">
      <h2>Appearance</h2>
      <h2>Font</h2>
      ${FONTS.map((f) => `
        <label class="check layout"><input type="radio" name="font" value="${f.id}" ${a.font === f.id ? 'checked' : ''}>
          <span><strong>${esc(f.name)}</strong>${f.id === 'dos' ? ' <span class="hint">(the default)</span>' : ''}<br>
          ${f.id === 'custom'
            ? `<input name="custom" value="${esc(a.custom)}" placeholder="Font name, e.g. Courier New or Atkinson Hyperlegible" size="40" aria-label="Font name">`
            : `<span class="fontsample" style="font-family: ${f.stack ? esc(f.stack) : 'var(--dos-font)'}">${esc(sample)}</span>`}</span></label>`).join('')}
      <h2>Text size</h2>
      <div class="row"><button type="button" data-size="-1" title="Smaller">A−</button>
        <input type="range" name="size" min="${SIZE.min}" max="${SIZE.max}" value="${size}" aria-label="Text size">
        <button type="button" data-size="1" title="Larger">A+</button> <span id="sizeval">${size} px</span></div>
      <h2>Line spacing</h2>
      <div class="row">${Object.keys(SPACING).map((k) => `<label class="check"><input type="radio" name="spacing" value="${k}" ${a.spacing === k ? 'checked' : ''}> ${k[0].toUpperCase() + k.slice(1)}</label>`).join('')}</div>
      <h2>Light or dark</h2>
      <div class="row">${THEMES.map((t) => `<label class="check"><input type="radio" name="theme" value="${t}" ${theme === t ? 'checked' : ''}> ${{ auto: 'Follow the computer', light: 'Light', dark: 'Dark' }[t]}</label>`).join('')}</div>
      <p class="hint">Changes show at once and are kept on this ${platform.desktop ? 'computer' : 'browser'}. A font has to be installed on the computer to be used; if it isn't, the DOS screen font shows instead.</p>
      <div class="buttons"><button type="button" id="resetlook">Back to the defaults</button></div>
    </form>`;
  const form = $('#appearanceform');
  const update = () => {
    const size = +form.size.value;
    $('#sizeval').textContent = `${size} px`;
    setAppearance({ font: form.font.value, custom: form.custom.value, size, spacing: form.spacing.value });
  };
  form.addEventListener('input', (e) => {
    if (e.target.name === 'theme') { setTheme(e.target.value); renderTitle(); return; }
    if (e.target.name === 'custom' && form.font.value !== 'custom') form.querySelector('[value=custom]').checked = true;
    update();
  });
  $$('[data-size]', form).forEach((b) => b.addEventListener('click', () => { form.size.value = +form.size.value + +b.dataset.size; update(); }));
  $('#resetlook').addEventListener('click', () => { resetAppearance(); render(); say('Appearance back to the defaults.'); });
  form.addEventListener('submit', (e) => e.preventDefault());
}

// ---------- blocks: Ctrl+Space (or Ctrl+F2) in a record's field ----------
//
// As in Emacs, Ctrl+Space sets the mark; the arrow keys, Home, End, PgUp, PgDn
// (with Ctrl for words) then stretch a block from the mark to the cursor.
// Ctrl+C copies it, Ctrl+X cuts it, Delete or typing replaces it, Esc or
// Ctrl+Space again cancels it. Ctrl+F2 was "Mark" in Notebook II's editor.

const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
let mark = null; // { ta, at: where the mark is, caret: where the cursor is }
let markTimer = null;

function endMark(message) {
  if (!mark) return;
  mark = null;
  if (message) say(message);
}

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLTextAreaElement) || !t.closest('#recordform')) return;
  if (e.ctrlKey && !e.altKey && !e.metaKey && (e.code === 'Space' || e.key === 'F2')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (mark?.ta === t) return endMark('Block cancelled.');
    const at = t.selectionDirection === 'backward' ? t.selectionStart : t.selectionEnd;
    t.setSelectionRange(at, at);
    mark = { ta: t, at, caret: at };
    return say('Block started. Move the cursor to stretch it; Ctrl+C copies, Ctrl+X cuts, Delete removes, Esc cancels.');
  }
  if (!mark || mark.ta !== t) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    t.setSelectionRange(mark.caret, mark.caret);
    return endMark('Block cancelled.');
  }
  if (MOVE_KEYS.includes(e.key) && !e.shiftKey) {
    // Move from the cursor end, then let the browser move it, then stretch.
    // The cursor end is read afresh each time, so held-down keys keep up.
    const c = t.selectionStart === t.selectionEnd ? t.selectionStart
      : t.selectionDirection === 'backward' ? t.selectionStart : t.selectionEnd;
    mark.caret = c;
    t.setSelectionRange(c, c);
    // Only the latest press stretches the block, after the browser has moved
    // the cursor; an earlier one still waiting would read a stale position.
    clearTimeout(markTimer);
    markTimer = setTimeout(() => {
      if (mark?.ta !== t || t.selectionStart !== t.selectionEnd) return;
      const c = t.selectionStart;
      mark.caret = c;
      t.setSelectionRange(Math.min(mark.at, c), Math.max(mark.at, c), c < mark.at ? 'backward' : 'forward');
    }, 0);
    return;
  }
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  endMark(); // anything else acts on the block as on any selection
}, true);
document.addEventListener('focusout', (e) => { if (mark?.ta === e.target) endMark(); });
document.addEventListener('mousedown', (e) => { if (mark && e.target === mark.ta) endMark(); });

// ---------- find in the record on screen ----------
//
// On a record the box in the title bar looks inside that record: every match
// is marked, Enter goes to the next and Shift+Enter the previous, Esc puts the
// cursor on the match. The words stay while you page through records and are
// dropped when you go back to the list.

const rf = { query: '', matches: [], cur: 0 };

function updateRecordFind() {
  const rec = viewed();
  if (!rec) return;
  const query = $('#search').value;
  const changed = query !== rf.query;
  rf.query = query;
  if (!query.trim()) {
    rf.matches = [];
    renderView(); // back to the list's own marks, if any
    return say('');
  }
  const r = findInTexts(state.db.fields.map(({ name }) => rec.values[name] ?? ''), query);
  if (r.error) return say(r.error, true);
  rf.matches = r.matches;
  if (changed) rf.cur = 0;
  rf.cur = Math.min(rf.cur, Math.max(0, rf.matches.length - 1));
  paintRecordFind();
}

function endRecordFind() {
  rf.query = '';
  rf.matches = [];
  rf.cur = 0;
}

function stepRecordFind(dir) {
  const n = rf.matches.length;
  if (!n) return;
  rf.cur = (rf.cur + dir + n) % n;
  paintRecordFind();
}

function paintRecordFind() {
  const areas = $$('#recordform textarea');
  areas.forEach((t, i) => {
    const wrap = t.parentElement;
    wrap.querySelector('.fmark')?.remove();
    const here = rf.matches.map((m, k) => ({ ...m, k })).filter((m) => m.field === i);
    if (!here.length) return;
    let html = '';
    let at = 0;
    for (const m of here) {
      html += esc(t.value.slice(at, m.start)) + `<mark${m.k === rf.cur ? ' class="cur"' : ''}>${esc(t.value.slice(m.start, m.end))}</mark>`;
      at = m.end;
    }
    wrap.insertAdjacentHTML('beforeend', `<span class="fmark" aria-hidden="true">${html}${esc(t.value.slice(at))}</span>`);
  });
  const n = rf.matches.length;
  say(n ? `Match ${rf.cur + 1} of ${n} in this record.` : 'Not in this record.', !n);
  $('#recordform mark.cur')?.scrollIntoView({ block: 'center' });
}

// Esc: into the field at the match, with the match selected.
function goToMatch() {
  const m = rf.matches[rf.cur];
  const t = m && $$('#recordform textarea')[m.field];
  if (!t) return $('#search').blur();
  t.focus();
  t.setSelectionRange(m.start, m.end);
}

function recordFindKeys(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(searchTimer);
    const fresh = rf.query !== e.target.value || !rf.matches.length;
    updateRecordFind(); // also picks up any typing in the record since
    if (!fresh) stepRecordFind(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(searchTimer);
    if (rf.query !== e.target.value) updateRecordFind();
    goToMatch();
  }
}

// ---------- yes / no questions ----------
//
// Drawn in the page like the command palette, because desktop windows and some
// embedded browsers do not show the browser's own confirm() box. Y or Enter on
// the button says yes; N or Esc says no.

let asking = null;

function ask(message, yesLabel = 'Yes') {
  const box = $('#ask');
  $('#askmsg').textContent = message;
  $('#askyes').textContent = yesLabel;
  box.hidden = false;
  const back = document.activeElement;
  $('#askno').focus();
  return new Promise((resolve) => {
    asking = (answer) => {
      asking = null;
      box.hidden = true;
      back?.focus?.();
      resolve(answer);
    };
  });
}

$('#askyes').addEventListener('click', () => asking?.(true));
$('#askno').addEventListener('click', () => asking?.(false));
document.addEventListener('keydown', (e) => {
  if (!asking) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' || k === 'n') { e.preventDefault(); asking(false); }
  else if (k === 'y') { e.preventDefault(); asking(true); }
  else if (k === 'tab') { e.preventDefault(); (document.activeElement === $('#askno') ? $('#askyes') : $('#askno')).focus(); }
  e.stopImmediatePropagation();
}, true);

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
      items.push({ label: `Find records by ${name}…`, hint: '', run: () => { if (state.mode === 'view') go('browse'); const s = $('#search'); focusSearch(); s.value = `${/\s/.test(name) ? `"${name}"` : name}:`; } });
    }
  }
  return items;
}

function openPalette() {
  palette.back = document.activeElement;
  palette.open = true;
  palette.sel = 0;
  $('#palette').hidden = false;
  const input = $('#pinput');
  input.value = '';
  renderPalette();
  input.focus();
}

// Focus goes back where it was, so keys work again straight away; a command
// that moves focus itself (Find, a new note) does so afterwards.
function closePalette() {
  palette.open = false;
  $('#palette').hidden = true;
  const back = palette.back;
  palette.back = null;
  if (back?.isConnected && back !== document.body) back.focus();
  else $('#main').focus();
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
  if (key === 'Ctrl+f') return runCommand('find');
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
    const saved = homeEntries();
    if (key === 'ArrowDown') { state.homeCursor = Math.min(saved.length - 1, state.homeCursor + 1); render(); return; }
    if (key === 'ArrowUp') { state.homeCursor = Math.max(0, state.homeCursor - 1); render(); return; }
    if ((key === 'o' || key === 'O') && !platform.desktop) return runCommand('import');
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
  if (key.startsWith('Ctrl+') && !['Ctrl+s', 'Ctrl+Shift+s', 'Ctrl+k', 'Ctrl+d', 'Ctrl+Shift+d', 'Ctrl+home', 'Ctrl+end', 'Ctrl+f'].includes(key)) return;
  if (key === 'Ctrl+f' && !(state.db && ['browse', 'view'].includes(state.mode))) return;
  if ((key === 'Ctrl+home' || key === 'Ctrl+end') && state.mode !== 'view') return;
  if (onKey(key, e) !== false) e.preventDefault();
});

$('#keys').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) runCommand(b.dataset.cmd);
});

$('#themebtn').addEventListener('click', cycleTheme);

// ---------- desktop app: menu bar, closing, files opened from outside ----------

const MENU = {
  newdb: () => go('newdb'),
  open: () => openFile(),
  saveas: () => state.db && saveAs(),
  import: () => pickFiles(startImport),
  export: () => state.db && go('export'),
  print: () => state.db && exportWith('form'),
  close: () => state.db && closeDb(),
  new: () => state.db && newRecord(),
  copyprev: () => runCommand('copyprev'),
  copyfield: () => runCommand('copyfield'),
  delete: () => state.db && ['browse', 'view'].includes(state.mode) && deleteCurrent(),
  mark: () => runCommand('mark'),
  markall: () => runCommand('markall'),
  clearmarks: () => runCommand('clearmarks'),
  delmarked: () => runCommand('delmarked'),
  showmarked: () => runCommand('showmarked'),
  find: () => state.db && focusSearch(),
  all: () => state.db && (state.mode === 'browse' || go('browse'), clearSearch()),
  sort: () => state.db && go('sort'),
  fields: () => state.db && go('fields'),
  theme: () => cycleTheme(),
  palette: () => openPalette(),
  appearance: () => go('appearance'),
  help: () => go('help'),
  quit: () => platform.closeWindow(),
};
platform.onMenu((id) => {
  if (asking) return;
  if (palette.open) closePalette();
  MENU[id]?.();
});
platform.onOpenFile((path) => openFile(path));
platform.beforeClose(async () => {
  if (state.mode === 'view') leaveRecord();
  persist();
  await flushAll();
});

render();
platform.launchFile().then((path) => { if (path) openFile(path); });

// The web page works offline once visited, and can be installed as an app.
if (!platform.desktop && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
