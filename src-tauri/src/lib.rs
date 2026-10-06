//! The desktop shell around the web app in ../js. It adds what a browser page
//! cannot do: native open and save dialogs, reading and writing collection files
//! on disk, a menu bar, and opening a collection file that was double-clicked.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime, State};
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
struct Filter {
    name: String,
    extensions: Vec<String>,
}

/// A collection file given on the command line (or by the file manager), handed
/// to the page once when it asks.
#[derive(Default)]
struct LaunchFile(Mutex<Option<String>>);

fn with_filters<R: Runtime>(
    mut d: tauri_plugin_dialog::FileDialogBuilder<R>,
    filters: &[Filter],
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    for f in filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        d = d.add_filter(&f.name, &exts);
    }
    d
}

fn to_string(p: tauri_plugin_dialog::FilePath) -> Option<String> {
    p.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn pick_open(app: AppHandle, title: String, filters: Vec<Filter>, directory: Option<String>) -> Option<String> {
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(dir) = directory {
        dialog = dialog.set_directory(dir);
    }
    with_filters(dialog, &filters)
        .blocking_pick_file()
        .and_then(to_string)
}

/// directory: the folder the dialog starts in (a project's exported/, say).
#[tauri::command]
async fn pick_save(
    app: AppHandle,
    title: String,
    default_name: String,
    filters: Vec<Filter>,
    directory: Option<String>,
) -> Option<String> {
    let mut dialog = app.dialog().file().set_title(title).set_file_name(default_name);
    if let Some(dir) = directory {
        dialog = dialog.set_directory(dir);
    }
    with_filters(dialog, &filters).blocking_save_file().and_then(to_string)
}

/// A project is a folder: the dialog can choose one or make a new one.
#[tauri::command]
async fn pick_folder(app: AppHandle, title: String) -> Option<String> {
    app.dialog().file().set_title(title).blocking_pick_folder().and_then(to_string)
}

#[derive(Serialize)]
struct FileEntry {
    path: String,
    file: String,
    /// When the file last changed, in milliseconds since 1970.
    modified: Option<u64>,
}

/// The collections in a project: the .3x5 (and older .nb2) files directly in
/// the folder, not in its subfolders.
#[tauri::command]
async fn list_collections(dir: String) -> Result<Vec<FileEntry>, String> {
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Could not read the folder {dir}: {e}"))?;
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
        if !path.is_file() || !matches!(ext.as_deref(), Some("3x5") | Some("nb2")) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        files.push(FileEntry {
            file: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            modified,
        });
    }
    Ok(files)
}

#[tauri::command]
async fn make_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Could not make the folder {path}: {e}"))
}

#[tauri::command]
async fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// To the system Trash / Recycle Bin, where it can still be restored.
#[tauri::command]
async fn trash_file(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("Could not move {path} to the Trash: {e}"))
}

#[tauri::command]
async fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Writes next to the target and renames over it, so the file on disk is
/// always either the old collection or the new one, never half of each.
fn write_atomic(path: &str, bytes: &[u8]) -> Result<(), String> {
    let target = PathBuf::from(path);
    let mut tmp = target.clone().into_os_string();
    tmp.push(".saving");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes)
        .and_then(|_| std::fs::rename(&tmp, &target))
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("Could not save {path}: {e}")
        })
}

#[tauri::command]
async fn write_text(path: String, text: String) -> Result<(), String> {
    write_atomic(&path, text.as_bytes())
}

#[tauri::command]
async fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    write_atomic(&path, &bytes)
}

#[tauri::command]
fn launch_file(state: State<LaunchFile>) -> Option<String> {
    state.0.lock().ok()?.take()
}

/// The menu bar. Each item sends its id to the page, which runs the command of
/// the same name; Quit too goes through the page, which saves anything still
/// waiting and then closes the window. Keys the page already handles itself (Ctrl+S, Ctrl+K ...)
/// are not given menu shortcuts, so they never run twice.
fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, key: Option<&str>| MenuItem::with_id(app, id, label, true, key);
    let sep = || PredefinedMenuItem::separator(app);

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("newdb", "New Collection…", Some("CmdOrCtrl+Shift+N"))?,
            &item("open", "Open Collection…", Some("CmdOrCtrl+O"))?,
            &sep()?,
            &item("newproject", "New Project…", None)?,
            &item("openproject", "Open Project…", None)?,
            &sep()?,
            &item("saveas", "Save Collection As…", None)?,
            &item("backup", "Back Up a Copy", None)?,
            &sep()?,
            &item("import", "Import…", None)?,
            &item("export", "Export…", None)?,
            &item("print", "Export with a Form or as PDF…", None)?,
            &sep()?,
            &item("close", "Close Collection", Some("CmdOrCtrl+W"))?,
            #[cfg(not(target_os = "macos"))]
            &sep()?,
            #[cfg(not(target_os = "macos"))]
            &item("quit", "Quit", Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &item("new", "New Record", Some("CmdOrCtrl+N"))?,
            &item("copyprev", "Copy Previous (Ctrl+D)", None)?,
            &item("copyfield", "Copy Field (Ctrl+Shift+D)", None)?,
            &item("delete", "Delete Record", None)?,
            &sep()?,
            &item("mark", "Mark or Unmark Record (M)", None)?,
            &item("markall", "Mark All Records Found", None)?,
            &item("clearmarks", "Clear All Marks (Shift+M)", None)?,
            &item("delmarked", "Delete Marked Records…", None)?,
            &sep()?,
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let search = Submenu::with_items(
        app,
        "Search",
        true,
        &[
            &item("find", "Find (/)", None)?,
            &item("all", "Show All Records", None)?,
            &item("showmarked", "Show Marked Records", None)?,
            &item("sort", "Sort…", None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("fields", "Fields…", None)?,
            &item("appearance", "Appearance…", None)?,
            &item("theme", "Light, Dark or Retro", None)?,
            &item("palette", "All Commands…", None)?,
        ],
    )?;
    let help = Submenu::with_items(app, "Help", true, &[&item("help", "ThreeByFive Help", None)?])?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "ThreeByFive",
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &sep()?,
                &PredefinedMenuItem::hide(app, None)?,
                &item("quit", "Quit ThreeByFive", Some("CmdOrCtrl+Q"))?,
            ],
        )?;
        return Menu::with_items(app, &[&app_menu, &file, &edit, &search, &view, &help]);
    }
    #[cfg(not(target_os = "macos"))]
    Menu::with_items(app, &[&file, &edit, &search, &view, &help])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch = std::env::args().skip(1).find(|a| !a.starts_with('-'));
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(LaunchFile(Mutex::new(launch)))
        .menu(menu)
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.as_str());
        })
        .invoke_handler(tauri::generate_handler![
            pick_open, pick_save, pick_folder, list_collections, make_dir, path_exists, trash_file,
            read_text, write_text, write_bytes, launch_file
        ])
        .build(tauri::generate_context!())
        .expect("error while starting ThreeByFive");

    app.run(|_app, _event| {
        // macOS hands a double-clicked file over as an event, not an argument.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path = path.to_string_lossy().into_owned();
                    if let Some(state) = _app.try_state::<LaunchFile>() {
                        if let Ok(mut slot) = state.0.lock() {
                            *slot = Some(path.clone());
                        }
                    }
                    let _ = _app.emit("open-file", path);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::async_runtime::block_on;

    #[test]
    fn project_folder_commands() {
        let dir = std::env::temp_dir().join(format!("threebyfive-test-{}", std::process::id()));
        let sub = dir.join("backup");
        block_on(make_dir(sub.to_string_lossy().into())).unwrap();
        assert!(block_on(path_exists(sub.to_string_lossy().into())));
        for f in ["b.3x5", "a.NB2", "notes.txt"] {
            std::fs::write(dir.join(f), "{}").unwrap();
        }
        std::fs::write(sub.join("old.3x5"), "{}").unwrap();
        let mut files: Vec<String> = block_on(list_collections(dir.to_string_lossy().into())).unwrap().into_iter().map(|e| e.file).collect();
        files.sort();
        assert_eq!(files, ["a.NB2", "b.3x5"]); // only the top of the folder, only collections
        let gone = dir.join("b.3x5");
        block_on(trash_file(gone.to_string_lossy().into())).unwrap();
        assert!(!gone.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
