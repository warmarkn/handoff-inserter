import { openDocx, buildDocx, detectBeds, anchorFor, insertEntry, removeEntry, paraText, DOCX_MIME } from './core.js';
import { shiftFor, formatTag, toISODate, fromISODate, exportName } from './tag.js';
/* global JSZip */

const env = { DOMParser, XMLSerializer };
const $ = (id) => document.getElementById(id);

// Session: original bytes + the entries replayed onto them. `nodes` parallels `entries` for undo.
let S = null;
let currentBed = null;
let override = null; // { date: Date, letter } while backfilling; null = use the clock

// ---------- persistence (IndexedDB) ----------
const DB_NAME = 'handoff', STORE = 'session', KEY = 'current';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbOp(mode, fn) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('storage unavailable', e);
    return undefined;
  }
}

const loadSaved = () => dbOp('readonly', (s) => s.get(KEY));
const clearSaved = () => dbOp('readwrite', (s) => s.delete(KEY));

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!S) return;
    dbOp('readwrite', (s) => s.put({
      name: S.name, bytes: S.bytes, entries: S.entries, drafts: S.drafts, exported: S.exported, savedAt: Date.now(),
    }, KEY));
  }, 250);
}

// ---------- session ----------
async function startSession(name, bytes, entries = [], drafts = {}, exported = true) {
  const { zip, doc } = await openDocx(JSZip, bytes, env);
  const s = { name, bytes, zip, doc, entries: [], nodes: [], drafts, exported, scan: detectBeds(doc), rev: 0, blob: null };
  if (!s.scan.beds.length) throw new Error('No bed lines (31–72) found in this document.');
  for (const e of entries) {
    s.nodes.push(insertEntry(doc, s.scan, e.bed, e.line));
    s.entries.push(e);
    s.scan = detectBeds(doc);
  }
  S = s;
  changed();
}

// Export blob is prebuilt after every change so the Export tap can call
// navigator.share immediately (iOS rejects share() after a slow await).
function changed() {
  const s = S, rev = ++s.rev;
  s.blob = null;
  buildDocx(s.zip, s.doc, env, 'blob').then((b) => { if (s.rev === rev) s.blob = b; });
  save();
}

function addEntry(bed, line) {
  S.nodes.push(insertEntry(S.doc, S.scan, bed, line));
  S.entries.push({ bed, line });
  S.scan = detectBeds(S.doc);
  S.exported = false;
  delete S.drafts[bed];
  changed();
}

function undoLast() {
  const node = S.nodes.pop();
  const e = S.entries.pop();
  if (!node) return;
  removeEntry(node);
  S.scan = detectBeds(S.doc);
  S.exported = S.entries.length === 0;
  changed();
  toast(`Removed from bed ${e.bed}: ${e.line}`);
}

function entriesFor(bed) {
  return S.entries.filter((e) => e.bed === bed);
}

// ---------- tag ----------
function currentShift() {
  return override || shiftFor(new Date());
}

function currentTag() {
  const s = currentShift();
  return formatTag(s.date, s.letter);
}

// ---------- UI: home ----------
function show(screen) {
  $('home').hidden = screen !== 'home';
  $('bed').hidden = screen !== 'bed';
  $('homeBar').hidden = screen !== 'home' || !S;
  window.scrollTo(0, 0);
}

function renderHome() {
  $('start').hidden = !!S;
  $('loaded').hidden = !S;
  $('error').hidden = true;
  if (!S) { show('home'); return; }

  $('filename').textContent = S.name;
  const beds = S.scan.beds.map((b) => b.bed);
  const done = beds.filter((b) => entriesFor(b).length).length;
  $('summary').innerHTML = '';
  $('summary').append(
    pill('done', `${done} updated`),
    pill('todo', `${beds.length - done} not updated`),
  );
  if (S.scan.missing.length) $('summary').append(pill('miss', `${S.scan.missing.length} missing`));

  const grid = $('grid');
  grid.innerHTML = '';
  for (const b of beds) {
    const n = entriesFor(b).length;
    const btn = document.createElement('button');
    btn.className = 'bed' + (n ? ' done' : '');
    btn.textContent = b;
    btn.dataset.bed = b;
    btn.setAttribute('aria-label', `Bed ${b}, ${n ? `${n} entr${n > 1 ? 'ies' : 'y'}` : 'not updated'}`);
    if (n) {
      const m = document.createElement('span');
      m.className = 'mark';
      m.textContent = n > 1 ? `✓${n}` : '✓';
      btn.append(m);
    }
    btn.onclick = () => openBed(b);
    grid.append(btn);
  }

  $('missing').hidden = !S.scan.missing.length;
  $('missingChips').innerHTML = '';
  for (const m of S.scan.missing) {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = m;
    $('missingChips').append(c);
  }

  const last = S.entries[S.entries.length - 1];
  $('undo').disabled = !last;
  $('undo').textContent = last ? `Undo (bed ${last.bed})` : 'Undo';
  $('export').disabled = !S.entries.length;
  show('home');
}

function pill(cls, text) {
  const s = document.createElement('span');
  s.className = `pill ${cls}`;
  s.textContent = text;
  return s;
}

async function renderStart() {
  const saved = await loadSaved();
  const btn = $('resume');
  btn.hidden = !saved;
  if (saved) {
    const n = saved.entries.length;
    const when = new Date(saved.savedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    btn.textContent = `Resume ${saved.name} (${n} entr${n === 1 ? 'y' : 'ies'}, ${when})`;
    btn.onclick = () => run(async () => {
      await startSession(saved.name, saved.bytes, saved.entries, saved.drafts || {}, saved.exported);
      renderHome();
    });
  }
}

// ---------- UI: bed ----------
function openBed(bed) {
  currentBed = bed;
  const b = S.scan.beds.find((x) => x.bed === bed);
  $('bedTitle').textContent = `Bed ${bed}`;
  $('bedLine').textContent = paraText(b.para);
  $('text').value = S.drafts[bed] || '';
  $('overridePanel').hidden = !override;
  renderBed();
  show('bed');
  $('text').focus(); // inside the tap handler, so iOS raises the keyboard
}

function renderBed() {
  const tag = currentTag();
  $('tag').textContent = tag;
  $('tag').classList.toggle('override', !!override);
  $('tagEdit').textContent = override ? 'Override on' : 'Change';
  const s = currentShift();
  $('ovDate').value = toISODate(s.date);
  $('ovD').setAttribute('aria-pressed', s.letter === 'D');
  $('ovN').setAttribute('aria-pressed', s.letter === 'N');

  const anchor = anchorFor(S.scan, currentBed);
  $('prevLine').textContent = anchor.text;
  const text = $('text').value.trim();
  $('newLine').textContent = text ? `${tag} ${text}` : `${tag} …`;
  $('insert').disabled = !text;

  const list = entriesFor(currentBed);
  $('addedCard').hidden = !list.length;
  $('added').innerHTML = '';
  for (const e of list) {
    const li = document.createElement('li');
    li.textContent = e.line;
    $('added').append(li);
  }
}

function setOverride(date, letter) {
  override = { date, letter };
  renderBed();
}

// ---------- export ----------
async function exportDoc() {
  const blob = S.blob || await buildDocx(S.zip, S.doc, env, 'blob');
  const name = exportName(new Date());
  const file = new File([blob], name, { type: DOCX_MIME });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotAllowedError') { S.blob = blob; toast('Ready. Tap Export again.'); return; }
      throw e;
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  S.exported = true;
  save();
  toast(`Exported ${name}. Open it and check before relying on it.`);
}

// ---------- helpers ----------
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

async function run(fn) {
  try {
    await fn();
  } catch (e) {
    console.error(e);
    $('error').textContent = e.message || String(e);
    $('error').hidden = false;
    show('home');
  }
}

function confirmDiscard() {
  return !S || S.exported || confirm('You have entries that have not been exported. Discard them?');
}

// ---------- wiring ----------
$('open').onclick = () => $('file').click();
$('openOther').onclick = () => { if (confirmDiscard()) $('file').click(); };
$('file').onchange = () => run(async () => {
  const f = $('file').files[0];
  $('file').value = '';
  if (!f) return;
  const bytes = await f.arrayBuffer();
  await startSession(f.name, bytes);
  renderHome();
});

$('clearAll').onclick = () => run(async () => {
  if (!confirmDiscard()) return;
  S = null;
  override = null;
  await clearSaved();
  await renderStart();
  renderHome();
  toast('Cleared from this device.');
});

$('undo').onclick = () => { undoLast(); renderHome(); };
$('export').onclick = () => run(exportDoc);

$('back').onclick = () => renderHome();
$('text').oninput = () => {
  const v = $('text').value;
  if (v.trim()) S.drafts[currentBed] = v; else delete S.drafts[currentBed];
  save();
  renderBed();
};
$('insert').onclick = () => {
  const text = $('text').value.trim();
  if (!text) return;
  addEntry(currentBed, `${currentTag()} ${text}`);
  toast(`Added to bed ${currentBed}`);
  renderHome();
};

$('tagEdit').onclick = () => {
  $('overridePanel').hidden = !$('overridePanel').hidden;
};
$('ovDate').onchange = () => {
  if ($('ovDate').value) setOverride(fromISODate($('ovDate').value), currentShift().letter);
};
$('ovD').onclick = () => setOverride(currentShift().date, 'D');
$('ovN').onclick = () => setOverride(currentShift().date, 'N');
$('ovReset').onclick = () => { override = null; $('overridePanel').hidden = true; renderBed(); };

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
}

renderHome();
renderStart();
