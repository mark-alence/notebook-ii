# ThreeByFive

A program for keeping records the way people once kept index cards: research notes, bibliographies, archive sources, or anything else. A **collection** holds **records**; each record has fields you name (Author, Title, Notes …), and every field holds as much text as it needs. Find records by any word, sort them, mark the ones you want, and export them as text, spreadsheets or PDFs laid out with forms you design. It runs in a web browser or as a desktop app, and works from the keyboard.

ThreeByFive began as a recreation of Notebook II, the text database Pro/Tem Software sold for MS-DOS in the late 1980s, and it still imports Notebook II's files.

## Running it

It is a static web page with no build step. Serve the folder with any web server and open it:

```sh
npm start            # or: python3 -m http.server 8080
```

then go to http://localhost:8080. Opening `index.html` straight from disk won't work, because browsers block the JavaScript modules on `file://` pages.

To put it online, turn on GitHub Pages once (Settings > Pages > Source: **GitHub Actions**). After that, `.github/workflows/pages.yml` runs the tests and publishes the app on every push to `main`. Pages for a private repository needs a paid GitHub plan, and the site itself is public. Collections stay in each visitor's own browser and are never uploaded.

Collections are saved in the browser as you work; see [Keeping your collections safe](#keeping-your-collections-safe).

### As an app

- **Install from the browser.** In Chrome or Edge, open the site and choose *Install* in the address bar (or the ⋮ menu → *Install ThreeByFive*). In Safari on a Mac, *File → Add to Dock*. It then opens in its own window and works without an internet connection. Collections are still kept in that browser.
- **Desktop app.** A real program for macOS, Windows and Linux, from the repository's *Releases* page. Each collection is a file on your computer (`.3x5`; older `.nb2` files open too), saved as you type, that you can back up, copy or keep in a synced folder like any document; double-clicking one opens it. It has a menu bar (File, Edit, Search, View, Help) alongside the command bar.

The desktop app is the same code wrapped with [Tauri](https://tauri.app). To build it yourself you need Node 20 and Rust (plus, on Linux, `libwebkit2gtk-4.1-dev`): `npm install`, then `npm run desktop` to run it or `npm run desktop:build` to make an installer. The **Desktop app** workflow on GitHub builds installers for all three systems: run it from the Actions tab, or push a tag such as `v0.2.0`, and a draft release appears with the installers attached. The apps are not code-signed yet, so the first launch shows a warning: on a Mac right-click the app and choose *Open*; on Windows choose *More info* → *Run anyway*.

## Using it

Every command is on the bar at the bottom of the screen, labelled, with its key beside it, so you can click, tap or type. **Ctrl+K** (⌘K on a Mac) opens a list of all commands: type part of a name (`exp` for Export, `sort year`, `find author`) and press Enter.

| Key | Does | Key | Does |
|---|---|---|---|
| `/`, F or Ctrl+F | Find: the box in the title bar finds records in the list, and text inside the record on a record | N | New record |
| Click or Enter | Open a record | S | Sort by as many fields as you like |
| Column heading | Sort by it (again: Z to A, again: date order) | P | Export with a form / PDF |
| Esc | Back: out of a field, the record, the collection | X / I | Export / Import |
| PgUp / PgDn | Previous / next record (outside a field) | Del | Delete record |
| Ctrl+D / Ctrl+Shift+D | In a new record: copy previous / copy this field | ? | Help |
| Tab | Next field (inside a field, arrows and PgUp/PgDn move through the text) | Ctrl+Shift+S | Backup |
| M / Shift+M | Mark or unmark a record / clear all marks | Alt+T | Light, Dark, Retro |

The search box in the title bar filters as you type; Enter or ↓ moves to the list and Esc clears it.

A record opens ready to read and to change: click a field and type, and changes are saved as you go (Ctrl+S saves at once). Fields can be any length; long text just scrolls. **Revert** on the command bar puts the record back as it was when you opened it. A new record left blank is dropped when you leave it. Ctrl+Home and Ctrl+End go to the start and end of the record, and Alt+PgUp/PgDn moves to the previous or next record from inside a field.

On a record, the box in the title bar (**Ctrl+F** or `/`) finds text or a `/regex/` (regular expression) inside that record: every match is highlighted, Enter and Shift+Enter step through them, Esc leaves the cursor on the match, and the words stay as you page through records. Back in the list, the box finds records again. **Ctrl+Space** starts a block as in Emacs: the arrow keys, Home, End and PgUp/PgDn stretch it, Ctrl+C or Ctrl+X copy or cut it, and Esc cancels it.

In a new record, **Ctrl+D** copies the source fields (Author, Title, Year and the like) from the record you were on when you pressed N, so a new record from the same source needs only what is new; **Ctrl+Shift+D** copies just the field the cursor is in. Either asks for an OK before replacing text already in a field. They work only while the new record is open: once you leave it, it is an ordinary record and they are not offered. The line under the fields names the source, e.g. "from #125 (Darnton, Robert)".

## Projects

A project groups collections, say all those for one book or thesis. The **Project** list at the top of the start screen (P) shows one project's collections, the Unfiled ones, or all of them, and is remembered; *New project*, *Rename* and *Delete* sit beside it (deleting a project keeps its collections, as Unfiled). New and imported collections, and the sample, go into the project on screen; a collection moves to another project from its Fields screen. The title bar shows *project › collection*. The project is kept in the collection and its backups. (In the desktop app, projects are to become folders.)

## Fields

A collection is whatever fields you give it, and every field holds plain text of any length. There are no date or number types: `1938-03-17` sorts in date order as text, and `1938-03-17 (approx.)` still does. A new collection starts from a layout (research notes, archive notes, archive sources, or one field) and opens on **Fields**, where each field has the settings below. Under them, **Columns in the list** sets which fields the list of records shows and in what order (▲ ▼, Remove, Add column), apart from the order of the fields in a record; the first four until changed. Column widths follow the contents: a short field such as Year gets a narrow column and the others share the rest in proportion to how long their entries usually are.

| Setting | |
|---|---|
| Name, order | rename, add, delete, move up and down |
| Copy into new records | copied by Ctrl+D into a new record; until changed, fields named like Notes, Comments, Pages or Keywords are not |
| Lines | room it gets when a record opens (1–40); it grows as you type either way |

Every record has a number of its own, shown as `#127` in the list's first column and at the top of the record. It is given when the record is made and never changes or gets reused, so it can be used to refer to the record. Clicking the `#` heading switches between newest and oldest first.

Unless it is sorted by a field, the list shows the newest records first; *Oldest first* on the Sort screen or in the command list turns it round. The collection remembers its sort and its order; clicking a column heading a third time goes back to date order.

## Appearance

The word at the right of the title bar, or **Alt+T**, switches the screen between **Auto** (the computer's light or dark setting), **Light**, **Dark** and **Retro**. Dark follows current advice for long reading in low light: a very dark blue rather than pure black, off-white rather than pure white text (contrast about 12:1 rather than 21:1, which cuts glare and the smearing of letters), and soft, desaturated colours. Retro is the blue screen of a 1980s DOS program, with the DOS screen font.

**Appearance** (in the command list, or View → Appearance in the desktop app) sets the font (*Match the theme*, the default: a modern monospace, or the DOS screen font in Retro; or the DOS screen font, sans-serif, serif, or any installed font), text size, line spacing, the screen, where a record's field names go (automatically beside the text when the window shows the whole record and above it otherwise, or always above, or always beside), and how many records the list shows (all by default, or 200, 500 or 1,000 at a time), kept on that computer. Even with all records shown, a list of thousands draws and scrolls quickly: the rows in view are drawn at once and the rest while the computer is idle.

## Keeping your collections safe

Collections are saved in the browser as you work. They are not on your other devices, and clearing the browser's history or site data deletes them. **Backup** (Ctrl+Shift+S) saves the open collection as a `.3x5.json` file, which Import reads back. The app reminds you when a collection has changed and not been backed up for a week, and asks the browser to keep its storage.

Export also writes **vertical text**: each record's fields one after another, short values beside their label and long text below it, records separated by a rule. It is the most readable copy to keep or quote from, and Import reads it back. Exports follow the list's current order and search, or take all records, or the marked ones, or **These record numbers** (`12-40, 55, 500-`). Vertical text, CSV, tab-separated, tagged and custom-delimited exports can include a `Record#` line or column. Importing such a file into a **new** collection keeps the record numbers (if every record has a different one); adding it to an existing collection gives the records new numbers, since the old ones may already be taken. A `Record#` column that cannot be used comes in as an ordinary field, so nothing is lost. Every text export is UTF-8; the custom-delimited one marks line breaks inside a field with `¶`, which Import turns back into line breaks.

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

Search ignores capitals and accents (regular expressions ignore capitals but not accents). In comparisons (`year>1980`), numbers compare as numbers.

## Marked records

To collect a hand-picked set, press **M** on a record in the list or on an open record, or click the ✓ column; the title bar counts the marked records. The command list (Ctrl+K) has *Show marked records* (the search `@marked`), *Mark all records in the list*, *Clear all marks* (Shift+M, after asking) and *Delete marked records* (also Del in the list whenever records are marked; the command bar then reads "Delete 3 marked", and an open record's Del still deletes just that one), and Export's Records choice has *The marked*. Marks are saved with the collection and in backups; marking does not change a record's modified date.

## Custom forms and PDFs

**Export → Custom form** (or P) lays records out your own way, with a live preview. A form is a text template filled in for each record. `{Field}` puts in a field; long or multi-line text wraps and lines up under the placeholder. `{Field:20}` gives exactly 20 characters of it, cut off or padded. `{Record#}` is the record's own number (`127`, or `{Record#:6}` padded to 6 characters), `{#id}` the same as `#127`, and `{#}` the record's place in the output (1, 2, 3 …). A field of your own called Record# takes precedence. A line written as `[[ … ]]` is dropped when all its fields are blank. A name that is not a field stays visible as `{Name}`, so a misspelling shows.

A form can have a page header and footer. In them `{@page}`, `{@pages}`, `{@date}` and `{@time}` give the page number, the number of pages, today's date and the time; the `@` keeps them apart from fields, so `{Date}` is always a field called Date. Forms are saved with the collection.

A custom form, or vertical text, is saved either as a text file or as a **PDF**. The PDF is made by the app itself, the same in every browser and in the desktop app: choose A4 or US Letter, a text size and a font (the paper, size, font and the text-or-PDF choice are remembered on that computer), and the pages are laid out to fit, with the header and footer on every page and no record split across pages when it fits on one. The font is built into the PDF, so every character prints: **Monospace** (DejaVu Sans Mono, the default) keeps fixed-width columns and the labels of vertical text lined up; **Serif** (DejaVu Serif) and **Sans-serif** (DejaVu Sans) read more like a book or a modern document, but their letters differ in width, so such columns do not stay lined up. Long lines wrap to the page in any of them, and the preview shows the lines in the chosen font. To print on paper, print the PDF. A text file has no font or pages of its own (the program that opens it decides); it has the header once at the start and the footer once at the end.

## Importing

**Import** (I) first asks what kind of file to read, then for the file: *Any file* (ThreeByFive works out the kind), a *ThreeByFive collection* (a backup), *Spreadsheet (CSV)*, *Tab-delimited text*, *Tagged text*, *Other delimited text*, *Salvage*, or a *Notebook II database*. A preview follows, where the way the file is read and its delimiters can still be changed, and the records can make a new collection or join the open one.

- **Delimited text.** Fields split by any character (tab, comma, `|`, `~`, `^`, ASCII 30/31 …), records by line breaks or another character, with an optional marker for line breaks inside a field (`¶`, and the DOS `¶`, character 20, are recognized automatically). Quoted CSV works. The import guesses the delimiters and whether the first row holds field names, and you can change them while watching a preview.
- **Tagged text.** `Field: value` lines, with records separated by blank lines or rule lines (`---`, `***`, form feeds). Indented lines continue the field above. ThreeByFive's own vertical text reads back this way.
- **Salvage** pulls every readable piece of text out of any file, one piece per record, so nothing is lost even from a damaged file. Files that are not text are salvaged automatically, and a file that cannot be read otherwise offers a *Try Salvage* button.
- **DOS characters.** Files are read as code page 437 unless they are valid UTF-8, so accented letters and box-drawing characters from DOS programs come through. A Ctrl-Z end-of-file marker is ignored.

### Notebook II files

ThreeByFive reads the files of Notebook II, the DOS program it began as a recreation of.

- **Notebook II databases.** A database called NAME is several files: choose `NAME.DAT`, `NAME.DEF` and `NAME.IDX` together, plus `NAME.MSC` and any custom print formats (`*.R00`) if you have them. File names can be in any case. Records marked deleted are left out unless you tick *Include records marked deleted* (they then get a `Deleted` field saying `yes`), and print formats become custom forms. `NAME.DAT` on its own is recognized too, but without the `.IDX` every saved copy of an edited record comes in, and without the `.DEF` the fields are called Field 1, Field 2 … The format is described in [docs/notebook-ii-format.md](docs/notebook-ii-format.md).
- **Notebook II import text.** `%Start:`, `%Author:…` lines and `%End:`, the "Notebook format" that Notebook II's own Import read.

`samples/` has two files to try: `bibliography-dos.txt` (tab-delimited, code page 437, DOS line ends) and `notes-tagged.txt`.

## Development

Plain JavaScript modules, no dependencies.

```
js/model.js       collections, fields, records, sorting
js/search.js      the search language
js/importers.js   Notebook II database, delimited, tagged, JSON and salvage readers
js/exporters.js   writers
js/printform.js   custom form templates
js/pdf.js         PDF pages (jsPDF and the DejaVu Sans Mono, Serif and Sans fonts, in js/vendor and fonts)
js/cp437.js       DOS character set (for importing)
js/storage.js     saving in the browser
js/platform.js    what differs in the desktop app (files, dialogs, menu)
js/theme.js       Light, Dark, Retro
js/appearance.js  font, size, spacing and other display choices
src-tauri/        the desktop app shell (Rust, Tauri 2)
sw.js             offline copy for the installed web app
js/app.js         the screen and keys
```

Inside the code a collection is still often called a database (`db`), and browser storage keys still begin `nb2:`, so collections made before the rename carry over unchanged.

`npm test` runs the tests (Node 20 or later). `test/fixtures/native/` holds a small database and print format made with Notebook II 2.31 itself, running in DOSBox; see the format notes for what it contains.

Notebook II was a product of Pro/Tem Software, Inc. ThreeByFive is independent of it and not connected with Pro/Tem.
