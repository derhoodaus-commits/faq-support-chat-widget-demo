// Static GitHub Pages build: same answers as the server's demo mode, and no broken internal links under the sub-path.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPages } from '../scripts/build-pages.js';
import { createServer } from '../server/index.js';

const BASE = '/faq-support-chat-widget-demo/';
const cases = JSON.parse(readFileSync(new URL('./search-cases.json', import.meta.url), 'utf8'));
const EXTRA = [
  'What will the weather be like tomorrow?', 'What is the capital of France?', 'Are you hiring? Any jobs?', 'I want to buy a car',
  'asdf qwer', '???', 'shiping costs', 'returnlabel printing', 'trackinglink', 'Can I pay by invoice?', 'Where can I find the invoice?',
  "My package hasn't arrived yet", 'I want to talk to a human', 'Thanks!', 'Hello', 'Hi, how much is shipping?', 'Is a Monstera safe for my cat?',
];
const silent = { warn() {}, error() {}, log() {} };
let dir, out, engine, staticFaq, index;
const servers = [];

// The server rate-limits /api/chat (40 per IP in 5 minutes), so each block of 30 questions gets a fresh server
async function startServer() {
  const s = createServer({ dataDir: path.join(dir, 'data'), env: { CHAT_MODE: 'demo' }, logger: silent });
  await new Promise((r) => s.listen(0, r));
  servers.push(s);
  return `http://127.0.0.1:${s.address().port}`;
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'pages-'));
  out = path.join(dir, 'site');
  buildPages({ outDir: out, siteUrl: `https://example.github.io${BASE}` });
  engine = await import(pathToFileURL(path.join(out, 'engine', 'answer.js')).href);
  staticFaq = JSON.parse(readFileSync(path.join(out, 'faq.json'), 'utf8'));
  index = engine.buildIndex(staticFaq.entries);
});
after(() => { servers.forEach((s) => s.close()); rmSync(dir, { recursive: true, force: true }); });

const ids = (list) => (list || []).map((s) => s.id);
const comparable = (r) => ({ kind: r.kind, text: r.text, mode: r.mode, sources: ids(r.sources), related: ids(r.related) });

test(`static search gives the same replies as the server's demo mode (${cases.length + EXTRA.length} questions)`, async () => {
  const diffs = [];
  let api;
  for (const [i, q] of [...cases.map(([question]) => question), ...EXTRA].entries()) {
    if (i % 30 === 0) api = await startServer();
    const fromServer = await (await fetch(api + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q }) })).json();
    const fromStatic = engine.demoReply(index, q);
    try { assert.deepEqual(comparable(fromStatic), comparable(fromServer)); } catch { diffs.push(q); }
  }
  assert.deepEqual(diffs, []);
});

test('static search lands on the expected entry for every test question, with a source link to faq.html', () => {
  for (const [q, expected] of cases) {
    const r = engine.demoReply(index, q);
    assert.equal(r.kind, 'answer', q);
    assert.equal(r.sources[0].id, expected, q);
    assert.equal(r.sources[0].url, `faq.html#${expected}`, q);
  }
  assert.equal(engine.demoReply(index, 'What will the weather be like tomorrow?').kind, 'unsure');
  assert.equal(engine.demoReply(index, 'I want to talk to a human').kind, 'handoff');
});

test('static config matches the server config (except the mode)', async () => {
  const fromServer = await (await fetch((await startServer()) + '/api/config')).json();
  assert.deepEqual({ ...engine.configFromFaq(staticFaq, 'static'), mode: 'demo' }, fromServer);
});

test('engine files are the server modules, unchanged', () => {
  for (const f of ['answer.js', 'search.js']) {
    assert.equal(readFileSync(path.join(out, 'engine', f), 'utf8'), readFileSync(new URL(`../server/${f}`, import.meta.url), 'utf8'), f);
  }
});

function walk(d) {
  return readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
}
const fileFor = (pathname) => {
  const rel = decodeURIComponent(pathname.slice(BASE.length));
  return path.join(out, rel === '' || rel.endsWith('/') ? rel + 'index.html' : rel);
};

test('build output: required files, no root-relative or API URLs, no broken internal references under the sub-path', () => {
  for (const f of ['index.html', 'foreign-site.html', 'faq.html', '404.html', 'widget.js', 'faq.json', '.nojekyll', 'engine/answer.js', 'engine/search.js']) {
    assert.ok(existsSync(path.join(out, f)), `missing ${f}`);
  }
  const broken = [];
  const pages = walk(out).filter((f) => f.endsWith('.html'));
  for (const file of pages) {
    const rel = path.relative(out, file).split(path.sep).join('/');
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /\/api\//, `${rel} mentions /api/`);
    assert.doesNotMatch(html, /<script[^>]*src="\/widget\.js"/, `${rel} uses /widget.js`);
    // 404.html is served by Pages at any depth, so it uses absolute paths that include the sub-path
    const pageUrl = rel === '404.html' ? `http://pages.test${BASE}some/missing/page` : `http://pages.test${BASE}${rel}`;
    for (const [, attr, value] of html.matchAll(/\s(href|src|data-faq-url)="([^"]*)"/g)) {
      if (/^(data:|mailto:|https?:)/.test(value)) continue;
      if (value.startsWith('/') && !value.startsWith(BASE)) { broken.push(`${rel}: ${attr}="${value}" is root-relative`); continue; }
      if (value.startsWith('/') && rel !== '404.html') { broken.push(`${rel}: ${attr}="${value}" should be relative`); continue; }
      const u = new URL(value, pageUrl);
      if (!u.pathname.startsWith(BASE)) { broken.push(`${rel}: ${value} leaves ${BASE}`); continue; }
      const target = fileFor(u.pathname);
      if (!existsSync(target)) { broken.push(`${rel}: ${value} → missing ${path.relative(out, target)}`); continue; }
      if (u.hash && !readFileSync(target, 'utf8').includes(`id="${u.hash.slice(1)}"`)) broken.push(`${rel}: ${value} → anchor not found`);
    }
  }
  // Source links in the static FAQ resolve to existing anchors on faq.html
  const faqHtml = readFileSync(path.join(out, 'faq.html'), 'utf8');
  for (const e of staticFaq.entries) {
    const u = new URL(e.url, `http://pages.test${BASE}faq.json`);
    if (u.pathname !== `${BASE}faq.html` || !faqHtml.includes(`id="${u.hash.slice(1)}"`)) broken.push(`faq.json: ${e.id} → ${e.url}`);
  }
  // What the widget loads in static mode (relative to widget.js), and the engine's own import
  const widget = readFileSync(path.join(out, 'widget.js'), 'utf8');
  assert.match(widget, /new URL\('engine\/answer\.js', BASE\)/);
  assert.match(widget, /new URL\('faq\.json', BASE\)/);
  for (const [, spec] of readFileSync(path.join(out, 'engine', 'answer.js'), 'utf8').matchAll(/from '([^']+)'/g)) {
    if (!existsSync(path.join(out, 'engine', spec))) broken.push(`engine/answer.js imports missing ${spec}`);
  }
  assert.deepEqual(broken, []);
  assert.ok(pages.length >= 4);
});

test('landing page says it is a demo and shows the static embed snippet', () => {
  const html = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /Demo project\./);
  assert.match(html, /demo mode<\/strong>: FAQ keyword search in your browser, no AI key, and no messages are sent/);
  assert.match(html, /Embed this widget/);
  assert.match(html, /&lt;script src="https:\/\/example\.github\.io\/faq-support-chat-widget-demo\/widget\.js" data-mode="static" defer&gt;/);
  assert.match(html, /<script src="widget\.js" data-mode="static" defer><\/script>/);
});
