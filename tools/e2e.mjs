// End-to-end check of docs/index.html in headless Chrome with iPhone emulation.
// Loads the synthetic fixture, inserts entries, undoes, exports, resumes after reload,
// then verifies the exported .docx with python-docx.
import http from 'node:http';
import { readFile, mkdir, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer, { KnownDevices } from 'puppeteer-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = path.join(root, 'docs');
const fixture = path.join(root, 'fixtures/synthetic-handoff.docx');
const dl = path.join(root, 'fixtures/out/e2e');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const p = path.join(docs, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

await rm(dl, { recursive: true, force: true });
await mkdir(dl, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const problems = [];
const check = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`ok - ${msg}`); };

try {
  const page = await browser.newPage();
  await page.emulate(KnownDevices['iPhone 15 Pro']);
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  // Desktop Chrome has no file share sheet; force the download fallback.
  await page.evaluateOnNewDocument(() => { delete Navigator.prototype.canShare; });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });

  await page.goto(url);
  const input = await page.$('#file');
  await input.uploadFile(fixture);
  await page.waitForSelector('#grid .bed');

  const beds = await page.$$eval('#grid .bed', (els) => els.map((e) => e.firstChild.textContent));
  check(beds.length === 41 && beds[0] === '31' && beds.at(-1) === '72', `41 beds 31..72 detected (${beds.length})`);
  check(await page.$eval('#missingChips', (e) => e.textContent) === '44', 'bed 44 flagged missing');

  const tapBed = async (n) => {
    const sel = `#grid .bed[data-bed="${n}"]`;
    await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
    await page.tap(sel);
    await page.waitForSelector('#bed:not([hidden])');
  };

  await tapBed(33);
  await page.waitForSelector('#bed:not([hidden])');
  check(await page.$eval('#prevLine', (e) => e.textContent) === 'HPI: fake history for bed 33.', 'preview shows last body line');
  await page.type('#text', 'Extubated, tolerating RA.');
  const preview = await page.$eval('#newLine', (e) => e.textContent);
  check(/^\d{1,2}\/\d{1,2}[DN] Extubated, tolerating RA\.$/.test(preview), `preview line "${preview}"`);
  await page.tap('#insert');
  await page.waitForSelector('#home:not([hidden])');
  check(await page.$$eval('#grid .bed.done', (e) => e.length) === 1, 'bed 33 marked updated');

  // Override tag for a backfill on bed 72 (last paragraph).
  await tapBed(72);
  await page.tap('#tagEdit');
  await page.$eval('#ovDate', (e) => { e.value = '2026-10-06'; e.dispatchEvent(new Event('change')); });
  await page.tap('#ovN');
  check(await page.$eval('#tag', (e) => e.textContent) === '10/6N', 'tag override 10/6N');
  await page.type('#text', 'Backfilled note.');
  await page.tap('#insert');
  await page.waitForSelector('#home:not([hidden])');

  // Insert then undo on bed 52 (table).
  await tapBed(52);
  await page.type('#text', 'Will be undone');
  await page.tap('#insert');
  await page.waitForSelector('#home:not([hidden])');
  check((await page.$eval('#undo', (e) => e.textContent)) === 'Undo (bed 52)', 'undo labelled with bed');
  await page.tap('#undo');
  check(await page.$$eval('#grid .bed.done', (e) => e.length) === 2, 'undo removed bed 52 entry');

  // Draft persists, then reload and resume.
  await tapBed(45);
  await page.type('#text', 'draft text');
  await new Promise((r) => setTimeout(r, 600));
  await page.reload();
  await page.waitForSelector('#resume:not([hidden])');
  check(/Resume synthetic-handoff\.docx \(2 entries/.test(await page.$eval('#resume', (e) => e.textContent)), 'resume offered with 2 entries');
  await page.tap('#resume');
  await page.waitForSelector('#grid .bed');
  check(await page.$$eval('#grid .bed.done', (e) => e.length) === 2, 'resume restored 2 updated beds');
  await tapBed(45);
  check(await page.$eval('#text', (e) => e.value) === 'draft text', 'draft restored');
  await page.tap('#back');

  await new Promise((r) => setTimeout(r, 300));
  await page.tap('#export');
  let file;
  for (let i = 0; i < 50 && !file; i++) {
    await new Promise((r) => setTimeout(r, 100));
    file = (await readdir(dl)).find((f) => f.endsWith('.docx'));
  }
  check(file && /^Handoff \d{1,2}-\d{1,2}[DN] \d{4}\.docx$/.test(file), `exported "${file}"`);

  const py = `
import sys, docx
d = docx.Document(sys.argv[1])
t = [p.text for p in d.paragraphs]
i = next(i for i, x in enumerate(t) if x.endswith(' Extubated, tolerating RA.'))
assert t[i-1] == 'HPI: fake history for bed 33.', t[i-1]
assert t[-1] == '10/6N Backfilled note.', t[-1]
cells = [p.text for tb in d.tables for r in tb.rows for c in r.cells for p in c.paragraphs]
assert not any('Will be undone' in x for x in cells)
print('ok')`;
  check(execFileSync('python3', ['-c', py, path.join(dl, file)]).toString().trim() === 'ok', 'exported docx verified with python-docx');

  await page.tap('#clearAll');
  await page.waitForSelector('#start:not([hidden])');
  check(await page.$eval('#resume', (e) => e.hidden), 'clear all removes saved session');

  check(problems.length === 0, `no console errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.close();
}
