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
    list.unshift({ key, name: db.name, records: db.records.length, modified: db.modified, project: db.project ?? '' });
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

// ---------- projects ----------
//
// A project is a name that collections are grouped under (db.project; '' is
// "Unfiled"). The names are listed here too, so a project can exist before
// any collection is in it. The home screen shows one project at a time, or
// all of them ('*').

const PROJECTS = 'nb2:projects';
const CURRENT = 'nb2:project';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function storedProjects() {
  try {
    const list = JSON.parse(localStorage.getItem(PROJECTS));
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string' && p) : [];
  } catch {
    return [];
  }
}

function writeProjects(list) {
  try {
    localStorage.setItem(PROJECTS, JSON.stringify([...new Set(list)].sort(collator.compare)));
  } catch {
    // nothing to do
  }
}

// Every project name: those made, and those collections are in.
export function listProjects() {
  const names = [...storedProjects(), ...listSaved().map((d) => d.project), ...listRecent().map((d) => d.project)].filter(Boolean);
  return [...new Set(names)].sort(collator.compare);
}

export function addProject(name) {
  name = name.trim();
  if (!name) throw new Error('A project needs a name');
  if (listProjects().some((p) => p.toLowerCase() === name.toLowerCase() && p !== name)) throw new Error(`There is already a project called ${name}`);
  writeProjects([...storedProjects(), name]);
  return name;
}

// Moves every collection kept in the browser from one project to another
// ('' for Unfiled); collection files in the desktop app change when opened.
function moveCollections(from, to) {
  for (const d of listSaved()) {
    if ((d.project ?? '') !== from) continue;
    try {
      const db = loadDb(d.key);
      db.project = to;
      saveDb(d.key, db);
    } catch {
      // A collection that cannot be read stays where it was.
    }
  }
}

export function renameProject(from, to) {
  to = to.trim();
  if (!to) throw new Error('A project needs a name');
  if (to !== from && listProjects().some((p) => p.toLowerCase() === to.toLowerCase() && p.toLowerCase() !== from.toLowerCase())) throw new Error(`There is already a project called ${to}`);
  writeProjects([...storedProjects().filter((p) => p !== from), to]);
  moveCollections(from, to);
  if (currentProject() === from) setCurrentProject(to);
  return to;
}

// The project's collections become Unfiled; none is deleted.
export function removeProject(name) {
  writeProjects(storedProjects().filter((p) => p !== name));
  moveCollections(name, '');
  if (currentProject() === name) setCurrentProject('*');
}

export function currentProject() {
  try {
    return localStorage.getItem(CURRENT) ?? '*';
  } catch {
    return '*';
  }
}

export function setCurrentProject(name) {
  try {
    localStorage.setItem(CURRENT, name);
  } catch {
    // Used for this visit only.
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

// Desktop app: a project is a folder, and its collections are the files in it.
// Kept here: the project folders used recently (newest first) and the one on
// the start screen ('' for none).
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

// Only forgets the folder; nothing on disk changes.
export function removeFolder(path) {
  try {
    localStorage.setItem(FOLDERS, JSON.stringify(listFolders().filter((p) => p !== path)));
    if (currentFolder() === path) setCurrentFolder('');
  } catch {
    // nothing to do
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
