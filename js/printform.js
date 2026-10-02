// Print forms: a text template filled in once per record.
//
//   {Field}        the field's text. Long or multi-line text wraps and lines
//                  up under where the placeholder starts.
//   {Field:20}     exactly 20 characters of the field, cut off or padded with
//                  spaces (Notebook II's "fixed" fields)
//   {#}            the record's position in the printout (1, 2, 3 ...)
//   {Date} {Time}  today's date and the time (unless the database has a field
//                  with that name)
//   [[ ... ]]      a line that is left out when every field in it is empty
//
// A form may also have a page header and footer, as Notebook II's custom
// formats did. Then the printout is cut into pages of form.pageLines lines
// (default 66) separated by form feeds, and {Page} is the page number.

const PLACEHOLDER = /\{([^{}]+)\}/g;

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

const fieldKey = (fields, name) => fields.find((f) => f.toLowerCase() === name.trim().toLowerCase());

function clock(name, now) {
  if (name.toLowerCase() === 'date') return now.toLocaleDateString();
  if (name.toLowerCase() === 'time') return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return null;
}

export function renderRecord(template, record, fields, { index = 1, width = 76, now = new Date() } = {}) {
  const value = (name) => {
    const key = fieldKey(fields, name);
    if (key) return record.values[key] ?? '';
    const fixed = /^(.*):(\d+)$/.exec(name);
    const fixedKey = fixed && fieldKey(fields, fixed[1]);
    if (fixedKey) return (record.values[fixedKey] ?? '').replace(/\s*\n\s*/g, ' ').slice(0, +fixed[2]).padEnd(+fixed[2]);
    if (name === '#') return String(index);
    return clock(name, now) ?? `{${name}}`;
  };
  const out = [];
  for (let raw of template.split('\n')) {
    const optional = /^\s*\[\[.*\]\]\s*$/.test(raw);
    if (optional) {
      raw = raw.replace(/^(\s*)\[\[/, '$1').replace(/\]\]\s*$/, '');
      const names = [...raw.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => fields.some((f) => f.toLowerCase() === n.trim().toLowerCase()));
      if (names.length && names.every((n) => !value(n).trim())) continue;
    }
    const first = raw.search(PLACEHOLDER);
    const indent = first > 0 && first < width / 2 ? first : 0;
    const filled = raw.replace(PLACEHOLDER, (_, n) => value(n).replace(/\n/g, '\n' + ' '.repeat(indent)));
    for (const l of filled.split('\n')) out.push(...wrapLine(l.trimEnd(), width, indent));
  }
  return out.join('\n');
}

export function renderReport(form, records, fields, { title = '', now = new Date() } = {}) {
  const body = records.map((r, i) => renderRecord(form.template, r, fields, { index: i + 1, width: form.width, now }));
  if (form.header?.trim() || form.footer?.trim()) return paginate(form, body, now);
  const head = title ? [title, '='.repeat(Math.min(title.length, form.width)), ''] : [];
  return [...head, body.join('\n\n')].join('\n') + '\n';
}

// Lay records out on pages with the form's header at the top and footer at the
// bottom. A record is not split across pages unless it is longer than a page.
function paginate(form, blocks, now) {
  const pageLines = form.pageLines || 66;
  const fill = (text, page) => (text ?? '').replace(/\{(page|date|time)\}/gi, (m, n) => (n.toLowerCase() === 'page' ? String(page) : clock(n, now)));
  const head = form.header?.trim() ? 2 : 0;
  const foot = form.footer?.trim() ? 2 : 0;
  const room = Math.max(5, pageLines - head - foot);
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
  return pages.map((lines, i) => {
    const out = [];
    if (head) out.push(fill(form.header, i + 1), '');
    out.push(...lines);
    if (foot) {
      while (out.length < pageLines - 1) out.push('');
      out.push(fill(form.footer, i + 1));
    }
    return out.join('\n') + '\n';
  }).join('\f');
}
