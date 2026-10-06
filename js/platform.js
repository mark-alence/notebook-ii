// What differs between the web page and the desktop app (Tauri). The desktop
// app keeps each stack as a file on disk and has native file dialogs and a
// menu bar; the web page keeps stacks in browser storage and downloads
// files. Everything else in the program is the same code.
const T = globalThis.__TAURI__;
export const desktop = !!T;

const invoke = (cmd, args) => T.core.invoke(cmd, args);

// .3x5; .nb2 is the same file from before the rename to ThreeByFive.
export const NOTEBOOK_FILTERS = [{ name: 'ThreeByFive stack', extensions: ['3x5', 'nb2', 'json'] }];

// Save bytes the user asked for (an export, a backup). Web: a download.
// Desktop: a Save dialog. Returns the path or file name, or null if cancelled.
// Desktop: `directory` is where the Save dialog starts.
export async function saveBytes(name, bytes, type = 'application/octet-stream', { directory = null } = {}) {
  if (desktop) {
    const ext = /\.([^.]+)$/.exec(name)?.[1];
    const path = await invoke('pick_save', { title: 'Save', defaultName: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [], directory });
    if (!path) return null;
    await invoke('write_bytes', { path, bytes: Array.from(bytes) });
    return path;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export async function pickNotebookToOpen(directory = null) {
  return invoke('pick_open', { title: 'Open stack', filters: NOTEBOOK_FILTERS, directory });
}

export async function pickNotebookPath(name, directory = null) {
  return invoke('pick_save', { title: 'Save stack as', defaultName: `${name}.3x5`, filters: NOTEBOOK_FILTERS, directory });
}

// Desktop projects are folders: a project's stacks are the .3x5 (and
// .nb2) files at the top of its folder.
export const pickFolder = (title) => invoke('pick_folder', { title });
export const listStacks = (dir) => invoke('list_stacks', { dir });
export const makeDir = (path) => invoke('make_dir', { path });
export const pathExists = (path) => invoke('path_exists', { path });
// Moves a file to the system Trash (Recycle Bin), where it can be restored.
export const trashFile = (path) => invoke('trash_file', { path });

// Joins a folder and a name with the folder's own separator.
export function joinPath(dir, name) {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export function dirName(path) {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i <= 0 ? path.slice(0, i + 1) : path.slice(0, i);
}

export const readText = (path) => invoke('read_text', { path });

// The desktop side writes to a temporary file and renames it, so a crash or
// power cut mid-save never leaves half a stack.
export const writeText = (path, text) => invoke('write_text', { path, text });

// A stack file the app was opened with (double-clicked in the file manager).
export const launchFile = () => (desktop ? invoke('launch_file') : Promise.resolve(null));

export function onMenu(handler) {
  if (desktop) T.event.listen('menu', (e) => handler(e.payload));
}

export function onOpenFile(handler) {
  if (desktop) T.event.listen('open-file', (e) => handler(e.payload));
}

export function setTitle(text) {
  document.title = text;
  if (desktop) T.window.getCurrentWindow().setTitle(text).catch(() => {});
}

// Runs fn (which may return a promise) before the window closes.
export function beforeClose(fn) {
  if (!desktop) return;
  const win = T.window.getCurrentWindow();
  win.onCloseRequested(async (e) => {
    e.preventDefault();
    try { await fn(); } finally { await win.destroy(); }
  });
}

// Asks the window to close, so beforeClose runs first.
export function closeWindow() {
  if (desktop) return T.window.getCurrentWindow().close();
}

export function fileName(path) {
  return path.split(/[\\/]/).pop();
}
