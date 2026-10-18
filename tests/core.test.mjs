import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  openDocx, buildDocx, detectBeds, anchorFor, insertEntry, removeEntry, paraText,
} from '../src/core.js';

const env = { DOMParser, XMLSerializer };
const FIXTURE = new URL('../fixtures/synthetic-handoff.docx', import.meta.url);
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function load() {
  return openDocx(JSZip, await readFile(FIXTURE), env);
}

test('detects beds, ignores stray numbers, reports missing', async () => {
  const { doc } = await load();
  const scan = detectBeds(doc);
  const beds = scan.beds.map((b) => b.bed);
  const expected = [];
  for (let n = 31; n <= 72; n++) if (n !== 44) expected.push(n);
  assert.deepEqual(beds, expected);
  assert.deepEqual(scan.missing, [44]);
  // Bed 40 is the real bold line, not "40 mg" inside bed 35.
  assert.match(paraText(scan.beds.find((b) => b.bed === 40).para), /^40 \w+, Test/);
  // Tie case: bed 38 is the real line, not "38 hr NPO".
  assert.match(paraText(scan.beds.find((b) => b.bed === 38).para), /^38 \w+, Test/);
});

test('anchor skips trailing blanks; falls back to bed line when no body', async () => {
  const { doc } = await load();
  const scan = detectBeds(doc);
  assert.equal(anchorFor(scan, 33).text, 'HPI: fake history for bed 33.');
  assert.equal(anchorFor(scan, 35).text, '40 mg IV furosemide BID');
  assert.equal(anchorFor(scan, 41).text, 'Plan item two');
  assert.ok(anchorFor(scan, 47).isBedLine);
  assert.ok(anchorFor(scan, 72).isBedLine);
  assert.match(anchorFor(scan, 60).text, /text box/);
  assert.match(anchorFor(scan, 52).text, /table/);
});

test('insert places text after anchor, copies formatting, stacks in order', async () => {
  const { doc } = await load();
  let scan = detectBeds(doc);
  const a = insertEntry(doc, scan, 33, '10/16D First.');
  scan = detectBeds(doc);
  const b = insertEntry(doc, scan, 33, '10/16D Second.');
  scan = detectBeds(doc);

  const anchor = anchorFor(scan, 33);
  assert.equal(anchor.para, b);
  assert.equal(paraText(a.previousSibling), 'HPI: fake history for bed 33.');
  assert.equal(a.nextSibling, b);

  // Bed list unchanged by insertion.
  assert.equal(scan.beds.length, 41);

  // Copied indent and font size from the body paragraph.
  const ser = new XMLSerializer().serializeToString(a);
  assert.match(ser, /w:ind w:left="360"/);
  assert.match(ser, /w:sz w:val="20"/);
  assert.match(ser, /xml:space="preserve"/);

  // Bulleted body keeps its list style.
  const c = insertEntry(doc, detectBeds(doc), 41, '10/16D Bullet.');
  assert.match(new XMLSerializer().serializeToString(c), /ListBullet/);

  // Bed-line fallback copies bold.
  const d = insertEntry(doc, detectBeds(doc), 47, '10/16D No body.');
  assert.match(new XMLSerializer().serializeToString(d), /<w:b\/>/);
});

test('insert inside table cell and text box stays in that container', async () => {
  const { doc } = await load();
  const t = insertEntry(doc, detectBeds(doc), 52, '10/16D Table entry.');
  assert.equal(t.parentNode.localName, 'tc');
  const x = insertEntry(doc, detectBeds(doc), 60, '10/16D Box entry.');
  assert.equal(x.parentNode.localName, 'txbxContent');
});

test('last bed appends before body sectPr, never copies sectPr', async () => {
  const { doc } = await load();
  const p = insertEntry(doc, detectBeds(doc), 72, '10/16N Last.');
  assert.equal(p.nextSibling.localName, 'sectPr');
  assert.equal(p.getElementsByTagNameNS(W, 'sectPr').length, 0);
});

test('multi-line text becomes line breaks', async () => {
  const { doc } = await load();
  const p = insertEntry(doc, detectBeds(doc), 31, '10/16D a\nb');
  assert.equal(paraText(p), '10/16D a\nb');
});

test('undo removes the inserted paragraph', async () => {
  const { doc } = await load();
  const before = detectBeds(doc).paras.length;
  const p = insertEntry(doc, detectBeds(doc), 45, '10/16D x');
  removeEntry(p);
  assert.equal(detectBeds(doc).paras.length, before);
});

test('mc:Fallback text box copies are not double counted', () => {
  const xml = `<w:document xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>
    <w:p><w:r><w:t>31 Bed</w:t></w:r></w:p>
    <w:p><w:r><mc:AlternateContent>
      <mc:Choice Requires="wps"><w:txbxContent><w:p><w:r><w:t>32 Boxed</w:t></w:r></w:p></w:txbxContent></mc:Choice>
      <mc:Fallback><w:txbxContent><w:p><w:r><w:t>32 Boxed</w:t></w:r></w:p></w:txbxContent></mc:Fallback>
    </mc:AlternateContent></w:r></w:p>
    <w:p><w:r><w:t>33 Bed</w:t></w:r></w:p>
  </w:body></w:document>`;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const scan = detectBeds(doc);
  assert.deepEqual(scan.beds.map((b) => b.bed), [31, 32, 33]);
  assert.equal(scan.paras.length, 4);
});

test('round trip: exported docx opens in python-docx with entries in place', async () => {
  const { zip, doc } = await load();
  insertEntry(doc, detectBeds(doc), 33, '10/16D Round trip 33.');
  insertEntry(doc, detectBeds(doc), 72, '10/16N Round trip 72.');
  const buf = await buildDocx(zip, doc, env, 'nodebuffer');
  const outDir = new URL('../fixtures/out/', import.meta.url);
  await mkdir(outDir, { recursive: true });
  const out = new URL('roundtrip.docx', outDir);
  await writeFile(out, buf);
  const py = `
import sys, docx
d = docx.Document(sys.argv[1])
t = [p.text for p in d.paragraphs]
i = t.index('10/16D Round trip 33.')
assert t[i-1] == 'HPI: fake history for bed 33.', t[i-1]
assert t[-1] == '10/16N Round trip 72.', t[-1]
assert t[-2].startswith('72 '), t[-2]
print('ok')`;
  const res = execFileSync('python3', ['-c', py, fileURLToPath(out)]).toString().trim();
  assert.equal(res, 'ok');
});
