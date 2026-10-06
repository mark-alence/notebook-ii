// Write a collection (or a selection of its records) back out as text.

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

// A readable rendering, one record after another, each field on its own:
//
//   Author:   Polly Hill
//   Year:     1963
//   Notes:
//   Long text, as many paragraphs as it has.
//
//   ------------------------------------------------------------
//
// Short one-line values sit beside their label; longer or multi-line values
// go on the lines below it. Blank fields keep their label so every record has
// the same shape. The file can be read back with Import (tagged text).
export const VERTICAL_RULE = '-'.repeat(60);

export function exportVertical(fields, records, options) {
  return (verticalBlocks(fields, records, options).join(`\n\n${VERTICAL_RULE}\n\n`) + '\n').replace(/\n/g, '\r\n');
}

// Each record's vertical text, for the file above or for a PDF.
export function verticalBlocks(fields, records, { width = 70 } = {}) {
  const pad = Math.max(...fields.map((f) => f.length)) + 2;
  return records.map((r) => {
    const out = [];
    fields.forEach((f, i) => {
      const v = (r.values[f] ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
      const label = `${f}:`;
      if (!v.includes('\n') && pad + v.length <= width) {
        out.push(v ? label.padEnd(pad) + v : label);
      } else {
        if (i && out[out.length - 1] !== '') out.push('');
        out.push(label, v);
        if (i < fields.length - 1) out.push('');
      }
    });
    return out.join('\n');
  });
}

export function exportJson(db, records = db.records) {
  return JSON.stringify({ ...db, records }, null, 2);
}

// A file name made from a collection's (or a form's) name. Letters and digits
// of any alphabet are kept, accents included (written as one character each,
// NFC, so every system shows them alike); spaces become hyphens; anything else
// is dropped, which takes care of the characters Windows forbids
// (\ / : * ? " < > |). Windows' reserved names (CON, NUL, COM1 …) get an
// underscore, and very long names are cut short.
export function safeFileName(s, fallback = 'collection') {
  let name = (s || '').normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}_\- ]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name += '_';
  return name || fallback;
}

// Every text export is UTF-8.
export function toBytes(text) {
  return new TextEncoder().encode(text);
}
