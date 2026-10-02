// A Notebook II-style database: named fields, variable-length records.
// Every field of every record is free text of any length.

export function createDatabase(name, fieldNames = ['Text']) {
  return {
    name,
    fields: fieldNames.map((n) => ({ name: n })),
    records: [],
    nextId: 1,
    printForms: [defaultPrintForm(fieldNames)],
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  };
}

export function defaultPrintForm(fieldNames) {
  const width = Math.max(...fieldNames.map((n) => n.length), 4);
  const lines = fieldNames.map((n) => `[[${n.padEnd(width)} : {${n}}]]`);
  return { name: 'Standard', width: 76, template: lines.join('\n') };
}

function touch(db) {
  db.modified = new Date().toISOString();
}

export function fieldNames(db) {
  return db.fields.map((f) => f.name);
}

export function addRecord(db, values = {}) {
  const rec = { id: db.nextId++, values: {} };
  for (const f of db.fields) rec.values[f.name] = values[f.name] ?? '';
  db.records.push(rec);
  touch(db);
  return rec;
}

export function updateRecord(db, id, values) {
  const rec = db.records.find((r) => r.id === id);
  if (!rec) throw new Error(`No record ${id}`);
  for (const f of db.fields) if (f.name in values) rec.values[f.name] = values[f.name];
  touch(db);
  return rec;
}

export function deleteRecords(db, ids) {
  const gone = new Set(ids);
  db.records = db.records.filter((r) => !gone.has(r.id));
  touch(db);
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
  for (const form of db.printForms) {
    form.template = form.template.split(`{${oldName}}`).join(`{${newName}}`);
  }
  touch(db);
}

export function deleteField(db, name) {
  if (db.fields.length === 1) throw new Error('A database needs at least one field');
  db.fields = db.fields.filter((f) => f.name !== name);
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

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// keys: [{ field, descending }]. Empty values always sort last.
export function sortRecords(records, keys) {
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
    return a.id - b.id;
  });
}

// Build a database from imported rows ({ fields, records: [ {name: value} ] }).
export function databaseFromImport(name, imported) {
  const db = createDatabase(name, imported.fields.length ? imported.fields : ['Text']);
  for (const values of imported.records) addRecord(db, values);
  return db;
}

// Append imported records to an existing database, adding any new fields.
export function appendImport(db, imported, fieldMap = null) {
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
  db.nextId ??= Math.max(0, ...db.records.map((r) => r.id)) + 1;
  for (const r of db.records) for (const f of db.fields) r.values[f.name] ??= '';
  return db;
}
