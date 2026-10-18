# Handoff Inserter: Design Spec

Status: planning only, not built.

## Purpose
An iPhone app-like tool (PWA) that inserts hospital course text into the correct patient block of an existing handoff Word document (.docx). No LLM, no scrubbing, no network calls. Everything runs on the phone.

## Platform
- Progressive web app: a single HTML file added to the iPhone home screen from Safari.
- Launches full-screen, works offline, no App Store or developer account.
- Libraries bundled into the file (no CDN calls at runtime): JSZip for reading/editing the .docx.
- The page contains no patient data. Host it somewhere you control, not a shared link.

## Workflow
1. Open the app and pick the handoff .docx from Files.
2. The app scans the document and lists the beds it finds.
3. Tap a bed, type or dictate the entry (iOS keyboard mic).
4. Preview shows the tag and where the text will land. Tag can be overridden.
5. Tap Insert. Repeat for other beds.
6. Tap Export. The share sheet returns a modified copy (to Files, Word, AirDrop).

## Document structure assumptions
- Each patient block starts with a paragraph beginning with a typed bed number.
- Bed number is typed text (not Word auto-numbering), followed by a space.
- Bed numbers range 31 to 72, in ascending order through the document.
- A block runs from its bed paragraph until the next bed paragraph (or end of document for the last).

## Bed detection rules
- A paragraph counts as a bed start if it begins with an integer 31-72 followed by a space.
- Numbers must be strictly ascending. A matching paragraph that breaks ascending order is ignored (filters stray matches like "40 mg" inside a block).
- Beds expected but not found in the document are flagged separately (skipped or mistyped numbers).
- Also scan tables and text boxes if bed lines are located there.

## Insertion rules
- Insert a new paragraph at the end of the block, after the last non-empty paragraph and before the next bed paragraph (ignore trailing blank paragraphs).
- New paragraph copies the paragraph and run formatting (font, size, spacing, indent) of the block's body text.
- Append only: existing text is never modified or deleted.
- Multiple entries in the same bed stack in the order entered.
- Original file is never overwritten; the export is a new copy.

## Entry format
`<tag> <text>`, e.g. `10/16D Extubated, tolerating RA.`

Tag = `M/D` + shift letter, no space between date and letter, single space before the text. No leading zeros on month or day (`10/6D`, not `10/06D`).

### Shift letter and date (from the phone clock at Insert)
| Local time | Letter | Date used |
|---|---|---|
| 06:00 to 17:59 | D | today |
| 18:00 to 23:59 | N | today |
| 00:00 to 05:59 | N | previous day |

- Month and year rollover handled (3am on 11/1 gives `10/31N`; 3am on 1/1 gives `12/31N`).
- Tag is shown in the preview and can be overridden (date and D/N) before inserting, for backfilling or late notes.
- Uses the phone's local time zone.

## Not-updated checklist
- Main screen lists every detected bed.
- A check appears next to each bed that has received an entry this session.
- Beds without an entry are highlighted so skipped patients are obvious before export.
- Beds missing from the document are flagged separately.
- Checks reset when a new document is loaded.

## UI notes
- Single-column, large tap targets, one bed's entry screen at a time.
- Bed list as a scrollable grid or list with status (updated / not updated).
- Preview of the insertion point (the last line of the block above, the new line below).
- Undo for the last insertion before export.

## Privacy and safety
- No network calls after the page loads; no analytics.
- Drafts and session state live in memory by default. Optional local-storage draft saving, with a clear-all button.
- iOS may clear web storage if the app goes unused, so treat it as a scratchpad and export promptly.
- Edited file contains PHI. Handle the exported copy per institutional policy.
- Check institutional policy on PHI on personal devices.

## Edge cases and risks
- Tracked changes, text boxes, or heavily nested tables may make placement less reliable.
- A block with no body paragraph (bed line only): fall back to formatting of the bed paragraph.
- Bed paragraph that is the last paragraph in the document: append after it.
- Template changes: if bed formatting changes between shifts, detection should still work because it relies only on the leading number.
- Always verify the exported document before relying on it.

## Open items
1. Confirm "M/DD" reads as month/day plus the letter D (current assumption).
2. Confirm single space between tag and text.
3. Test against a blank or fully de-identified copy of the real document to confirm anchors and formatting copy correctly (do not upload real PHI).

## Out of scope (for now)
- De-identification or tokenization.
- LLM integration.
- Overwriting the original file in place.
- Custom dictation button (use the iOS keyboard mic).
