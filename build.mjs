// Inlines JSZip + src/* into docs/index.html and stamps the service worker version.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

// Turn an ES module into a scoped block: `const { a, b } = (() => { ...; return { a, b }; })();`
function inlineModule(src) {
  const names = [];
  const body = src
    .replace(/^import .*$/gm, '')
    .replace(/^export \{([^}]+)\};?$/gm, (_, list) => { names.push(...list.split(',').map((s) => s.trim())); return ''; })
    .replace(/^export (async function|function|const|let) (\w+)/gm, (_, kw, name) => { names.push(name); return `${kw} ${name}`; });
  return `const { ${names.join(', ')} } = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();`;
}

const [jszip, tag, core, app, css, html, sw] = await Promise.all([
  read('node_modules/jszip/dist/jszip.min.js'),
  read('src/tag.js'),
  read('src/core.js'),
  read('src/app.js'),
  read('src/app.css'),
  read('src/index.template.html'),
  read('src/sw.js'),
]);

const js = [
  jszip,
  '"use strict";',
  inlineModule(tag),
  inlineModule(core),
  `(() => {\n${app.replace(/^import .*$/gm, '')}\n})();`,
].join('\n');

// Literal "</script" inside the inlined code would close the tag early.
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const out = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => safeJs);
await writeFile(new URL('docs/index.html', import.meta.url), out);

const version = createHash('sha256').update(out).digest('hex').slice(0, 12);
await writeFile(new URL('docs/sw.js', import.meta.url), sw.replace('__VERSION__', version));
console.log(`docs/index.html ${(out.length / 1024).toFixed(0)} KB, sw ${version}`);
