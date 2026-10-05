// Custom forms: a text template filled in once per record, used by Export to
// write a text file or a PDF.
//
// In the template (once per record):
//   {Field}        the field's text. Long or multi-line text wraps and lines
//                  up under where the placeholder starts. A name that is not a
//                  field is left showing, so a misspelling is easy to spot.
//   {Field:20}     exactly 20 characters of the field, cut off or padded with
//                  spaces (Notebook II's "fixed" fields)
//   {#}            the record's position in the output (1, 2, 3 ...)
//   {Record#}      the record's own number, as 127 (also {Record#:6}), the
//                  same as the Record# column of an export. A field of the
//                  notebook's own called Record# comes first.
//   {#id}          the record's own number, as #127
//   [[ ... ]]      a line that is left out when every field in it is empty
//
// In the header and footer (once per page):
//   {@page} {@pages}   this page's number, and how many pages there are
//   {@date} {@time}    today's date and the time
// The @ keeps them apart from fields, which may well be called Date or Page.
//
// A PDF always has pages. A text file is one long page unless the form's
// textPages is set: then it is cut into pages of form.pageLines lines
// (default 66) separated by form feeds, as Notebook II printed them.

const PLACEHOLDER = /\{([^{}]+)\}/g;
const PAGE_TOKEN = /\{@(page|pages|date|time)\}/gi;

export function wrapLine(text, width, indent = 0) {
  if (width <= 0 || text.length <= width) return [text];
  const out = [];
  let line = text;
  const pad = ' '.repeat(indent);
  while (line.length > width) {
    let cut = line.lastIndexOf(' ', width);
    if (cut <= indent) cut = width;
    out.push(line.slice(0, cut).trimEnd());
    line = pad + line.slice(cut).trimStart();
  }
  out.push(line);
  return out;
}

const RECORD_NO = /^\s*record\s*#\s*$/i;
const fieldKey = (fields, name) => fields.find((f) => f.toLowerCase() === name.trim().toLowerCase());

export function fillPageText(text, { page = 1, pages = 1, now = new Date() } = {}) {
  return (text ?? '').replace(PAGE_TOKEN, (_, n) => {
    switch (n.toLowerCase()) {
      case 'page': return String(page);
      case 'pages': return String(pages);
      case 'date': return now.toLocaleDateString();
      default: return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  });
}

export function renderRecord(template, record, fields, { index = 1, width = 76 } = {}) {
  const value = (name) => {
    const key = fieldKey(fields, name);
    if (key) return record.values[key] ?? '';
    const fixed = /^(.*):(\d+)$/.exec(name);
    const fixedKey = fixed && fieldKey(fields, fixed[1]);
    if (fixedKey) return (record.values[fixedKey] ?? '').replace(/\s*\n\s*/g, ' ').slice(0, +fixed[2]).padEnd(+fixed[2]);
    if (RECORD_NO.test(name)) return record.id ? String(record.id) : '';
    if (fixed && RECORD_NO.test(fixed[1])) return (record.id ? String(record.id) : '').slice(0, +fixed[2]).padEnd(+fixed[2]);
    if (name === '#') return String(index);
    if (name.trim().toLowerCase() === '#id') return record.id ? `#${record.id}` : '';
    return `{${name}}`;
  };
  const out = [];
  for (let raw of template.split('\n')) {
    const optional = /^\s*\[\[.*\]\]\s*$/.test(raw);
    if (optional) {
      raw = raw.replace(/^(\s*)\[\[/, '$1').replace(/\]\]\s*$/, '');
      const names = [...raw.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => fieldKey(fields, n.replace(/:\d+$/, '')));
      if (names.length && names.every((n) => !value(n).trim())) continue;
    }
    const first = raw.search(PLACEHOLDER);
    const indent = first > 0 && first < width / 2 ? first : 0;
    const filled = raw.replace(PLACEHOLDER, (_, n) => value(n).replace(/\n/g, '\n' + ' '.repeat(indent)));
    for (const l of filled.split('\n')) out.push(...wrapLine(l.trimEnd(), width, indent));
  }
  return out.join('\n');
}

// Each record's text, ready to lay out.
export function renderBlocks(form, records, fields, { width = form.width } = {}) {
  return records.map((r, i) => renderRecord(form.template, r, fields, { index: i + 1, width }));
}

// Split record texts into pages of at most `room` lines, with a blank line
// between records. A record is not split across pages unless it is longer
// than a page.
export function paginateLines(blocks, room) {
  room = Math.max(1, room);
  const pages = [[]];
  for (const block of blocks) {
    const lines = block.split('\n');
    let page = pages[pages.length - 1];
    const need = lines.length + (page.length ? 1 : 0);
    if (page.length && page.length + need > room) pages.push((page = []));
    if (page.length) page.push('');
    for (const l of lines) {
      if (page.length >= room) pages.push((page = []));
      page.push(l);
    }
  }
  return pages;
}

// The text-file output of a form.
export function renderReport(form, records, fields, { title = '', now = new Date() } = {}) {
  const blocks = renderBlocks(form, records, fields);
  const header = form.header?.trim() ? form.header : '';
  const footer = form.footer?.trim() ? form.footer : '';
  if (form.textPages) return pagedText(form, blocks, header, footer, now);
  const head = header ? [fillPageText(header, { now }), ''] : title ? [title, '='.repeat(Math.min(title.length, form.width)), ''] : [];
  const foot = footer ? ['', fillPageText(footer, { now })] : [];
  return [...head, blocks.join('\n\n'), ...foot].join('\n') + '\n';
}

function pagedText(form, blocks, header, footer, now) {
  const pageLines = form.pageLines || 66;
  const head = header ? 2 : 0;
  const foot = footer ? 2 : 0;
  const pages = paginateLines(blocks, Math.max(5, pageLines - head - foot));
  return pages.map((lines, i) => {
    const at = { page: i + 1, pages: pages.length, now };
    const out = [];
    if (head) out.push(fillPageText(header, at), '');
    out.push(...lines);
    if (foot) {
      while (out.length < pageLines - 1) out.push('');
      out.push(fillPageText(footer, at));
    }
    return out.join('\n') + '\n';
  }).join('\f');
}

// Forms saved before the @ names used {Page}, {Date} and {Time} in headers
// and footers, and always cut text into pages when they had either.
export function upgradeForm(form) {
  if (form.textPages !== undefined) return form;
  const old = (t) => (t ?? '').replace(/\{(page|date|time)\}/gi, (_, n) => `{@${n.toLowerCase()}}`);
  const paged = !!(form.header?.trim() || form.footer?.trim());
  return Object.assign(form, { header: old(form.header), footer: old(form.footer), textPages: paged });
}
