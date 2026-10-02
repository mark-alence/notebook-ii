// Print forms: a text template filled in once per record.
//
//   {Field}        the field's text. Long or multi-line text wraps and lines
//                  up under where the placeholder starts.
//   {#}            the record's position in the printout (1, 2, 3 ...)
//   {Date}         today's date (unless the database has a field called Date)
//   [[ ... ]]      a line that is left out when every field in it is empty

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

export function renderRecord(template, record, fields, { index = 1, width = 76 } = {}) {
  const value = (name) => {
    const key = fields.find((f) => f.toLowerCase() === name.trim().toLowerCase());
    if (key) return record.values[key] ?? '';
    if (name === '#') return String(index);
    if (name.toLowerCase() === 'date') return new Date().toLocaleDateString();
    return `{${name}}`;
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

export function renderReport(form, records, fields, { title = '' } = {}) {
  const body = records.map((r, i) => renderRecord(form.template, r, fields, { index: i + 1, width: form.width }));
  const head = title ? [title, '='.repeat(Math.min(title.length, form.width)), ''] : [];
  return [...head, body.join('\n\n')].join('\n') + '\n';
}
