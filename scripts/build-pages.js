// Static build for GitHub Pages (no server, no API, no keys): npm run build:pages → dist-pages/  [--out <dir>]
//
// Output (all URLs relative, so it works under any sub-path such as /faq-support-chat-widget-demo/):
//   index.html         demo shop (landing page), widget in static mode
//   foreign-site.html  embed test on a page with "hostile" CSS
//   faq.html           all FAQ entries (the target of the source links in the chat)
//   404.html           styled "not found" page (absolute links with the base path, as Pages serves it at any depth)
//   widget.js          the same widget file the server serves
//   engine/*.js        server/answer.js + server/search.js, unchanged ES modules (same answers as server demo mode)
//   faq.json           FAQ with source links pointing to faq.html#<id>
//   .nojekyll
//
// Options via environment: PAGES_URL (public URL, shown in the embed snippet) and PAGES_BASE (sub-path for 404.html).
import { mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateEntries } from '../server/faq.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SITE_URL = 'https://derhoodaus-commits.github.io/faq-support-chat-widget-demo/';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Replaces exactly one occurrence; fails loudly if the source page changed and the marker is gone. */
function replaceOnce(html, search, replacement, what) {
  const count = html.split(search).length - 1;
  if (count !== 1) throw new Error(`build:pages: expected exactly one ${what}, found ${count}.`);
  return html.replace(search, () => replacement);
}
function replaceBlock(html, name, replacement) {
  const re = new RegExp(`<!-- build:${name}\\b[^>]*-->[\\s\\S]*?<!-- /build:${name} -->`);
  if (!re.test(html)) throw new Error(`build:pages: marker "build:${name}" not found.`);
  return html.replace(re, () => replacement);
}

const STATIC_TAG = '<script src="widget.js" data-mode="static" defer></script>';

function shopPage(siteUrl) {
  let html = readFileSync(path.join(root, 'demo', 'index.html'), 'utf8');
  html = replaceOnce(html, '<title>Farnhaus Plants – demo shop with help widget</title>', '<title>Farnhaus Plants – help chat widget demo</title>', 'page title');
  html = replaceBlock(html, 'notice', `<div class="demo-bar" role="note"><div class="wrap"><strong>Demo project.</strong> Farnhaus Plants is a fictional shop. The chat runs in <strong>demo mode</strong>: FAQ keyword search in your browser, no AI key, and no messages are sent anywhere.</div></div>`);
  html = replaceBlock(html, 'embed', `<div class="embed">
        <h2 id="embed-h">Embed this widget</h2>
        <p>One line before the closing <code>&lt;/body&gt;</code> tag adds this chat to any website (WordPress, Shopify, Wix, plain HTML):</p>
        <pre><code>&lt;script src="${esc(siteUrl)}widget.js" data-mode="static" defer&gt;&lt;/script&gt;</code></pre>
        <p><code>data-mode="static"</code> answers in the browser from <code>faq.json</code> next to <code>widget.js</code> (or your own file via <code>data-faq-url</code>). With the Node server the line is simply <code>&lt;script src="https://help.your-company.com/widget.js" defer&gt;&lt;/script&gt;</code> and adds the optional Claude mode and real e-mail handoff.</p>
        <p>Optional: <code>data-color="#1d5c45"</code> for your brand color, <code>data-position="left"</code> for the bottom-left corner, <code>data-open="true"</code> to open the chat right away.</p>
        <p><a href="faq.html">All FAQ entries the chat answers from</a> · <a href="foreign-site.html">The widget on a page with hostile CSS</a></p>
      </div>`);
  html = replaceOnce(html, '<script src="/widget.js" defer></script>', STATIC_TAG, 'widget script tag in demo/index.html');
  return html;
}

function foreignPage() {
  const html = readFileSync(path.join(root, 'demo', 'foreign-site.html'), 'utf8');
  return replaceOnce(html, '<script src="/widget.js" ', '<script src="widget.js" data-mode="static" ', 'widget script tag in demo/foreign-site.html');
}

const PAGE_CSS = `
    :root { --green: #1d5c45; --ink: #17211c; --muted: #4f5a54; --paper: #f6f3ec; --card: #fffdf8; --line: #e2dccf; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 17px/1.6 Georgia, 'Iowan Old Style', 'Palatino Linotype', serif; color: var(--ink); background: var(--paper); }
    .wrap { max-width: 52rem; margin: 0 auto; padding: 0 1rem; }
    @media (min-width: 48em) { .wrap { padding: 0 2rem; } }
    a { color: var(--green); }
    :focus-visible { outline: 3px solid #1a5fd0; outline-offset: 2px; }
    .demo-bar { background: var(--ink); color: #f1f5f2; font: .9rem/1.45 system-ui, sans-serif; padding: .55rem 0; }
    .demo-bar strong { color: #fff; }
    header.top { border-bottom: 1px solid var(--line); background: var(--card); }
    .bar { display: flex; align-items: center; justify-content: space-between; min-height: 4rem; gap: 1rem; }
    .logo { font-size: 1.4rem; font-weight: 700; color: var(--ink); text-decoration: none; display: inline-flex; align-items: center; gap: .5rem; min-height: 2.75rem; }
    .logo svg { width: 28px; height: 28px; color: var(--green); }
    h1 { font-size: clamp(2rem, 5vw, 3rem); line-height: 1.1; margin: 2.5rem 0 1rem; letter-spacing: -.02em; }
    h2 { font-size: 1.4rem; margin: 2.5rem 0 1rem; }
    .lead { color: var(--muted); font-size: 1.1rem; }
    .btn { display: inline-flex; align-items: center; min-height: 3rem; padding: .7rem 1.4rem; border-radius: 999px; background: var(--green); color: #fff; text-decoration: none; font-family: system-ui, sans-serif; font-weight: 600; }
    .btn:hover { background: #154634; }
    footer { border-top: 1px solid var(--line); margin-top: 4rem; padding: 2rem 0; font-family: system-ui, sans-serif; font-size: .9rem; color: var(--muted); }`;
const FAVICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%231d5c45'/%3E%3Cpath d='M17 6c-6 0-9 3-9 7.5 0 1.2.3 2.2.9 3.1L7 18.5l.8.8 1.7-1.7c.9.6 1.9.9 3 .9 4.5 0 6.4-4.5 4.5-12.5z' fill='%23fff'/%3E%3C/svg%3E">`;
const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4c-8 0-13 4-13 10 0 1.6.4 3 1.2 4.2L5 20.5l1.1 1.1 2.3-2.3c1.2.8 2.6 1.2 4.1 1.2 6 0 8.5-6 6.5-16.5zM9 17c2-4 4.5-6.5 8-8.5-2.8 2.6-5 5.4-6.6 9z" fill="currentColor"/></svg>`;

function page({ title, home, extraCss = '', body, scripts = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  ${FAVICON}
  <style>${PAGE_CSS}${extraCss}
  </style>
</head>
<body>
  <div class="demo-bar" role="note"><div class="wrap"><strong>Demo project.</strong> Farnhaus Plants is a fictional shop; the chat runs in demo mode and sends nothing.</div></div>
  <header class="top"><div class="wrap bar"><a class="logo" href="${esc(home)}">${LOGO} Farnhaus</a></div></header>
  <main id="content" class="wrap">
${body}
  </main>
  <footer><div class="wrap"><strong>Demo project.</strong> Farnhaus Plants is a fictional company; products, prices, and the FAQ are examples.</div></footer>
${scripts}</body>
</html>
`;
}

function faqPage(faq) {
  const byCat = new Map();
  for (const e of faq.entries) byCat.set(e.category, [...(byCat.get(e.category) || []), e]);
  const sections = [...byCat].map(([cat, list]) => `    <h2>${esc(cat)}</h2>
${list.map((e) => `    <article class="q" id="${esc(e.id)}"><h3>${esc(e.question)}</h3><p>${esc(e.answer)}</p></article>`).join('\n')}`).join('\n');
  return page({
    title: 'Farnhaus Plants – Help & FAQ (demo)',
    home: './',
    extraCss: `
    .q { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 1rem 1.25rem; margin: 0 0 .75rem; scroll-margin-top: 1rem; }
    .q h3 { margin: 0 0 .35rem; font-size: 1.05rem; font-family: system-ui, sans-serif; }
    .q p { margin: 0; color: var(--muted); }
    .q:target { border-color: var(--green); box-shadow: 0 0 0 3px rgb(29 92 69 / .25); }`,
    body: `    <h1>Help &amp; FAQ</h1>
    <p class="lead">Every answer the help chat gives comes from one of these entries. <a href="./">Back to the shop</a></p>
${sections}`,
    scripts: `  ${STATIC_TAG}\n`,
  });
}

function notFoundPage(basePath) {
  return page({
    title: 'Page not found – Farnhaus Plants (demo)',
    home: basePath,
    body: `    <h1>This page doesn't exist.</h1>
    <p class="lead">The link may be outdated, or the address has a typo. The demo shop and its help chat are one click away.</p>
    <p><a class="btn" href="${esc(basePath)}">Go to the demo shop</a></p>
    <p><a href="${esc(basePath)}faq.html">Help &amp; FAQ</a> · <a href="${esc(basePath)}foreign-site.html">Widget on a foreign site</a></p>`,
  });
}

export function buildPages({
  outDir = path.join(root, 'dist-pages'),
  siteUrl = process.env.PAGES_URL || DEFAULT_SITE_URL,
  basePath = process.env.PAGES_BASE || new URL(siteUrl).pathname,
} = {}) {
  if (!siteUrl.endsWith('/')) siteUrl += '/';
  if (!basePath.endsWith('/')) basePath += '/';
  const faq = JSON.parse(readFileSync(path.join(root, 'faq', 'faq.json'), 'utf8'));
  validateEntries(faq.entries);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, 'engine'), { recursive: true });
  const write = (rel, content) => writeFileSync(path.join(outDir, rel), content);

  // Source links point to the FAQ page in the build (the example shop URLs don't exist)
  const staticFaq = { ...faq, entries: faq.entries.map((e) => ({ ...e, url: `faq.html#${e.id}` })) };
  write('faq.json', JSON.stringify(staticFaq));
  copyFileSync(path.join(root, 'widget', 'widget.js'), path.join(outDir, 'widget.js'));
  copyFileSync(path.join(root, 'server', 'answer.js'), path.join(outDir, 'engine', 'answer.js'));
  copyFileSync(path.join(root, 'server', 'search.js'), path.join(outDir, 'engine', 'search.js'));
  write('index.html', shopPage(siteUrl));
  write('foreign-site.html', foreignPage());
  write('faq.html', faqPage(faq));
  write('404.html', notFoundPage(basePath));
  write('.nojekyll', '');
  return { outDir, siteUrl, basePath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--out'); // optional: --out <dir> (used by the browser test)
  const { outDir, siteUrl } = buildPages(i > 0 ? { outDir: path.resolve(process.argv[i + 1]) } : {});
  console.log(`Static demo built → ${path.relative(root, outDir)}/  (public URL: ${siteUrl})`);
}
