# Notebook II

A recreation of **Notebook II**, the text database Pro/Tem Software (Stanford, California) sold for MS-DOS in the late 1980s. Historians, librarians and writers used it to keep research notes and bibliographies. This version runs in a web browser and keeps the original's way of working: named fields of any length, word search across a whole database or one field, sorting, print forms, and full-screen keyboard control with function keys.

## Running it

It is a static web page with no build step. Serve the folder with any web server and open it:

```sh
npm start            # or: python3 -m http.server 8080
```

then go to http://localhost:8080. Opening `index.html` straight from disk won't work, because browsers block the JavaScript modules on `file://` pages.

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
```

Search ignores capitals and accents.

## Print forms

A print form is a text template filled in for each record. `{Field}` puts in a field; long or multi-line text wraps and lines up under the placeholder. `{#}` is the record's number in the printout and `{Date}` is today's date. A line written as `[[ … ]]` is dropped when all its fields are blank. Forms are saved with the database. Print goes to the printer, or you can save the output as a text file in UTF-8 or DOS code page 437.

## Your old Notebook II files

Notebook II could write a database out as ASCII text for other programs, and **F9 Import** reads those files:

- **Delimited text.** Fields split by any character (tab, comma, `|`, `~`, `^`, ASCII 30/31 …), records by line breaks or another character, with an optional marker for line breaks inside a field (the DOS `¶`, character 20, is recognized automatically). Quoted CSV works. The import guesses the delimiters and whether the first row holds field names, and you can change them while watching a preview.
- **Tagged text.** `Field: value` lines, with records separated by blank lines or rule lines (`---`, `***`, form feeds). Indented lines continue the field above.
- **DOS characters.** Files are read as code page 437 unless they are valid UTF-8, so accented letters and box-drawing characters come through. A Ctrl-Z end-of-file marker is ignored.
- **Salvage.** Notebook II's own database files use a format that was never published. Choosing *Read as: Salvage* pulls every readable piece of text out of any file, one piece per record, so nothing is lost. Where you still can, exporting from Notebook II to ASCII gives a cleaner result.

If you have native Notebook II database files, a few of them would allow a proper importer for that format. Add them to `samples/`, with a note of what one or two records contain.

`samples/` has two files to try: `bibliography-dos.txt` (tab-delimited, code page 437, DOS line ends) and `notes-tagged.txt`.

## Development

Plain JavaScript modules, no dependencies.

```
js/model.js       database, fields, records, sorting
js/search.js      the search language
js/importers.js   delimited, tagged, JSON and salvage readers
js/exporters.js   writers
js/printform.js   print form templates
js/cp437.js       DOS character set
js/storage.js     saving in the browser
js/app.js         the screen and keys
```

`npm test` runs the tests (Node 20 or later).

Notebook II was a product of Pro/Tem Software, Inc. This project is an independent recreation and is not connected with Pro/Tem.
