# Notebook II

A recreation of **Notebook II**, the text database Pro/Tem Software (Stanford, California) sold for MS-DOS in the late 1980s. Historians, librarians and writers used it to keep research notes and bibliographies. This version runs in a web browser and keeps the original's way of working: named fields of any length, word search across a whole database or one field, sorting, custom forms for text and PDF output, and full-screen keyboard control.

## Running it

It is a static web page with no build step. Serve the folder with any web server and open it:

```sh
npm start            # or: python3 -m http.server 8080
```

then go to http://localhost:8080. Opening `index.html` straight from disk won't work, because browsers block the JavaScript modules on `file://` pages.

To put it online, turn on GitHub Pages once (Settings > Pages > Source: **GitHub Actions**). After that, `.github/workflows/pages.yml` runs the tests and publishes the app on every push to `main`. Pages for a private repository needs a paid GitHub plan, and the site itself is public. Databases stay in each visitor's own browser and are never uploaded.

Notebooks are saved in the browser as you work; see [Keeping your notebooks safe](#keeping-your-notebooks-safe).

### As an app

- **Install from the browser.** In Chrome or Edge, open the site and choose *Install* in the address bar (or the ⋮ menu → *Install Notebook II*). In Safari on a Mac, *File → Add to Dock*. It then opens in its own window and works without an internet connection. Notebooks are still kept in that browser.
- **Desktop app.** A real program for macOS, Windows and Linux, from the repository's *Releases* page. Each notebook is a file on your computer (`.nb2`), saved as you type, that you can back up, copy or keep in a synced folder like any document; double-clicking one opens it. It has a menu bar (File, Edit, Search, View, Help) alongside the command bar.

The desktop app is the same code wrapped with [Tauri](https://tauri.app). To build it yourself you need Node 20 and Rust (plus, on Linux, `libwebkit2gtk-4.1-dev`): `npm install`, then `npm run desktop` to run it or `npm run desktop:build` to make an installer. The **Desktop app** workflow on GitHub builds installers for all three systems: run it from the Actions tab, or push a tag such as `v0.2.0`, and a draft release appears with the installers attached. The apps are not code-signed yet, so the first launch shows a warning: on a Mac right-click the app and choose *Open*; on Windows choose *More info* → *Run anyway*.

## Using it

Every command is on the bar at the bottom of the screen, labelled, with its key beside it, so you can click, tap or type. **Ctrl+K** (⌘K on a Mac) opens a list of all commands: type part of a name (`exp` for Export, `sort year`, `find author`) and press Enter.

| Key | Does | Key | Does |
|---|---|---|---|
| `/`, F or Ctrl+F | Find: the box in the title bar finds records in the list, and text inside the record on a record | N | New note |
| Click or Enter | Open a record | S | Sort by up to three fields |
| Column heading | Sort by it (again: Z to A, again: date order) | P | Export with a form / PDF |
| Esc | Back: out of a field, the record, the database | X / I | Export / Import |
| PgUp / PgDn | Previous / next record (outside a field) | Del | Delete record |
| F5 / F6 | Copy previous / copy this field | ? | Help |
| Tab | Next field (inside a field, arrows and PgUp/PgDn move through the text) | Ctrl+Shift+S | Backup |

The search box in the title bar filters as you type; Enter or ↓ moves to the list and Esc clears it. The original F-keys still work: F2 edit, F3 new, F4 find, F5 show all, F6 sort, F7 export with a form, F8 fields, F9 import, F10 export.

A record opens ready to read and to change: click a field and type, and changes are saved as you go (F10 or Ctrl+S saves at once). Fields can be any length; a long note just scrolls. **Revert** on the command bar puts the record back as it was when you opened it. A new note left blank is dropped when you leave it. Ctrl+Home and Ctrl+End go to the start and end of the record, and Alt+PgUp/PgDn moves to the previous or next record from inside a field.

On a record, the box in the title bar (**Ctrl+F**, F4 or `/`) finds text or a `/pattern/` inside that record: every match is highlighted, Enter and Shift+Enter step through them, Esc leaves the cursor on the match, and the words stay as you page through records. Back in the list, the box finds records again. **Ctrl+Space** (or Ctrl+F2, the original's Mark key) starts a block as in Emacs: the arrow keys, Home, End and PgUp/PgDn stretch it, Ctrl+C or Ctrl+X copy or cut it, and Esc cancels it.

On a record, **F5** (or Ctrl+D) copies the previous record's source fields (Author, Title, Year and the like) into the ones still blank, so a new note from the same source only needs the note itself; **F6** (or Ctrl+Shift+D) copies just the field the cursor is in. "Previous" is the record you were on when you pressed N, or for an existing record the one before it in the list.

## Fields

A notebook is whatever fields you give it, and every field holds plain text of any length. There are no date or number types: `1938-03-17` sorts in date order as text, and `1938-03-17 (approx.)` still does. A new notebook starts from a layout (research notes, archive notes, archive sources, or one field) and opens on **Fields**, where each field has:

| Setting | |
|---|---|
| Name, order | rename, add, delete, move up and down |
| Copy with F5 | copied from the previous record by F5; until changed, fields named like Notes, Comments, Pages or Keywords are not |
| Lines | room it gets when a record opens (1–40); it grows as you type either way |
| In list | shown as a column in the list; the first four until changed |

Every record has a number of its own, shown as `#127` in the list's first column and at the top of the record. It is given when the record is made and never changes or gets reused, so it can be used to refer to the record. Clicking the `#` heading switches between newest and oldest first.

Unless it is sorted by a field, the list shows the newest records first; *Oldest first* on the Sort screen or in the command list turns it round. The notebook remembers its sort and its order; clicking a column heading a third time goes back to date order.

**Appearance** (in the command list, or View → Appearance in the desktop app) sets the font (DOS screen, modern monospace, sans-serif, serif, or any installed font), text size, line spacing, light or dark, and how many records the list shows (all by default, or 200, 500 or 1,000 at a time), kept on that computer. Even with all records shown, a list of thousands draws and scrolls quickly: the rows in view are drawn at once and the rest while the computer is idle.

## Keeping your notebooks safe

Notebooks are saved in the browser as you work. They are not on your other devices, and clearing the browser's history or site data deletes them. **Backup** (Ctrl+Shift+S) saves the open notebook as a `.nb2.json` file, which Import reads back. The app reminds you when a notebook has changed and not been backed up for a week, and asks the browser to keep its storage.

Export also writes **vertical text**: each record's fields one after another, short values beside their label and long notes below it, records separated by a rule. It is the most readable copy to keep or quote from, and Import reads it back. Exports follow the list's current order and search, or take all records, or **These record numbers** (`12-40, 55, 500-`). Vertical text, CSV, tab-separated, tagged and custom-delimited exports can include a `Record#` line or column. Importing such a file into a **new** notebook keeps the record numbers (if every record has a different one); adding it to an existing notebook gives the records new numbers, since the old ones may already be taken. A `Record#` column that cannot be used comes in as an ordinary field, so nothing is lost.

The screen follows the computer's light or dark setting. The word at the right of the title bar, or **Alt+T**, switches between Auto, Light and Dark.

## Finding records

```
smith                 anywhere, also inside words (smithy, Goldsmith)
"smith"               only the whole word
author:smith          only in the Author field
"civil war"           a phrase
hist*   wom?n         wildcards
labor south           both (AND is implied)
labor OR textiles     either
-south   NOT south    without
(a OR b) c            grouping
notes:   notes:*      Notes blank / not blank
"date of birth":1850  field names with spaces
title=the  -title=the Title begins / doesn't begin with "the"
year>1980  author<=m  begins later / the same or earlier (also < and >=)
/colou?r/             a regular expression (add c after it to match capitals: /Smith/c)
citation:/^CO 9\d/    a regular expression in one field
@marked  -@marked     records marked with M / not marked
#127                  record number 127 (Enter opens it)
#120-140  #12,15,31   a range or list of record numbers
#500-                 number 500 and later; mix with other terms: #1-200 -farmers
```

Search ignores capitals and accents (regular expressions ignore capitals but not accents). The last two lines are Notebook II's Select conditions (begins with, greater/less than); numbers compare as numbers.

## Marked records

To collect a hand-picked set, press **M** on a record in the list or on an open record, or click the ✓ column; the title bar counts the marked records. The command list (Ctrl+K) has *Show marked records* (the search `@marked`), *Mark all records in the list*, *Clear all marks* (Shift+M, after asking) and *Delete marked records*, and Export's Records choice has *The marked*. Marks are saved with the notebook and in backups; marking does not change a record's modified date.

## Custom forms and PDFs

**Export → Custom form** (or P) lays records out your own way, with a live preview. A form is a text template filled in for each record. `{Field}` puts in a field; long or multi-line text wraps and lines up under the placeholder. `{Field:20}` gives exactly 20 characters of it, cut off or padded (Notebook II's fixed fields). `{#}` is the record's place in the output (1, 2, 3 …) and `{#id}` its own record number (`#127`). A line written as `[[ … ]]` is dropped when all its fields are blank. A name that is not a field stays visible as `{Name}`, so a misspelling shows.

A form can have a page header and footer, like Notebook II's custom formats. In them `{@page}`, `{@pages}`, `{@date}` and `{@time}` give the page number, the number of pages, today's date and the time; the `@` keeps them apart from fields, so `{Date}` is always a field called Date. (Forms made before this used `{Page}`, `{Date}` and `{Time}` in headers and footers and are converted when the notebook opens.) Forms are saved with the notebook.

A custom form, or vertical text, is saved either as a text file (UTF-8 or DOS code page 437) or as a **PDF**. The PDF is made by the app itself, the same in every browser and in the desktop app: choose A4 or US Letter and a text size, and the pages are laid out to fit, with the header and footer on every page and no record split across pages when it fits on one. The text is set in DejaVu Sans Mono, built into the PDF, so every character prints and fixed-width columns line up. To print on paper, print the PDF. A text file has the header and footer once, at the start and end, or can be cut into pages of a set number of lines (66 by default) with form feeds, as Notebook II printed them.

## Your old Notebook II files

**Import** (I) reads Notebook II's own database files and the text files it and other programs wrote:

- **Notebook II databases.** A database called NAME is several files: choose `NAME.DAT`, `NAME.DEF` and `NAME.IDX` together, plus `NAME.MSC` and any custom print formats (`*.R00`) if you have them. File names can be in any case. Records marked deleted are left out unless you tick *Include records marked deleted* (they then get a `Deleted` field saying `yes`), and print formats become print forms. `NAME.DAT` on its own is recognized too, but without the `.IDX` every saved copy of an edited record comes in, and without the `.DEF` the fields are called Field 1, Field 2 … The format is described in [docs/notebook-ii-format.md](docs/notebook-ii-format.md).
- **Notebook II import text.** `%Start:`, `%Author:…` lines and `%End:`, the "Notebook format" that Notebook II's own Import read. **Export > Notebook II import text** writes it, in code page 437, so a database can go back to the DOS program.
- **Delimited text.** Fields split by any character (tab, comma, `|`, `~`, `^`, ASCII 30/31 …), records by line breaks or another character, with an optional marker for line breaks inside a field (the DOS `¶`, character 20, is recognized automatically). Quoted CSV works. The import guesses the delimiters and whether the first row holds field names, and you can change them while watching a preview.
- **Tagged text.** `Field: value` lines, with records separated by blank lines or rule lines (`---`, `***`, form feeds). Indented lines continue the field above.
- **DOS characters.** Files are read as code page 437 unless they are valid UTF-8, so accented letters and box-drawing characters come through. A Ctrl-Z end-of-file marker is ignored.
- **Salvage.** On the import preview screen (after choosing the file), *Read as → Salvage: readable text from any file* pulls every readable piece of text out of any file, one piece per record, so nothing is lost even from a damaged file. Files that are not text are salvaged automatically, and a file that cannot be read otherwise offers a *Try Salvage* button.

`samples/` has two files to try: `bibliography-dos.txt` (tab-delimited, code page 437, DOS line ends) and `notes-tagged.txt`.

## Development

Plain JavaScript modules, no dependencies.

```
js/model.js       database, fields, records, sorting
js/search.js      the search language
js/importers.js   Notebook II database, delimited, tagged, JSON and salvage readers
js/exporters.js   writers
js/printform.js   custom form templates
js/pdf.js         PDF pages (jsPDF and DejaVu Sans Mono, in js/vendor and fonts)
js/cp437.js       DOS character set
js/storage.js     saving in the browser
js/platform.js    what differs in the desktop app (files, dialogs, menu)
src-tauri/        the desktop app shell (Rust, Tauri 2)
sw.js             offline copy for the installed web app
js/app.js         the screen and keys
```

`npm test` runs the tests (Node 20 or later). `test/fixtures/native/` holds a small database and print format made with Notebook II 2.31 itself, running in DOSBox; see the format notes for what it contains.

Notebook II was a product of Pro/Tem Software, Inc. This project is an independent recreation and is not connected with Pro/Tem.
