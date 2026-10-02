// Write a database (or a selection of its records) back out as text.
import { encodeCp437 } from './cp437.js';

function quoteCsv(v, delim) {
  return /["\n\r]/.test(v) || v.includes(delim) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function exportDelimited(fields, records, {
  fieldDelim = ',', recordDelim = '\r\n', header = true, quote = true, newlineMarker = '',
} = {}) {
  const cell = (v) => {
    v = v ?? '';
    if (newlineMarker) v = v.replace(/\r?\n/g, newlineMarker);
    return quote ? quoteCsv(v, fieldDelim) : v;
  };
  const rows = records.map((r) => fields.map((f) => cell(r.values[f])).join(fieldDelim));
  if (header) rows.unshift(fields.map(cell).join(fieldDelim));
  return rows.join(recordDelim) + recordDelim;
}

export function exportTagged(fields, records, { separator = '---' } = {}) {
  return records
    .map((r) =>
      fields
        .filter((f) => (r.values[f] ?? '').trim())
        .map((f) => {
          const [first, ...rest] = r.values[f].split('\n');
          return [`${f}: ${first}`, ...rest.map((l) => `  ${l}`)].join('\r\n');
        })
        .join('\r\n'),
    )
    .join(`\r\n${separator}\r\n`) + '\r\n';
}

// Notebook II's own import text (Utilities > Import, "Notebook" format):
// %Start:, a %Field:value line per field, %End:. Lines after the first
// continue the field. Notebook II allowed 50 fields with 20-character names.
export function exportNotebookText(fields, records) {
  return records
    .map((r) => ['%Start:', ...fields.map((f) => `%${f}:${(r.values[f] ?? '').replace(/\r?\n/g, '\r\n')}`), '%End:'].join('\r\n'))
    .join('\r\n') + '\r\n';
}

export function exportJson(db, records = db.records) {
  return JSON.stringify({ ...db, records }, null, 2);
}

export function toBytes(text, encoding = 'utf-8') {
  return encoding === 'cp437' ? encodeCp437(text) : new TextEncoder().encode(text);
}
