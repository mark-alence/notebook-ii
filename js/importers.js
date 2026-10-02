// Read files into { fields, records } so they can become a database.
//
//   notebook   Notebook II's own database files (NAME.DAT, .DEF, .IDX, .MSC,
//              and custom print formats *.R00); see "native" below
//   delimited  fields split by a character (tab, comma, |, ~, ^ ...)
//   tagged     "Field: value" lines, records separated by blank or rule lines,
//              including Notebook II's own import text (%Start: %Field: %End:)
//   json       files saved by this program
//   salvage    pulls readable text out of any binary file, as a last resort
import { decodeBytes, decodeCp437 } from './cp437.js';

const EOF_MARK = '\x1a'; // DOS end-of-file (Ctrl-Z)

export function cleanText(text) {
  const eof = text.indexOf(EOF_MARK);
  if (eof >= 0) text = text.slice(0, eof);
  return text.replace(/\r\n?/g, '\n');
}

export function isProbablyBinary(bytes) {
  const n = Math.min(bytes.length, 64 * 1024);
  if (!n) return false;
  let ctl = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0x1a) break;
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 13 && b !== 12 && b !== 0x1e && b !== 0x1f && b !== 0x14) ctl++;
  }
  return ctl / n > 0.05;
}

// ---------- delimited ----------

// Split text into rows of fields. Fields wrapped in the quote character may
// contain delimiters; a doubled quote inside them is a literal quote.
export function splitDelimited(text, { fieldDelim, recordDelim = '\n', quote = '"' }) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;
  let atFieldStart = true;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === quote) {
        if (text[i + 1] === quote) { field += quote; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (quote && c === quote && atFieldStart) { quoted = true; atFieldStart = false; i++; continue; }
    if (text.startsWith(fieldDelim, i)) {
      row.push(field); field = ''; i += fieldDelim.length; atFieldStart = true; continue;
    }
    if (text.startsWith(recordDelim, i)) {
      row.push(field); rows.push(row); row = []; field = ''; i += recordDelim.length; atFieldStart = true; continue;
    }
    field += c; atFieldStart = false; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Drop rows that are entirely blank (trailing newlines, spacer lines).
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const FIELD_DELIMS = ['\t', '|', '\x1f', '~', '^', ';', ','];
const RECORD_DELIMS = ['\x1e', '\f', '\x1d'];

export function detectDelimited(text) {
  const recordDelim = RECORD_DELIMS.find((d) => text.includes(d)) ?? '\n';
  let best = null;
  for (const fieldDelim of FIELD_DELIMS) {
    if (fieldDelim === recordDelim || !text.includes(fieldDelim)) continue;
    const rows = splitDelimited(text.slice(0, 200_000), { fieldDelim, recordDelim, quote: '"' });
    if (rows.length < 1) continue;
    const counts = new Map();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    const [mode, freq] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (mode < 2) continue;
    const score = (freq / rows.length) * 10 + Math.min(mode, 10) / 10;
    if (!best || score > best.score) best = { fieldDelim, recordDelim, score };
  }
  return {
    fieldDelim: best?.fieldDelim ?? '\t',
    recordDelim,
    quote: '"',
    header: 'auto',
    newlineMarker: text.includes('\x14') ? '\x14' : '',
  };
}

function looksLikeHeader(rows) {
  if (rows.length < 2) return false;
  const first = rows[0].map((s) => s.trim());
  if (first.some((s) => !s || s.length > 40 || !/\p{L}/u.test(s) || /^\d/.test(s))) return false;
  if (new Set(first.map((s) => s.toLowerCase())).size !== first.length) return false;
  // A header row's words shouldn't repeat as values in the same column.
  return first.every((h, c) => !rows.slice(1).some((r) => (r[c] ?? '').trim() === h));
}

export function parseDelimited(text, options = {}) {
  text = cleanText(text);
  const opts = { ...detectDelimited(text), ...options };
  const rows = splitDelimited(text, opts);
  const header = opts.header === 'auto' ? looksLikeHeader(rows) : !!opts.header;
  const width = Math.max(0, ...rows.map((r) => r.length));
  let fields = header ? uniqueNames(rows[0].map((s) => s.trim())) : [];
  for (let c = fields.length; c < width; c++) fields.push(`Field ${c + 1}`);
  fields = uniqueNames(fields);
  const fix = (v) => {
    if (opts.newlineMarker) v = v.split(opts.newlineMarker).join('\n');
    return v.replace(/[ \t]+$/gm, '').trim();
  };
  const records = (header ? rows.slice(1) : rows).map((r) =>
    Object.fromEntries(fields.map((f, c) => [f, fix(r[c] ?? '')])),
  );
  return { format: 'delimited', options: { ...opts, header }, fields, records, warnings: [] };
}

function uniqueNames(names) {
  const seen = new Map();
  return names.map((n, i) => {
    n = n || `Field ${i + 1}`;
    const k = n.toLowerCase();
    const count = seen.get(k) ?? 0;
    seen.set(k, count + 1);
    return count ? `${n} ${count + 1}` : n;
  });
}

// ---------- tagged ----------

const TAG_LINE = /^([\p{L}][\p{L}\p{N} _.\-/#&]{0,39}?)\s*:[ \t]?(.*)$/u;
const RULE_LINE = /^\s*(?:\f|\x1e|-{3,}|\*{3,}|={3,}|~{1,}|#{3,})\s*$/;

function tagOf(line) {
  const m = TAG_LINE.exec(line);
  if (!m || /^\s/.test(line)) return null;
  // "http://..." and times like "10:30" are not tags.
  if (/^\/\//.test(m[2])) return null;
  return { tag: m[1].trim(), value: m[2] };
}

// Notebook II's own import text: %Start:, then %Field:value lines (other lines
// continue the field above), then %End:.
const NB_START = /^%start:/im;
const NB_TAG = /^%([^:\n]{1,40}):(.*)$/;

export function detectTagged(text) {
  if (NB_START.test(text) && /^%end:/im.test(text)) return true;
  const lines = cleanText(text).split('\n').filter((l) => l.trim()).slice(0, 2000);
  if (lines.length < 2) return false;
  const tags = lines.map(tagOf).filter(Boolean);
  if (tags.length / lines.length < 0.4) return false;
  const distinct = new Set(tags.map((t) => t.tag.toLowerCase())).size;
  // Tags should repeat from record to record.
  return distinct <= Math.max(3, tags.length / 2);
}

export function parseTagged(text) {
  if (NB_START.test(text)) return parseNotebookText(text);
  text = cleanText(text).replace(/\f/g, '\n\f\n');
  const lines = text.split('\n');
  const hasRules = lines.some((l) => RULE_LINE.test(l));
  const fields = [];
  const fieldKeys = new Map();
  const records = [];
  let cur = null;
  let last = null;
  let blankRun = 0;

  const fieldName = (tag) => {
    const k = tag.toLowerCase();
    if (!fieldKeys.has(k)) { fieldKeys.set(k, tag); fields.push(tag); }
    return fieldKeys.get(k);
  };
  const finish = () => {
    if (cur && Object.values(cur).some((v) => v.trim())) {
      for (const k of Object.keys(cur)) cur[k] = cur[k].replace(/\s+$/, '');
      records.push(cur);
    }
    cur = null; last = null;
  };

  for (const line of lines) {
    if (RULE_LINE.test(line)) { finish(); blankRun = 0; continue; }
    if (!line.trim()) { blankRun++; continue; }
    const t = tagOf(line);
    // Without rule lines, a blank line before a tag line ends the record.
    if (t && cur && !hasRules && blankRun > 0) finish();
    // A field that is already filled in starts the next record.
    if (t && cur && fieldName(t.tag) in cur) finish();
    if (t) {
      cur ??= {};
      const f = fieldName(t.tag);
      cur[f] = t.value.trim();
      last = f;
    } else if (cur && last) {
      cur[last] += (cur[last] ? (blankRun ? '\n\n' : '\n') : '') + line.trim();
    } else {
      cur ??= {};
      const f = fieldName('Text');
      cur[f] = (cur[f] ? cur[f] + '\n' : '') + line.trim();
      last = f;
    }
    blankRun = 0;
  }
  finish();
  for (const r of records) for (const f of fields) r[f] ??= '';
  return { format: 'tagged', options: {}, fields, records, warnings: [] };
}

function parseNotebookText(text) {
  const fields = [];
  const keys = new Map();
  const records = [];
  let cur = null;
  let last = null;
  const finish = () => {
    if (cur && Object.values(cur).some((v) => v.trim())) {
      for (const k of Object.keys(cur)) cur[k] = cur[k].replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
      records.push(cur);
    }
    cur = null; last = null;
  };
  for (const line of cleanText(text).split('\n')) {
    const m = NB_TAG.exec(line);
    const tag = m?.[1].trim();
    if (m && /^start$/i.test(tag)) { finish(); cur = {}; continue; }
    if (m && /^end$/i.test(tag)) { finish(); continue; }
    if (m && tag) {
      const k = tag.toLowerCase();
      if (!keys.has(k)) { keys.set(k, tag); fields.push(tag); }
      cur ??= {};
      last = keys.get(k);
      cur[last] = cur[last] ? `${cur[last]}\n${m[2]}` : m[2];
    } else if (cur && last) {
      cur[last] += '\n' + line;
    }
  }
  finish();
  for (const r of records) for (const f of fields) r[f] ??= '';
  return { format: 'tagged', options: {}, fields, records, warnings: [] };
}

// ---------- salvage ----------

// Pull runs of readable text out of a file whose layout we don't know.
// Each run becomes a record, so nothing typed into the old program is lost.
export function parseSalvage(bytes, { minLength = 4, mergeGap = 2 } = {}) {
  const text = decodeBytes(bytes, 'cp437');
  const printable = (c) => c >= 0x20 || c === 9 || c === 10 || c === 13;
  const runs = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const ok = i < bytes.length && printable(bytes[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const prev = runs[runs.length - 1];
      if (prev && start - prev.end <= mergeGap) {
        prev.text += '\n' + text.slice(start, i);
        prev.end = i;
      } else {
        runs.push({ offset: start, end: i, text: text.slice(start, i) });
      }
      start = -1;
    }
  }
  const records = runs
    .map((r) => ({ ...r, text: r.text.replace(/\r\n?/g, '\n').trim() }))
    .filter((r) => r.text.replace(/[^\p{L}\p{N}]/gu, '').length >= minLength)
    .map((r) => ({ Text: r.text, Offset: `0x${r.offset.toString(16).toUpperCase().padStart(6, '0')}` }));
  return {
    format: 'salvage',
    options: { minLength, mergeGap },
    fields: ['Text', 'Offset'],
    records,
    warnings: ['This file is not plain text. Readable text was pulled out of it, one piece per record. Field boundaries are not known.'],
  };
}

// ---------- json (this program's own files) ----------

export function parseJson(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) {
    const fields = [...new Set(data.flatMap((o) => Object.keys(o)))];
    const records = data.map((o) => Object.fromEntries(fields.map((f) => [f, String(o[f] ?? '')])));
    return { format: 'json', options: {}, fields, records, warnings: [] };
  }
  if (Array.isArray(data.fields) && Array.isArray(data.records)) {
    const fields = data.fields.map((f) => (typeof f === 'string' ? f : f.name));
    const records = data.records.map((r) => {
      const v = r.values ?? r;
      return Object.fromEntries(fields.map((f) => [f, String(v[f] ?? '')]));
    });
    return { format: 'json', options: {}, fields, records, warnings: [], database: data };
  }
  throw new Error('This JSON file does not hold a list of records');
}

// ---------- native Notebook II databases ----------
//
// Worked out from the sample database shipped with Notebook II 2.31 (1987) and
// from files made with that version. A database NAME is a set of files:
//
//   NAME.DEF  field headings: 50 slots of 24 bytes, NUL-padded text
//   NAME.DAT  record text. Each field ends with NUL (0x00) and each record
//             with 0x80. A line break inside a field is a bare CR (0x0D).
//             Editing a record appends the new version; the old copy stays
//             behind as a "ghost" until the database is compacted.
//   NAME.IDX  105 bytes per record, in record order: a flag byte (0xFF =
//             marked deleted), 50 little-endian 16-bit field lengths (each
//             counting its NUL; 0 for a field the record lacks), then the
//             32-bit offset of the record's current copy in NAME.DAT
//   NAME.MSC  settings: 32-bit .DAT size, 32-bit record count, then options
//   FORM.R00  a custom print format (see parseReportFormat)
//
// Backups made while compacting use .BDT .BDF .BIX .BMS and work the same way.

const DEF_SLOT = 24;
const IDX_ENTRY = 105;
const MAX_FIELDS = 50;
const NATIVE_EXT = { dat: 'dat', bdt: 'dat', def: 'def', bdf: 'def', idx: 'idx', bix: 'idx', msc: 'msc', bms: 'msc' };

const nativeText = (bytes) => decodeCp437(bytes).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');

export function looksLikeNotebookDef(bytes) {
  if (!bytes || bytes.length !== DEF_SLOT * MAX_FIELDS) return false;
  const names = readDefNames(bytes);
  return names.length > 0 && names.every((n) => !/[\x00-\x1f]/.test(n));
}

// NUL-terminated fields, 0x80 after each record, and the same number of
// fields in (nearly) every record.
export function looksLikeNotebookDat(bytes) {
  if (!bytes || bytes.length < 3) return false;
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x1a) end--;
  if (bytes[end - 1] !== 0x80 || bytes[end - 2] !== 0) return false;
  const counts = new Map();
  let nuls = 0;
  let records = 0;
  for (let i = 0; i < end; i++) {
    const b = bytes[i];
    if (b === 0) nuls++;
    else if (b === 0x80 && bytes[i - 1] === 0) { counts.set(nuls, (counts.get(nuls) ?? 0) + 1); nuls = 0; records++; }
    else if (b < 0x20 && b !== 9 && b !== 13 && b !== 10 && b !== 0x14) return false;
  }
  const best = Math.max(...counts.values());
  return best / records >= 0.8;
}

function readDefNames(def) {
  const names = [];
  for (let i = 0; i + DEF_SLOT <= def.length && names.length < MAX_FIELDS; i += DEF_SLOT) {
    const slot = def.subarray(i, i + DEF_SLOT);
    const nul = slot.indexOf(0);
    names.push(decodeCp437(slot.subarray(0, nul < 0 ? DEF_SLOT : nul)).trim());
  }
  while (names.length && !names[names.length - 1]) names.pop();
  return names;
}

function readIdx(idx) {
  const view = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);
  const entries = [];
  for (let p = 0; p + IDX_ENTRY <= idx.length; p += IDX_ENTRY) {
    const lengths = [];
    for (let f = 0; f < MAX_FIELDS; f++) lengths.push(view.getUint16(p + 1 + f * 2, true));
    entries.push({ deleted: idx[p] === 0xff, flag: idx[p], lengths, offset: view.getUint32(p + 1 + MAX_FIELDS * 2, true) });
  }
  return entries;
}

// A record laid out by its index entry; null if the lengths don't fit the
// bytes there (a damaged or mismatched .IDX).
function recordFromIdx(dat, entry, count) {
  const values = [];
  let pos = entry.offset;
  for (let f = 0; f < count; f++) {
    const len = entry.lengths[f];
    if (!len) { values.push(''); continue; }
    if (pos + len > dat.length || dat[pos + len - 1] !== 0) return null;
    values.push(nativeText(dat.subarray(pos, pos + len - 1)));
    pos += len;
  }
  if (pos < dat.length && dat[pos] !== 0x80) return null;
  return values;
}

// Without an index: every record copy in file order, ghosts included.
function scanDat(dat) {
  const out = [];
  let fields = [];
  let start = 0;
  for (let i = 0; i < dat.length; i++) {
    if (dat[i] !== 0) continue;
    fields.push(nativeText(dat.subarray(start, i)));
    start = i + 1;
    if (dat[start] === 0x80) { out.push(fields); fields = []; start++; i++; }
  }
  return out;
}

export function parseNotebookDb({ dat, def, idx, msc, reports = [] } = {}, { includeDeleted = false } = {}) {
  const warnings = [];
  if (!dat) throw new Error('Choose the database\'s .DAT file as well (select NAME.DAT, NAME.DEF and NAME.IDX together).');
  let names = def ? readDefNames(def) : [];
  let rows;
  let deleted = 0;
  const entries = idx ? readIdx(idx) : [];
  if (msc && msc.length >= 8 && entries.length) {
    const count = new DataView(msc.buffer, msc.byteOffset, 8).getUint32(4, true);
    if (count > 0 && count < entries.length) entries.length = count;
  }
  const width = Math.max(names.length, 1);
  if (entries.length) {
    rows = [];
    let bad = 0;
    for (const e of entries) {
      const n = Math.max(width, e.lengths.findLastIndex((l) => l > 0) + 1);
      const values = recordFromIdx(dat, e, n);
      if (!values) { bad++; continue; }
      if (e.deleted) { deleted++; if (!includeDeleted) continue; }
      rows.push({ values, deleted: e.deleted });
    }
    if (bad) warnings.push(`${bad} index entr${bad === 1 ? 'y does' : 'ies do'} not match the .DAT file and ${bad === 1 ? 'was' : 'were'} skipped. Are the .DAT and .IDX from the same database?`);
  } else {
    rows = scanDat(dat).map((values) => ({ values, deleted: false }));
    warnings.push('Read without the .IDX file, so every stored copy is shown: records edited in Notebook II appear more than once (older copies first) and records marked deleted are included. Select the .IDX file too for an exact copy.');
  }
  const most = Math.max(0, ...rows.map((r) => r.values.length));
  if (!def) warnings.push('Field names are kept in the .DEF file; select it too to use them.');
  for (let c = names.length; c < most; c++) names.push(`Field ${c + 1}`);
  names = uniqueNames(names.map((n, i) => n || `Field ${i + 1}`));
  const fields = [...names];
  if (includeDeleted && deleted) fields.push(uniqueNames([...names, 'Deleted']).pop());
  const records = rows.map(({ values, deleted: del }) => {
    const rec = Object.fromEntries(names.map((f, c) => [f, values[c] ?? '']));
    if (fields.length > names.length) rec[fields[fields.length - 1]] = del ? 'yes' : '';
    return rec;
  });
  if (deleted && !includeDeleted) warnings.push(`${deleted} record${deleted === 1 ? '' : 's'} marked deleted in Notebook II ${deleted === 1 ? 'was' : 'were'} left out.`);
  const printForms = [];
  for (const r of reports) {
    try {
      printForms.push(parseReportFormat(r.bytes, names, r.name));
    } catch (e) {
      warnings.push(`Print format ${r.name}: ${e.message}`);
    }
  }
  return { format: 'notebook', options: { includeDeleted, deleted }, fields, records, printForms, warnings };
}

// ---------- Notebook II custom print formats (.R00) ----------
//
// 18 lines of 100 bytes, NUL-padded: line 0 is the page header, lines 1-16
// the text printed for each record, line 17 the page footer. Then options as
// 16-bit numbers: [3] left margin, [4] line length, [5] lines on a page.
// A field is ESC, 0x20 + field number (from 0), 0x20 + fixed width (0 means
// the whole field), FS. In the text, # is the record number, and in the
// header and footer # is the page number and @ the date and time. A line
// holding only | is a blank line, ^ a page break; \ at the end of a line
// joins it to the next and \ddd is a character code. ~ ~ marks text left out
// when its field is empty; _ _ underlines and * * sets a hanging indent.
const R_LINE = 100;
const R_LINES = 18;

export function looksLikeReportFormat(bytes) {
  return bytes?.length >= R_LINE * R_LINES + 12 && bytes.length <= R_LINE * R_LINES + 512;
}

export function parseReportFormat(bytes, fieldNames, fileName = 'FORMAT.R00') {
  if (!looksLikeReportFormat(bytes)) throw new Error('not a Notebook II print format');
  const raw = [];
  for (let l = 0; l < R_LINES; l++) {
    const line = bytes.subarray(l * R_LINE, (l + 1) * R_LINE);
    const nul = line.indexOf(0);
    raw.push(line.subarray(0, nul < 0 ? R_LINE : nul));
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + R_LINE * R_LINES, 12);
  const lineLength = view.getUint16(8, true);
  const pageLines = view.getUint16(10, true);
  const fieldRef = (n, w) => {
    const name = fieldNames[n] ?? `Field ${n + 1}`;
    return w ? `{${name}:${w}}` : `{${name}}`;
  };
  // Decode one line: field references become {Name}, \ddd becomes the character.
  const decode = (b, special) => {
    let out = '';
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 0x1b && i + 3 < b.length && b[i + 3] === 0x1c) {
        out += fieldRef(b[i + 1] - 0x20, b[i + 2] - 0x20);
        i += 3;
      } else if (b[i] === 0x5c && /^\d{3}$/.test(decodeCp437(b.subarray(i + 1, i + 4)))) {
        out += decodeCp437([+decodeCp437(b.subarray(i + 1, i + 4)) & 0xff]);
        i += 3;
      } else {
        const ch = decodeCp437([b[i]]);
        out += special[ch] ?? (ch === '{' || ch === '}' ? '' : ch);
      }
    }
    return out;
  };
  const pageText = (b) => decode(b, { '#': '{Page}', '@': '{Date} {Time}' }).trimEnd();
  const body = [];
  let joinNext = false;
  for (const b of raw.slice(1, R_LINES - 1)) {
    let line = decode(b, { '#': '{#}' }).trimEnd();
    if (line === '|') line = '';
    else if (line === '^') line = '\f';
    // _{Field}_ and *{Field}* only styled the printer output.
    line = line.replace(/([_*])(\{[^{}]+\})\1/g, '$2');
    // ~text {Field} text~: left out when the field is empty.
    if (/^\s*~[^~]*~\s*$/.test(line)) line = line.replace(/~([^~]*)~/, '[[$1]]');
    else line = line.replace(/~([^~]*\{[^{}]+\}[^~]*)~/g, '$1');
    const cont = /\\$/.test(line);
    if (cont) line = line.slice(0, -1);
    if (joinNext) body[body.length - 1] += line;
    else body.push(line);
    joinNext = cont;
  }
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const name = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  return {
    name: name ? name[0].toUpperCase() + name.slice(1).toLowerCase() : 'Imported',
    width: lineLength >= 20 && lineLength <= 250 ? lineLength : 76,
    template: body.join('\n'),
    header: pageText(raw[0]),
    footer: pageText(raw[R_LINES - 1]),
    pageLines: pageLines >= 10 && pageLines <= 255 ? pageLines : 66,
  };
}

// ---------- entry point ----------

// files: [{ name, bytes }]. Notebook II database files chosen together
// (NAME.DAT, NAME.DEF, NAME.IDX, NAME.MSC and any *.R00 print formats) are
// read as one database; a single file goes to importFile.
export function importFiles(files, options = {}) {
  const ext = (n) => (/\.([^.\\/]+)$/.exec(n)?.[1] ?? '').toLowerCase();
  const native = files.filter((f) => NATIVE_EXT[ext(f.name)] || /^r\d\d$/.test(ext(f.name)));
  const useNative = options.format === 'notebook' || (options.format ?? 'auto') === 'auto';
  if (useNative && native.length && (files.length > 1 || ['def', 'idx', 'msc'].includes(NATIVE_EXT[ext(files[0].name)]))) {
    // Prefer the live files over the .B?? backups when both are chosen.
    const parts = {};
    for (const f of native) {
      const kind = NATIVE_EXT[ext(f.name)];
      if (!kind) continue;
      const backup = ext(f.name).startsWith('b');
      if (!parts[kind] || (parts[kind].backup && !backup)) parts[kind] = { bytes: f.bytes, backup };
    }
    const reports = native.filter((f) => /^r\d\d$/.test(ext(f.name)));
    const result = parseNotebookDb({
      dat: parts.dat?.bytes, def: parts.def?.bytes, idx: parts.idx?.bytes, msc: parts.msc?.bytes, reports,
    }, options);
    const others = files.filter((f) => !native.includes(f));
    if (others.length) result.warnings.push(`Not part of a Notebook II database, so not read: ${others.map((f) => f.name).join(', ')}.`);
    return result;
  }
  if (files.length > 1) {
    const r = importFile(files[0].bytes, options);
    r.warnings = [...r.warnings, `Only ${files[0].name} was read; choose one file at a time unless they are a Notebook II database.`];
    return r;
  }
  return importFile(files[0].bytes, options);
}

export function importFile(bytes, { format = 'auto', encoding = 'auto', ...options } = {}) {
  if (format === 'notebook' || (format === 'auto' && (looksLikeNotebookDat(bytes) || looksLikeNotebookDef(bytes)))) {
    return looksLikeNotebookDef(bytes) && !looksLikeNotebookDat(bytes)
      ? parseNotebookDb({ def: bytes }, options)
      : parseNotebookDb({ dat: bytes }, options);
  }
  if (format === 'salvage' || (format === 'auto' && isProbablyBinary(bytes))) {
    return parseSalvage(bytes, options);
  }
  const text = decodeBytes(bytes, encoding);
  if (format === 'json' || (format === 'auto' && /^\s*[[{]/.test(text))) {
    try {
      return parseJson(text);
    } catch (e) {
      if (format === 'json') throw e;
    }
  }
  if (format === 'tagged' || (format === 'auto' && detectTagged(text))) return parseTagged(text);
  return parseDelimited(text, options);
}
