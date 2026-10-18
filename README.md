# Handoff Inserter

An offline iPhone web app that adds dated entries (`10/16D Extubated, tolerating RA.`) to the right bed's block in the handoff .docx. Design: [handoff-app-spec.md](handoff-app-spec.md).

Everything runs on the phone. There are no network calls (a CSP `connect-src 'none'` enforces it), no analytics and no LLM. The page holds no patient data.

## Daily use
1. **Keep the handoff in OneDrive or iCloud** so it shows up in the Files app.
2. **Open Handoff** from the home screen and tap **Open handoff .docx**. Pick the file.
3. **Tap a bed.** The keyboard comes up; tap its mic to dictate. The preview shows the block's last line and your new line under it. Tap **Insert**.
4. **Check the grid.** Amber beds are not updated and green ✓ beds are done. Beds missing from the document are listed in red.
5. **Tap Export.** In the share sheet, choose **Save to Files** (same OneDrive folder) or **Word**.
   - The copy is named like `Handoff 10-17N 2214.docx`, so it never overwrites anything. The original is never changed.
6. **Open the export and check it** before relying on it. Then tap **Clear all**.

**Tag.** The tag comes from the clock:
- 06:00–17:59 → D
- 18:00–23:59 → N
- 00:00–05:59 → N, dated the previous day

To backfill, tap **Change** next to the tag. The override stays on (shown in orange) until you tap **Use clock**.

**Resume.** The loaded document, your entries and any unsent drafts are saved on the phone. If iOS closes the app, reopen it and tap **Resume**. iOS may clear this storage if the app sits unused, so export promptly. Saved data contains PHI; follow your institution's policy.

**Undo.** Removes the most recent insertion. You can repeat it.

## Install on iPhone (once)
1. Open the GitHub Pages URL in **Safari**.
2. Tap Share → **Add to Home Screen**.
3. Launch it once while online. After that it works offline. To check, turn on airplane mode and relaunch.

## Develop
```
npm install
npm test          # unit tests: detection, insertion, tags, python-docx round trip
npm run e2e       # headless Chrome (iPhone emulation) full flow against docs/
npm run build     # src/* + JSZip -> docs/index.html, stamps docs/sw.js version
npm run fixture   # regenerate fixtures/synthetic-handoff.docx (fake data)
python3 tools/make_icons.py
```
- `src/core.js`: finds beds (31–72, longest ascending run, so a stray "40 mg" is ignored) and does append-only insertion that copies the paragraph and run formatting.
- `src/tag.js`: shift tag logic.
- `src/app.js`: UI, IndexedDB resume, export.
- `docs/` is the deployable site and is what GitHub Pages serves. Run `npm run build` before committing. The service worker version changes automatically, so phones pick up the new build on their next launch or the one after.

`.gitignore` excludes every `.docx` except the synthetic fixture, so a real handoff can't be committed by accident.

## Before clinical use
Test with a **blank copy of the real template** on the phone. Check that every bed is detected and that inserted lines land in the right place with matching formatting. Two things are less reliable: documents with tracked changes, and documents with complex nested tables.
