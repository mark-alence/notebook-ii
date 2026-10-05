# Notebook II database files

Notes on the files written by Notebook II 2.31 (Pro/Tem Software, 1987), as read by `js/importers.js`.

## Where this comes from

The program was found on discmaster.textfiles.com as `NOTEBKII.ARC`, inside `wbiz0001.tar` of the "ibm-wgam-wbiz" CD collection (also on archive.org as `ibm-wgam-wbiz-collection`, file `wbiz0000-0009.zip`). The ARC archive (221,184 bytes, dated 9 July 1987) holds:

| File | Size | What it is |
|---|---|---|
| `NB.EXE` | 19,089 | Command menu, version 2.31a (23 May 1987) |
| `NBEDIT.EXE` | 88,879 | Edit module, 2.31 (11 Apr 1987) |
| `NBPRINT.EXE` | 82,315 | Print module, 2.32 (28 Apr 1987) |
| `NBUTILS.EXE` | 80,457 | Utilities module, 2.31. **Damaged**: fails its CRC in the archive and DOS reports "Packed file is corrupt" |
| `NBFIX.EXE` | 15,487 | Repair tool, 2.10 (3 Jun 1985) |
| `HELP.NB` | 44,319 | On-line help screens |
| `BOOKS.DAT .DEF .IDX .MSC` | | Sample database: 22 book records, 6 fields |
| `BOOKS.R00` | 1,908 | Sample custom print format |
| `BOOKS.WP` | 640 | Sample import text (2 records) |
| `CONFIG.SYS` | 128 | `files = 16` |

There is no manual or licence file. The help file states that Notebook is copyrighted and that copies may not be given to anyone else, so none of these files are in this repository. The test fixture in `test/fixtures/native/` was made instead by running the program in DOSBox and typing in four records of our own.

Because `NBUTILS.EXE` is damaged, Compact, Import, Merge, Key and Options could not be run; what is known of them comes from the help screens and the strings in the program.

## A database

A database NAME (up to 8 characters) is a set of files. Text is in code page 437. Numbers are little-endian. While compacting, backups are made as `.BDT`, `.BDF`, `.BIX`, `.BMS` (and temporary files as `.TDT`, `.TDF`, `.TIX`, `.TMS`); they have the same layouts.

### NAME.DEF — headings

1,200 bytes: 50 slots of 24 bytes, each a heading name padded with NULs. Unused slots are all NUL. The help says a heading has up to 20 characters and a database up to 50 headings.

### NAME.DAT — record text

Records one after another. Every field ends with a NUL byte and every record ends with `0x80`, so a record with fields `Alpha`, empty, `x` is

```
41 6C 70 68 61 00 | 00 | 78 00 | 80
```

A paragraph break typed inside a field (Return with Insert on) is stored as a bare CR, `0x0D`. Notebook II shows it on screen as `←`.

The file is only ever appended to. Saving an edited record writes the whole record again at the end of the file and points the index at the new copy; the old copy stays as a "ghost" until Utilities > Compact rewrites the database. Marking a record deleted also rewrites it. So the `.DAT` must be read through the index: reading it front to back gives every copy ever saved.

`0x80` is also `Ç` in code page 437; the index lengths are what make a `Ç` in the text unambiguous.

### NAME.IDX — index

105 bytes per record, in the database's record order:

| Offset | Size | |
|---|---|---|
| 0 | 1 | flag: `0x00`, or `0xFF` when the record is marked deleted (Shift-F7) |
| 1 | 50 × 2 | length of each field in `.DAT`, counting its NUL (so an empty field is 1). 0 for headings past the record's last field |
| 101 | 4 | offset of the record's current copy in `.DAT` |

The lengths of a record's fields add up to its size in `.DAT`, less the `0x80`.

### NAME.MSC — settings

478 bytes. Starts with the size of `.DAT` (4 bytes) and the number of records (4 bytes); the rest holds the Options settings (left margin, deleted records shown or hidden, insert mode, colours, paragraph character, ALT-F1…F10 characters and so on) and the text `Notebook` at offset 108, perhaps the database ID. Only the record count is used by the importer.

### Views and other files

`_VIEW.NB` records the view in use between modules. Saved views use `.V` extensions and keys a key file; none were available to examine. `SKIPKEYS.NB` lists words left out of a key file.

## Custom print formats (FORMAT.R00)

Named after the format, not the database (`BOOKS.R00` is the format "BOOKS"). 1,908 bytes: 18 lines of 100 bytes, NUL-padded, then 108 bytes of options.

- Line 0 is the page header, lines 1–16 are printed for each record, line 17 is the page footer.
- A field is four bytes: `ESC`, `0x20` + field number (0 = first heading), `0x20` + fixed width (0 = the whole field, "variable"), `FS` (`0x1C`). The format editor shows it as `<4:0  >`.
- Options, as 16-bit numbers from byte 1,800: [3] left margin, [4] line length, [5] lines on a page. The rest (pause, keep, suppress, hanging indent, lines between records …) is not decoded.

From the help screen and from printing with the real program:

| In a format | Means |
|---|---|
| `#` | record number in the printout (1, 2, 3 …); page number in header or footer |
| `@` | date and time in header or footer ("Friday October 2, 2026.  9:08 pm") |
| line holding only `\|` | blank line |
| `^` | form feed |
| `\` at end of line | no line feed: join with the next line |
| `\ddd` | send character code ddd |
| `~ … ~` | left out when the field inside is empty, if the Suppress option is on (otherwise printed as is) |
| `* … *` | hanging indent (AutoIndent option) |
| `_ … _` | underlined |

The importer turns field references into `{Name}` or `{Name:20}`, `#` into `{#}` or `{@page}`, `@` into `{@date} {@time}`, a line wrapped in `~ ~` into a `[[ … ]]` line, and drops the underline and indent markers.

## Standard ("Notebook format") printout

Without a custom format, each record prints as its headings in a 20-column margin, a `|`, and the text wrapped to 56 columns; deleted records are skipped. Headers and footers can be set for it too.

## Import text

`BOOKS.WP` shows the text Notebook II imports in "Notebook format":

```
%Start:
%Author:Brest, Paul & Levinson, Sanford
%Title:Processes of Constitutional Decisionmaking
%Comments:Casebook for a law school course in constitutional law.
%End:
```

The Options screen has "Field Start Char" and "Field End Char", so `%` and `:` were probably settings. Import options were Newlines (spaces, remove, keep), control characters (keep, remove) and extended characters (keep, mask, remove); the other import format was "BASIC" (comma-separated, quoted).

## How the original behaved, compared with this program

- **Find / Select** looked for up to 20 contiguous characters, ignoring case, anywhere in a field or the whole record, or at the start of a field. Select could also take records where a field begins with something alphabetically later or earlier (`>`, `<`, `>=`, `<=`), with one AND/OR second condition. This program searches by words with wildcards, and now also has `field=text` (begins with) and the four comparisons.
- **Reorder** sorted on the first 20 characters of one field, case sensitive or not. This program sorts on whole values, by as many fields as wanted.
- **Limits**: 50 headings of up to 20 characters. This program has no such limits. (It imports from Notebook II but does not write files for it.)
