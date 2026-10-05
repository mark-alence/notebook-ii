//! The desktop shell around the web app in ../js. It adds what a browser page
//! cannot do: native open and save dialogs, reading and writing notebook files
//! on disk, a menu bar, and opening a notebook file that was double-clicked.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Deserialize;
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

/// A notebook file given on the command line (or by the file manager), handed
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
async fn pick_open(app: AppHandle, title: String, filters: Vec<Filter>) -> Option<String> {
    with_filters(app.dialog().file().set_title(title), &filters)
        .blocking_pick_file()
        .and_then(to_string)
}

#[tauri::command]
async fn pick_save(
    app: AppHandle,
    title: String,
    default_name: String,
    filters: Vec<Filter>,
) -> Option<String> {
    with_filters(app.dialog().file().set_title(title).set_file_name(default_name), &filters)
        .blocking_save_file()
        .and_then(to_string)
}

#[tauri::command]
async fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Writes next to the target and renames over it, so the file on disk is
/// always either the old notebook or the new one, never half of each.
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
            &item("newdb", "New Notebook…", Some("CmdOrCtrl+Shift+N"))?,
            &item("open", "Open Notebook…", Some("CmdOrCtrl+O"))?,
            &item("saveas", "Save Notebook As…", None)?,
            &sep()?,
            &item("import", "Import…", None)?,
            &item("export", "Export…", None)?,
            &item("print", "Export with a Form or as PDF…", None)?,
            &sep()?,
            &item("close", "Close Notebook", Some("CmdOrCtrl+W"))?,
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
            &item("new", "New Note", Some("CmdOrCtrl+N"))?,
            &item("copyprev", "Copy Previous (F5)", None)?,
            &item("copyfield", "Copy Field (F6)", None)?,
            &item("delete", "Delete Note", None)?,
            &sep()?,
            &item("mark", "Mark or Unmark Note (M)", None)?,
            &item("markall", "Mark All Notes Found", None)?,
            &item("clearmarks", "Clear All Marks", None)?,
            &item("delmarked", "Delete Marked Notes…", None)?,
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
            &item("all", "Show All Notes", None)?,
            &item("showmarked", "Show Marked Notes", None)?,
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
            &item("theme", "Light or Dark", None)?,
            &item("palette", "All Commands…", None)?,
        ],
    )?;
    let help = Submenu::with_items(app, "Help", true, &[&item("help", "Notebook II Help", None)?])?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "Notebook II",
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &sep()?,
                &PredefinedMenuItem::hide(app, None)?,
                &item("quit", "Quit Notebook II", Some("CmdOrCtrl+Q"))?,
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
            pick_open, pick_save, read_text, write_text, write_bytes, launch_file
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Notebook II");

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
