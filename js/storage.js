// Stacks are kept in this browser's local storage. Every change is saved
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
  if (!raw) throw new Error('That stack is no longer in this browser');
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

// Desktop app: the folders worked in lately (newest first) and the one the
// start screen shows ('' before the first is chosen).
const FOLDERS = 'nb2:folders';
const FOLDER = 'nb2:folder';

export function listFolders() {
  try {
    return JSON.parse(localStorage.getItem(FOLDERS)) ?? [];
  } catch {
    return [];
  }
}

export function addFolder(path) {
  try {
    localStorage.setItem(FOLDERS, JSON.stringify([path, ...listFolders().filter((p) => p !== path)].slice(0, 20)));
  } catch {
    // The list is a convenience; the folder itself is on disk.
  }
}

export function currentFolder() {
  try {
    const f = localStorage.getItem(FOLDER) ?? '';
    return listFolders().includes(f) ? f : '';
  } catch {
    return '';
  }
}

export function setCurrentFolder(path) {
  try {
    localStorage.setItem(FOLDER, path);
  } catch {
    // Used for this visit only.
  }
}
