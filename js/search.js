// Retrieval: find records by any word, in one field or anywhere.
//
//   smith                 records with "smith" anywhere in any field, also
//                         inside longer words (smithy, Goldsmith); "smith"
//                         in quotes matches only the whole word
//   author:smith          only in the Author field
//   "civil war"           the phrase, whole words, adjacent
//   hist*                 any word starting with "hist"
//   smith AND jones       both (AND is implied between terms: smith jones)
//   smith OR jones        either
//   NOT smith  / -smith   records without it
//   (a OR b) AND c        grouping
//   "date of birth":1850  quote a field name that contains spaces
//   author:               an empty term after a field name finds records where
//                         that field is blank; author:* finds non-blank ones
//   title=the             the field begins with the text (Notebook II's
//                         "begins with"; -title=the is "not begins with")
//   year>1980  author<m   the field begins with something later / earlier in
//   year>=1980 year<=1985 alphabetical (or numerical) order, or the same
//   /colou?r/             a regular expression, anywhere in any field; ignores
//                         capitals unless the flag c is added (/Smith/c)
//   citation:/^CO 9\d/    a regular expression in one field

export function tokenizeQuery(q) {
  const tokens = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { tokens.push({ type: c }); i++; continue; }
    let neg = false;
    if (c === '-' && i + 1 < q.length && !/\s/.test(q[i + 1])) { neg = true; i++; }
    let field = null;
    let text;
    let phrase = false;
    // /pattern/ or field:/pattern/ — read whole, since a pattern may hold
    // spaces, brackets and quotes.
    const fieldRegex = /^([^\s()"/:<>=]+):\//.exec(q.slice(i));
    if (q[i] === '/' || fieldRegex) {
      if (fieldRegex) { field = fieldRegex[1]; i += field.length + 1; }
      const r = readRegex(q, i);
      i = r.i;
      if (neg) tokens.push({ type: 'NOT' });
      tokens.push({ type: 'term', field, text: r.source, phrase: false, op: ':', regex: { source: r.source, flags: r.flags } });
      continue;
    }
    if (q[i] === '"') {
      const end = q.indexOf('"', i + 1);
      text = q.slice(i + 1, end < 0 ? q.length : end);
      i = end < 0 ? q.length : end + 1;
      phrase = true;
    } else {
      const m = /^[^\s()"]+/.exec(q.slice(i));
      text = m ? m[0] : '';
      i += text.length;
    }
    // field:term, field=term, field>term ...
    let op = ':';
    let regex = null;
    const quotedOp = phrase ? FIELD_OP.exec(q.slice(i)) : null;
    const plain = phrase ? null : /^([^:<>=]+)(>=|<=|>|<|=|:)(.*)$/.exec(text);
    if (quotedOp) {
      field = text; op = quotedOp[1]; i += op.length; phrase = false;
      ({ text, phrase, i, regex = null } = readTerm(q, i));
    } else if (plain) {
      [, field, op] = plain;
      if (plain[3]) text = plain[3];
      else ({ text, phrase, i } = readTerm(q, i));
    }
    if (!phrase && field === null && /^(AND|OR|NOT)$/.test(text)) {
      tokens.push({ type: text });
      continue;
    }
    if (neg) tokens.push({ type: 'NOT' });
    tokens.push({ type: 'term', field, text, phrase, op, ...(regex ? { regex } : {}) });
  }
  return tokens;
}

const FIELD_OP = /^(>=|<=|>|<|=|:)/;

// q[i] is the opening /. The pattern runs to the next / that is not escaped
// (\/) or inside [ ]; flags follow it.
function readRegex(q, i) {
  let j = i + 1;
  let inClass = false;
  for (; j < q.length; j++) {
    const ch = q[j];
    if (ch === '\\') { j++; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) break;
  }
  if (j >= q.length) throw new Error('A pattern that starts with / needs a / at the end too');
  const flags = /^[a-z]*/i.exec(q.slice(j + 1))[0];
  if (/[^imsuc]/.test(flags)) throw new Error(`Unknown pattern flag in /…/${flags}: use i, m, s, u or c (match capitals exactly)`);
  return { source: q.slice(i + 1, j), flags, i: j + 1 + flags.length };
}

// Capitals are ignored unless the flags include c.
export function makeRegex(source, flags = '', extra = '') {
  let f = flags.replace(/[cg]/g, '');
  if (!flags.includes('c') && !f.includes('i')) f += 'i';
  try {
    return new RegExp(source, f + extra);
  } catch (e) {
    throw new Error(`The pattern /${source}/ does not work: ${e.message.replace(/^Invalid regular expression: \/.*\/[a-z]*: /, '')}`);
  }
}

function readTerm(q, i) {
  if (q[i] === '/') {
    const r = readRegex(q, i);
    return { text: r.source, phrase: false, i: r.i, regex: { source: r.source, flags: r.flags } };
  }
  if (q[i] === '"') {
    const end = q.indexOf('"', i + 1);
    return { text: q.slice(i + 1, end < 0 ? q.length : end), phrase: true, i: end < 0 ? q.length : end + 1 };
  }
  const m = /^[^\s()"]*/.exec(q.slice(i));
  return { text: m[0], phrase: false, i: i + m[0].length };
}

export function parseQuery(q) {
  const tokens = tokenizeQuery(q);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseOr() {
    let left = parseAnd();
    while (peek()?.type === 'OR') { next(); left = { op: 'or', left, right: parseAnd() }; }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    for (;;) {
      const t = peek();
      if (!t || t.type === 'OR' || t.type === ')') return left;
      if (t.type === 'AND') next();
      left = { op: 'and', left, right: parseNot() };
    }
  }
  function parseNot() {
    if (peek()?.type === 'NOT') { next(); return { op: 'not', arg: parseNot() }; }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = next();
    if (!t) throw new Error('The search ends too early');
    if (t.type === '(') {
      const e = parseOr();
      if (next()?.type !== ')') throw new Error('Missing )');
      return e;
    }
    if (t.type === 'term') return { op: 'term', field: t.field, text: t.text, phrase: t.phrase, compare: t.op === ':' ? null : t.op, regex: t.regex ?? null };
    throw new Error(`Unexpected ${t.type}`);
  }

  if (!tokens.length) return null;
  const tree = parseOr();
  if (pos < tokens.length) throw new Error(`Unexpected ${tokens[pos].type}`);
  return tree;
}

// Lowercase and strip accents so "Café" matches "cafe".
export function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function words(s) {
  return fold(s).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

function wordPattern(w) {
  const esc = w.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

function compileTerm(node, fields) {
  let targets = null;
  if (node.field !== null) {
    const want = fold(node.field).replace(/_/g, ' ');
    targets = fields.filter((f) => fold(f) === want);
    if (!targets.length) targets = fields.filter((f) => fold(f).startsWith(want));
    if (!targets.length) throw new Error(`No field called ${node.field}`);
  }
  if (node.regex) {
    const re = makeRegex(node.regex.source, node.regex.flags);
    return (rec) => (targets ?? fields).some((f) => re.test(rec.values[f] ?? ''));
  }
  const text = node.text.trim();
  if (node.compare) return compileCompare(node.compare, text, targets);
  if (targets && text === '') return (rec) => targets.every((f) => !(rec.values[f] ?? '').trim());
  if (targets && text === '*') return (rec) => targets.some((f) => (rec.values[f] ?? '').trim());
  // A plain term is found anywhere in the text, as Notebook II's Find did:
  // "cott" finds cotton, "96/728" finds CO 96/728.
  if (!node.phrase && !/[*?]/.test(text)) {
    const want = fold(text);
    if (!want) return () => false;
    return (rec) => (targets ?? fields).some((f) => fold(rec.values[f] ?? '').includes(want));
  }
  // Quoted words and wildcards match whole words, keeping * and ? as wildcards.
  const pats = (fold(text).match(/[\p{L}\p{N}*?]+(?:['’][\p{L}\p{N}*?]+)*/gu) ?? []).map(wordPattern);
  if (!pats.length) return () => false;
  return (rec) => {
    for (const f of targets ?? fields) {
      const ws = words(rec.values[f] ?? '');
      for (let i = 0; i + pats.length <= ws.length; i++) {
        if (pats.every((p, k) => p.test(ws[i + k]))) return true;
      }
    }
    return false;
  };
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
const leadingNumber = (s) => /^[-+]?\d+(?:\.\d+)?/.exec(s)?.[0];

// Notebook II's Select conditions, which look at how the field begins.
function compileCompare(op, text, targets) {
  if (!text) throw new Error(`Nothing to compare after ${op}`);
  const want = fold(text);
  const num = leadingNumber(want);
  const test = (value) => {
    const v = fold(value).trim();
    if (!v) return false;
    if (op === '=') return v.startsWith(want);
    let c;
    if (num !== undefined) {
      const n = leadingNumber(v);
      if (n === undefined) return false;
      c = Math.sign(+n - +num);
    } else {
      c = collator.compare(v.slice(0, want.length), want);
    }
    return op === '>' ? c > 0 : op === '<' ? c < 0 : op === '>=' ? c >= 0 : c <= 0;
  };
  return (rec) => targets.some((f) => test(rec.values[f] ?? ''));
}

export function compileQuery(q, fields) {
  const tree = parseQuery(q);
  if (!tree) return () => true;
  const build = (n) => {
    switch (n.op) {
      case 'term': return compileTerm(n, fields);
      case 'not': { const a = build(n.arg); return (r) => !a(r); }
      case 'and': { const a = build(n.left), b = build(n.right); return (r) => a(r) && b(r); }
      case 'or': { const a = build(n.left), b = build(n.right); return (r) => a(r) || b(r); }
    }
  };
  return build(tree);
}

export function search(db, q) {
  const match = compileQuery(q, db.fields.map((f) => f.name));
  return db.records.filter(match);
}

// Patterns to mark in a record for a query (ignores NOT terms and
// comparisons): each word, or the regular expression itself.
export function highlightPatterns(q) {
  try {
    const out = [];
    const walk = (n, neg) => {
      if (!n) return;
      if (n.op === 'term' && !neg && !n.compare) {
        if (n.regex) out.push(makeRegex(n.regex.source, n.regex.flags, 'g'));
        else for (const w of words(n.text.replace(/[*?]/g, ' '))) out.push(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'));
      }
      if (n.op === 'not') walk(n.arg, !neg);
      if (n.left) { walk(n.left, neg); walk(n.right, neg); }
    };
    walk(parseQuery(q), false);
    return out;
  } catch {
    return [];
  }
}

// Words to highlight for a query (ignores NOT terms).
export function highlightTerms(q) {
  try {
    const out = [];
    const walk = (n, neg) => {
      if (!n) return;
      if (n.op === 'term' && !neg && !n.compare) out.push(...words(n.text.replace(/\*/g, '')));
      if (n.op === 'not') walk(n.arg, !neg);
      if (n.left) { walk(n.left, neg); walk(n.right, neg); }
    };
    walk(parseQuery(q), false);
    return out;
  } catch {
    return [];
  }
}
