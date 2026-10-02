# Notebook II

A recreation of **Notebook II**, the text database Pro/Tem Software (Stanford, California) sold for MS-DOS in the late 1980s. Historians, librarians and writers used it to keep research notes and bibliographies. This version runs in a web browser and keeps the original's way of working: named fields of any length, word search across a whole database or one field, sorting, print forms, and full-screen keyboard control with function keys.

## Running it

It is a static web page with no build step. Serve the folder with any web server and open it:

```sh
npm start            # or: python3 -m http.server 8080
```

then go to http://localhost:8080. Opening `index.html` straight from disk won't work, because browsers block the JavaScript modules on `file://` pages.

To put it online, turn on GitHub Pages once (Settings > Pages > Source: **GitHub Actions**). After that, `.github/workflows/pages.yml` runs the tests and publishes the app on every push to `main`. Pages for a private repository needs a paid GitHub plan, and the site itself is public. Databases stay in each visitor's own browser and are never uploaded.

Databases are saved in the browser as you work. **F10 Export > Notebook file** makes a `.nb2.json` copy for backups or for moving to another computer.

## Keys

| Key | Does | Key | Does |
|---|---|---|---|
| F1 | Help | F6 | Sort by up to three fields |
| F2 | Edit record | F7 | Print forms and printing |
| F3 | Add record | F8 | Add, rename, reorder fields |
| F4 or `/` | Find | F9 | Import a file |
| F5 | Show all records | F10 | Export (Save while editing) |
| Enter | Show whole record | Del | Delete record |
| PgUp / PgDn | Previous / next | Esc | Back, or close the database |

Every command is also on the bar at the bottom of the screen for mouse and touch.

While editing a record, **F5** copies the previous record's source fields (Author, Title, Year and the like) into the ones still blank, so a new note on the same book only needs the note itself. **F6** copies just the field the cursor is in. Which fields F5 copies is a checkbox per field under **F8 Fields**; until you change it, fields with names like Notes, Comments, Pages or Keywords are left out.

The screen follows the computer's light or dark setting. The word at the right of the title bar, or **Alt+T**, switches between Auto, Light and Dark.

## Finding records

```
smith                 the word anywhere
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
```

Search ignores capitals and accents. The last two lines are Notebook II's Select conditions (begins with, greater/less than); numbers compare as numbers.

## Print forms

A print form is a text template filled in for each record. `{Field}` puts in a field; long or multi-line text wraps and lines up under the placeholder. `{Field:20}` gives exactly 20 characters of it, cut off or padded (Notebook II's fixed fields). `{#}` is the record's number in the printout, `{Date}` today's date and `{Time}` the time. A line written as `[[ … ]]` is dropped when all its fields are blank. A form can have a page header and footer, like Notebook II's custom formats; then the printout is cut into 66-line pages with a form feed between them, and `{Page}` is the page number. Forms are saved with the database. Print goes to the printer, or you can save the output as a text file in UTF-8 or DOS code page 437.

## Your old Notebook II files

**F9 Import** reads Notebook II's own database files and the text files it and other programs wrote:

- **Notebook II databases.** A database called NAME is several files: choose `NAME.DAT`, `NAME.DEF` and `NAME.IDX` together, plus `NAME.MSC` and any custom print formats (`*.R00`) if you have them. File names can be in any case. Records marked deleted are left out unless you tick *Include records marked deleted* (they then get a `Deleted` field saying `yes`), and print formats become print forms. `NAME.DAT` on its own is recognized too, but without the `.IDX` every saved copy of an edited record comes in, and without the `.DEF` the fields are called Field 1, Field 2 … The format is described in [docs/notebook-ii-format.md](docs/notebook-ii-format.md).
- **Notebook II import text.** `%Start:`, `%Author:…` lines and `%End:`, the "Notebook format" that Notebook II's own Import read. **F10 Export > Notebook II import text** writes it, in code page 437, so a database can go back to the DOS program.
- **Delimited text.** Fields split by any character (tab, comma, `|`, `~`, `^`, ASCII 30/31 …), records by line breaks or another character, with an optional marker for line breaks inside a field (the DOS `¶`, character 20, is recognized automatically). Quoted CSV works. The import guesses the delimiters and whether the first row holds field names, and you can change them while watching a preview.
- **Tagged text.** `Field: value` lines, with records separated by blank lines or rule lines (`---`, `***`, form feeds). Indented lines continue the field above.
- **DOS characters.** Files are read as code page 437 unless they are valid UTF-8, so accented letters and box-drawing characters come through. A Ctrl-Z end-of-file marker is ignored.
- **Salvage.** Choosing *Read as: Salvage* pulls every readable piece of text out of any file, one piece per record, so nothing is lost even from a damaged file.

`samples/` has two files to try: `bibliography-dos.txt` (tab-delimited, code page 437, DOS line ends) and `notes-tagged.txt`.

## Development

Plain JavaScript modules, no dependencies.

```
js/model.js       database, fields, records, sorting
js/search.js      the search language
js/importers.js   Notebook II database, delimited, tagged, JSON and salvage readers
js/exporters.js   writers
js/printform.js   print form templates
js/cp437.js       DOS character set
js/storage.js     saving in the browser
js/app.js         the screen and keys
```

`npm test` runs the tests (Node 20 or later). `test/fixtures/native/` holds a small database and print format made with Notebook II 2.31 itself, running in DOSBox; see the format notes for what it contains.

Notebook II was a product of Pro/Tem Software, Inc. This project is an independent recreation and is not connected with Pro/Tem.
