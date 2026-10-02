// Read text files into { fields, records } so they can become a database.
//
// Notebook II kept its databases in its own files and could write them out as
// ASCII text for other programs. Its native format is not publicly documented,
// so this reads the ASCII forms it and its contemporaries produced:
//   delimited  fields split by a character (tab, comma, |, ~, ^ ...)
//   tagged     "Field: value" lines, records separated by blank or rule lines
//   json       files saved by this program
//   salvage    pulls readable text out of any binary file, as a last resort
import { decodeBytes } from './cp437.js';

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

export function detectTagged(text) {
  const lines = cleanText(text).split('\n').filter((l) => l.trim()).slice(0, 2000);
  if (lines.length < 2) return false;
  const tags = lines.map(tagOf).filter(Boolean);
  if (tags.length / lines.length < 0.4) return false;
  const distinct = new Set(tags.map((t) => t.tag.toLowerCase())).size;
  // Tags should repeat from record to record.
  return distinct <= Math.max(3, tags.length / 2);
}

export function parseTagged(text) {
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

// ---------- entry point ----------

export function importFile(bytes, { format = 'auto', encoding = 'auto', ...options } = {}) {
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
