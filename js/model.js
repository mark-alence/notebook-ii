import { upgradeForm } from './printform.js';

// A Notebook II-style database: named fields, variable-length records.
// Every field of every record is free text of any length; the program never
// interprets it. A field also carries a few display settings:
//   copy   copied from the previous record by F5 (see copiesFromPrevious)
//   lines  how many lines it shows when a record opens (see fieldLines)
//   list   shown as a column in the list of records (see shownInList)
// Each record keeps its id (which is also the order it was entered in) and
// when it was created and last changed.

// Starting layouts offered for a new notebook. Fields can be changed later.
export const LAYOUTS = [
  { id: 'research', name: 'Research notes', fields: [
    { name: 'Author', copy: true }, { name: 'Title', copy: true }, { name: 'Year', copy: true },
    { name: 'Keywords', copy: false }, { name: 'Notes', copy: false, lines: 10 }] },
  { id: 'archive', name: 'Archive notes', fields: [
    { name: 'Header', copy: false }, { name: 'Note', copy: false, lines: 10 },
    { name: 'Citation', copy: true }, { name: 'Date', copy: false }] },
  { id: 'sources', name: 'Archive sources', fields: [
    { name: 'Country', copy: true }, { name: 'Archive', copy: true }, { name: 'Reference', copy: true },
    { name: 'Document', copy: false, lines: 10 }, { name: 'Keywords', copy: false }, { name: 'Date', copy: false }] },
  { id: 'blank', name: 'One field to start with', fields: [{ name: 'Text', copy: false, lines: 10 }] },
];

// fieldNames: names, or { name, copy, lines, list } objects.
export function createDatabase(name, fieldNames = ['Text']) {
  const fields = fieldNames.map((f) => (typeof f === 'string' ? { name: f } : { ...f }));
  return {
    name,
    fields,
    records: [],
    nextId: 1,
    printForms: [defaultPrintForm(fields.map((f) => f.name))],
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  };
}

export function defaultPrintForm(fieldNames) {
  const width = Math.max(...fieldNames.map((n) => n.length), 4);
  const lines = fieldNames.map((n) => `[[${n.padEnd(width)} : {${n}}]]`);
  return { name: 'Standard', width: 76, template: lines.join('\n'), header: '', footer: '', textPages: false, pageLines: 66 };
}

function touch(db) {
  db.modified = new Date().toISOString();
}

export function fieldNames(db) {
  return db.fields.map((f) => f.name);
}

export function addRecord(db, values = {}) {
  const now = new Date().toISOString();
  const rec = { id: db.nextId++, created: now, modified: now, values: {} };
  for (const f of db.fields) rec.values[f.name] = values[f.name] ?? '';
  db.records.push(rec);
  touch(db);
  return rec;
}

export function updateRecord(db, id, values) {
  const rec = db.records.find((r) => r.id === id);
  if (!rec) throw new Error(`No record ${id}`);
  for (const f of db.fields) if (f.name in values) rec.values[f.name] = values[f.name];
  touchRecord(db, rec);
  return rec;
}

export function touchRecord(db, rec) {
  rec.modified = new Date().toISOString();
  touch(db);
}

export function deleteRecords(db, ids) {
  const gone = new Set(ids);
  db.records = db.records.filter((r) => !gone.has(r.id));
  touch(db);
}

// Marks: a hand-picked set of records (M), kept with the notebook. Marking
// does not count as changing the record.
export function setMarked(db, records, on) {
  let n = 0;
  for (const r of records) {
    if (!!r.marked === on) continue;
    if (on) r.marked = true;
    else delete r.marked;
    n++;
  }
  if (n) touch(db);
  return n;
}

export function markedRecords(db) {
  return db.records.filter((r) => r.marked);
}

export function addField(db, name) {
  name = name.trim();
  if (!name) throw new Error('Field name is empty');
  if (db.fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`There is already a field called ${name}`);
  }
  db.fields.push({ name });
  for (const r of db.records) r.values[name] = '';
  touch(db);
}

export function renameField(db, oldName, newName) {
  newName = newName.trim();
  if (!newName) throw new Error('Field name is empty');
  if (oldName === newName) return;
  if (db.fields.some((f) => f.name.toLowerCase() === newName.toLowerCase() && f.name !== oldName)) {
    throw new Error(`There is already a field called ${newName}`);
  }
  const field = db.fields.find((f) => f.name === oldName);
  if (!field) throw new Error(`No field called ${oldName}`);
  field.name = newName;
  for (const r of db.records) {
    r.values[newName] = r.values[oldName] ?? '';
    delete r.values[oldName];
  }
  for (const k of db.sortKeys ?? []) if (k.field === oldName) k.field = newName;
  for (const form of db.printForms) {
    const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    form.template = form.template.replace(new RegExp(`\\{${esc}(:\\d+)?\\}`, 'g'), (_, w) => `{${newName}${w ?? ''}}`);
  }
  touch(db);
}

export function deleteField(db, name) {
  if (db.fields.length === 1) throw new Error('A database needs at least one field');
  db.fields = db.fields.filter((f) => f.name !== name);
  if (db.sortKeys) db.sortKeys = db.sortKeys.filter((k) => k.field !== name);
  for (const r of db.records) delete r.values[name];
  touch(db);
}

export function moveField(db, name, delta) {
  const i = db.fields.findIndex((f) => f.name === name);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= db.fields.length) return;
  [db.fields[i], db.fields[j]] = [db.fields[j], db.fields[i]];
  touch(db);
}

// Copying from the previous record (F5 in the editor) fills in the fields that
// describe the source, such as Author, Title and Year, and leaves the note
// itself alone. Each field can be switched on or off in Fields (F8); until it
// is, fields whose names sound like notes, pages or keywords are left out.
const NOT_COPIED = /note|comment|text|abstract|summar|quot|excerpt|remark|page|keyword|tag|subject|categor|topic/i;

export function copiesFromPrevious(field) {
  return field.copy ?? !NOT_COPIED.test(field.name);
}

export function setFieldCopy(db, name, copy) {
  setFieldOption(db, name, 'copy', !!copy);
}

// Long-text fields open taller; any field can be set from 1 to 40 lines.
const LONG = /note|comment|text|abstract|summar|document|excerpt|quot|remark|transcri|description/i;

export function fieldLines(field) {
  return field.lines ?? (LONG.test(field.name) ? 8 : 1);
}

// Until chosen, the list shows the first four fields.
export function shownInList(db, field) {
  return field.list ?? db.fields.indexOf(field) < 4;
}

export function setFieldOption(db, name, key, value) {
  const field = db.fields.find((f) => f.name === name);
  if (!field) throw new Error(`No field called ${name}`);
  if (key === 'lines') value = Math.max(1, Math.min(40, Math.round(+value) || 1));
  if (key === 'list' && !value && !db.fields.some((f) => f !== field && shownInList(db, f))) {
    throw new Error('The list needs at least one field');
  }
  if (key === 'list') db.fields.forEach((f) => { f.list = shownInList(db, f); });
  field[key] = value;
  touch(db);
}

// values: the record being edited, { field: text }. Copies from the record
// `from` into the copied fields that are still blank, or into the one field
// `only` whatever it holds. Returns the names of the fields filled in.
// Fields that copying would change from text already there to other text.
export function copyClashes(db, from, values, only = null) {
  if (!from) return [];
  const targets = only ? db.fields.filter((f) => f.name === only) : db.fields.filter(copiesFromPrevious);
  return targets.map((f) => f.name).filter((name) => {
    const v = from.values[name] ?? '';
    return v.trim() && (values[name] ?? '').trim() && v !== values[name];
  });
}

// Copy into values (only one field, or the "Copy with F5" fields); text
// already there is kept unless overwrite is set (the default for one field).
export function carryOver(db, from, values, only = null, { overwrite = !!only } = {}) {
  const copied = [];
  if (!from) return copied;
  const targets = only ? db.fields.filter((f) => f.name === only) : db.fields.filter(copiesFromPrevious);
  for (const { name } of targets) {
    const v = from.values[name] ?? '';
    if (!v.trim() || v === values[name]) continue;
    if (!overwrite && (values[name] ?? '').trim()) continue;
    values[name] = v;
    copied.push(name);
  }
  return copied;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// keys: [{ field, descending }]. Empty values always sort last; ties keep
// the order the records were entered in (newest first unless told otherwise).
export function sortRecords(records, keys, { newestFirst = false } = {}) {
  return [...records].sort((a, b) => {
    for (const { field, descending } of keys) {
      const x = (a.values[field] ?? '').trim();
      const y = (b.values[field] ?? '').trim();
      if (!x && !y) continue;
      if (!x) return 1;
      if (!y) return -1;
      const c = collator.compare(x, y);
      if (c) return descending ? -c : c;
    }
    return newestFirst ? b.id - a.id : a.id - b.id;
  });
}

// The list's order: by the sort fields if there are any, otherwise by when the
// records were made. db.order is 'newest' (the default) or 'oldest'.
export function orderRecords(records, sortKeys, order = 'newest') {
  const newestFirst = order !== 'oldest';
  if (sortKeys?.length) return sortRecords(records, sortKeys, { newestFirst });
  return [...records].sort((a, b) => (newestFirst ? b.id - a.id : a.id - b.id));
}

// The record made just before this one (record ids grow as records are made).
export function previousEntered(records, rec) {
  let best = null;
  for (const r of records) if (r.id < rec.id && (!best || r.id > best.id)) best = r;
  return best;
}

// ---------- record numbers ----------
//
// Every record has a number (rec.id), given when it is made and never reused,
// shown as #127. Exports can carry it as a column called Record#, and an
// import into a new notebook gives the records those numbers back.

export const RECORD_FIELD = 'Record#';
const isRecordField = (name) => /^record\s*#$/i.test(name.trim());

// The fields and records to export, with Record# first (unless the notebook
// has a field of that name itself).
export function withRecordNumbers(fields, records) {
  if (fields.some(isRecordField)) return { fields, records };
  return {
    fields: [RECORD_FIELD, ...fields],
    records: records.map((r) => ({ ...r, values: { [RECORD_FIELD]: String(r.id), ...r.values } })),
  };
}

// An imported Record# column: the numbers, if every record has a different
// whole number there; otherwise why not.
export function recordNumbersIn(imported) {
  const field = imported.fields.find(isRecordField);
  if (!field) return null;
  const ids = imported.records.map((r) => (/^\s*#?\s*(\d+)\s*$/.exec(r[field] ?? '') || [])[1]).map((n) => (n ? +n : NaN));
  const problem = ids.some((n) => !(n > 0)) ? 'some records have no number there'
    : new Set(ids).size !== ids.length ? 'some numbers are used twice' : null;
  return { field, ids: problem ? null : ids, problem };
}

// Build a database from imported rows ({ fields, records: [ {name: value} ] }).
export function databaseFromImport(name, imported) {
  const numbers = recordNumbersIn(imported);
  // Unusable numbers stay as an ordinary field, so nothing is lost.
  const fields = numbers?.ids ? imported.fields.filter((f) => f !== numbers.field) : imported.fields;
  const db = createDatabase(name, fields.length ? fields : ['Text']);
  imported.records.forEach((values, i) => {
    const rec = addRecord(db, values);
    if (numbers?.ids) rec.id = numbers.ids[i];
  });
  if (numbers?.ids) db.nextId = Math.max(0, ...numbers.ids) + 1;
  // Print formats that came with a Notebook II database go first.
  if (imported.printForms?.length) db.printForms.unshift(...imported.printForms);
  return db;
}

// Append imported records to an existing database, adding any new fields.
// Record numbers are not carried over (they could clash with this notebook's
// own): the records get new numbers and the Record# column is dropped.
export function appendImport(db, imported, fieldMap = null) {
  const numbers = recordNumbersIn(imported);
  if (numbers?.ids) {
    fieldMap = { ...(fieldMap ?? Object.fromEntries(imported.fields.map((f) => [f, f]))), [numbers.field]: null };
  }
  for (const src of imported.fields) {
    const dest = fieldMap ? fieldMap[src] : src;
    if (dest && !db.fields.some((f) => f.name === dest)) addField(db, dest);
  }
  for (const values of imported.records) {
    const mapped = {};
    for (const [k, v] of Object.entries(values)) {
      const dest = fieldMap ? fieldMap[k] : k;
      if (dest) mapped[dest] = v;
    }
    addRecord(db, mapped);
  }
}

export function validateDatabase(db) {
  if (!db || typeof db !== 'object' || !Array.isArray(db.fields) || !Array.isArray(db.records)) {
    throw new Error('Not a Notebook database file');
  }
  db.printForms ??= [defaultPrintForm(fieldNames(db))];
  db.printForms.forEach(upgradeForm);
  db.nextId ??= Math.max(0, ...db.records.map((r) => r.id)) + 1;
  for (const r of db.records) for (const f of db.fields) r.values[f.name] ??= '';
  return db;
}
