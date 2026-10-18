// Docx bed detection and append-only insertion. No DOM globals: the caller
// passes { DOMParser, XMLSerializer } so this runs in the browser and in Node tests.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const DOC_PATH = 'word/document.xml';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const BED_MIN = 31;
export const BED_MAX = 72;
const BED_RE = /^\s*(\d{2})\s/;

const isW = (n, local) => n.nodeType === 1 && n.namespaceURI === W && n.localName === local;
const isFallback = (n) => n.nodeType === 1 && n.namespaceURI === MC && n.localName === 'Fallback';

function childW(el, local) {
  for (let c = el.firstChild; c; c = c.nextSibling) if (isW(c, local)) return c;
  return null;
}

// Paragraphs in document order, including tables and text boxes. mc:Fallback
// holds a duplicate of each modern text box, so it is skipped.
export function collectParagraphs(doc) {
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const out = [];
  (function walk(el) {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || isFallback(c)) continue;
      if (isW(c, 'p')) out.push(c);
      walk(c);
    }
  })(body);
  return out;
}

// Visible text of one paragraph, excluding deleted text and nested text boxes.
export function paraText(p) {
  let s = '';
  (function walk(el) {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || isFallback(c) || isW(c, 'txbxContent') || isW(c, 'del')) continue;
      if (isW(c, 't')) s += c.textContent;
      else if (isW(c, 'tab')) s += '\t';
      else if (isW(c, 'br')) s += '\n';
      else walk(c);
    }
  })(p);
  return s;
}

// Formatting fingerprint used only to break ties between equally long bed sequences.
function signature(p) {
  const pPr = childW(p, 'pPr');
  const style = pPr && childW(pPr, 'pStyle');
  const r = firstTextRun(p);
  const rPr = r && childW(r, 'rPr');
  const sz = rPr && childW(rPr, 'sz');
  return [
    style ? style.getAttributeNS(W, 'val') : '',
    rPr && childW(rPr, 'b') ? 'b' : '',
    sz ? sz.getAttributeNS(W, 'val') : '',
  ].join('|');
}

function firstTextRun(p) {
  let found = null;
  (function walk(el) {
    for (let c = el.firstChild; c && !found; c = c.nextSibling) {
      if (c.nodeType !== 1 || isFallback(c) || isW(c, 'txbxContent') || isW(c, 'del')) continue;
      if (isW(c, 'r')) {
        const t = childW(c, 't');
        if (t && t.textContent.trim()) found = c;
      } else walk(c);
    }
  })(p);
  return found;
}

// Bed starts are paragraphs beginning with 31-72 + whitespace, strictly ascending.
// Stray matches ("40 mg" inside bed 35) are dropped by keeping the longest
// strictly increasing subsequence; ties prefer the majority bed formatting.
export function detectBeds(doc) {
  const paras = collectParagraphs(doc);
  const texts = paras.map(paraText);
  const cands = [];
  texts.forEach((t, i) => {
    const m = BED_RE.exec(t);
    if (!m) return;
    const bed = Number(m[1]);
    if (bed >= BED_MIN && bed <= BED_MAX) cands.push({ bed, index: i, sig: signature(paras[i]) });
  });

  const counts = {};
  for (const c of cands) counts[c.sig] = (counts[c.sig] || 0) + 1;
  const major = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

  // Weighted LIS: length dominates, signature match breaks ties.
  const score = [], prev = [];
  cands.forEach((c, i) => {
    const w = 1000 + (c.sig === major ? 1 : 0);
    score[i] = w; prev[i] = -1;
    for (let j = 0; j < i; j++) {
      if (cands[j].bed < c.bed && score[j] + w > score[i]) { score[i] = score[j] + w; prev[i] = j; }
    }
  });
  let best = -1;
  score.forEach((s, i) => { if (best < 0 || s > score[best]) best = i; });
  const picked = [];
  for (let i = best; i >= 0; i = prev[i]) picked.unshift(cands[i]);

  const beds = picked.map((c, k) => {
    const end = k + 1 < picked.length ? picked[k + 1].index : paras.length;
    return { bed: c.bed, index: c.index, end, para: paras[c.index] };
  });
  const found = new Set(beds.map((b) => b.bed));
  const missing = [];
  for (let n = BED_MIN; n <= BED_MAX; n++) if (!found.has(n)) missing.push(n);
  return { paras, texts, beds, missing };
}

// Last non-empty paragraph of the block, or the bed paragraph if the block has no body.
export function anchorFor(scan, bed) {
  const b = scan.beds.find((x) => x.bed === bed);
  if (!b) throw new Error(`Bed ${bed} not found`);
  for (let i = b.end - 1; i > b.index; i--) {
    if (scan.texts[i].trim()) return { para: scan.paras[i], text: scan.texts[i], isBedLine: false };
  }
  return { para: b.para, text: scan.texts[b.index], isBedLine: true };
}

const STRIP = ['sectPr', 'pPrChange', 'rPrChange', 'ins', 'del', 'moveFrom', 'moveTo'];

function stripTracked(el) {
  for (const local of STRIP) {
    const found = el.getElementsByTagNameNS(W, local);
    for (let i = found.length - 1; i >= 0; i--) found[i].parentNode.removeChild(found[i]);
  }
  return el;
}

// Append a new paragraph after the block's anchor, copying its paragraph and run formatting.
// Returns the inserted node (for undo).
export function insertEntry(doc, scan, bed, line) {
  const { para: anchor } = anchorFor(scan, bed);
  const p = doc.createElementNS(W, 'w:p');
  const pPr = childW(anchor, 'pPr');
  if (pPr) p.appendChild(stripTracked(pPr.cloneNode(true)));

  const r = doc.createElementNS(W, 'w:r');
  const src = firstTextRun(anchor);
  const rPr = src && childW(src, 'rPr');
  if (rPr) r.appendChild(stripTracked(rPr.cloneNode(true)));
  line.split(/\r?\n/).forEach((part, i) => {
    if (i) r.appendChild(doc.createElementNS(W, 'w:br'));
    const t = doc.createElementNS(W, 'w:t');
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    t.appendChild(doc.createTextNode(part));
    r.appendChild(t);
  });
  p.appendChild(r);

  anchor.parentNode.insertBefore(p, anchor.nextSibling);
  return p;
}

export function removeEntry(node) {
  if (node.parentNode) node.parentNode.removeChild(node);
}

export async function openDocx(JSZip, data, env) {
  const zip = await JSZip.loadAsync(data);
  const file = zip.file(DOC_PATH);
  if (!file) throw new Error('Not a Word document (word/document.xml missing)');
  const xml = await file.async('string');
  const doc = new env.DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not parse document.xml');
  return { zip, doc };
}

// type: 'blob' in the browser, 'nodebuffer' in Node.
export async function buildDocx(zip, doc, env, type = 'blob') {
  zip.file(DOC_PATH, new env.XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type, mimeType: DOCX_MIME, compression: 'DEFLATE' });
}

export { DOCX_MIME };
