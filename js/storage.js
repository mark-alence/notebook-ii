// Collections are kept in this browser's local storage. Every change is saved
// right away; Export > ThreeByFive file makes a copy you can keep elsewhere.
import { validateDatabase } from './model.js';

const INDEX = 'nb2:index';
const PREFIX = 'nb2:db:';

export function listSaved() {
  try {
    return JSON.parse(localStorage.getItem(INDEX)) ?? [];
  } catch {
    return [];
  }
}

function writeIndex(list) {
  localStorage.setItem(INDEX, JSON.stringify(list));
}

export function newKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Returns false when the browser refuses (storage full, private window ...).
export function saveDb(key, db) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(db));
    const list = listSaved().filter((d) => d.key !== key);
    list.unshift({ key, name: db.name, records: db.records.length, modified: db.modified });
    writeIndex(list);
    return true;
  } catch {
    return false;
  }
}

export function loadDb(key) {
  const raw = localStorage.getItem(PREFIX + key);
  if (!raw) throw new Error('That collection is no longer in this browser');
  return validateDatabase(JSON.parse(raw));
}

export function removeDb(key) {
  try {
    localStorage.removeItem(PREFIX + key);
    writeIndex(listSaved().filter((d) => d.key !== key));
  } catch {
    // nothing to do
  }
}

// Desktop app: collection files opened recently, newest first. Only the list is
// kept here; the collections themselves are files on disk.
const RECENT = 'nb2:recent';

export function listRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT)) ?? [];
  } catch {
    return [];
  }
}

export function addRecent(entry) {
  try {
    const list = listRecent().filter((r) => r.path !== entry.path);
    list.unshift(entry);
    localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 20)));
  } catch {
    // The list is a convenience; the file itself is saved.
  }
}

export function removeRecent(path) {
  try {
    localStorage.setItem(RECENT, JSON.stringify(listRecent().filter((r) => r.path !== path)));
  } catch {
    // nothing to do
  }
}
