// Chat widget server: serves widget.js and the demo pages, and answers /api/*.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, search } from './search.js';
import { configFromFaq, smalltalkReply, keywordReply, toSource } from './answer.js';
import { createFaqStore } from './faq.js';
import { createClaudeAnswerer } from './claude.js';
import { createHandoffService, validateHandoff } from './handoff.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

export function createServer({
  faqFile = path.join(root, 'faq', 'faq.json'),
  dataDir = path.join(root, 'data'),
  env = process.env,
  claudeAnswerer,
  mailTransport,
  logger = console,
} = {}) {
  const getFaq = createFaqStore(faqFile);
  let indexFor = null;
  let indexCache = null;
  const getIndex = () => {
    const faq = getFaq();
    if (indexFor !== faq) {
      indexCache = buildIndex(faq.entries);
      indexFor = faq;
    }
    return indexCache;
  };

  const forceDemo = env.CHAT_MODE === 'demo';
  const answerWithClaude = forceDemo ? null : claudeAnswerer ?? (env.ANTHROPIC_API_KEY ? createClaudeAnswerer({ model: env.ANTHROPIC_MODEL || undefined, logger }) : null);
  const mode = answerWithClaude ? 'claude' : 'demo';
  const handoff = createHandoffService({ dataDir, transport: mailTransport, env, companyName: getFaq().company.name });
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);

  const hits = new Map();
  const limited = (ip, max) => {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < 5 * 60_000);
    list.push(now);
    hits.set(ip, list);
    return list.length > max;
  };

  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (allowed.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
    else if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else return false;
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };

  async function readJson(req) {
    if (!(req.headers['content-type'] || '').includes('application/json')) throw Object.assign(new Error('Please send JSON.'), { status: 415 });
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 64_000) throw Object.assign(new Error('Request too large.'), { status: 413 });
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
    }
  }

  async function chat(body) {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw Object.assign(new Error('Message is missing.'), { status: 400 });
    if (message.length > 500) throw Object.assign(new Error('Please keep it under 500 characters.'), { status: 400 });

    const small = smalltalkReply(message, mode);
    if (small) return small;

    const faq = getFaq();
    const found = search(getIndex(), message);

    if (answerWithClaude) {
      const ai = await answerWithClaude({ question: message, history: body.history, entries: faq.entries, candidates: found.results.map((r) => r.entry) });
      if (ai) {
        const byId = new Map(faq.entries.map((e) => [e.id, e]));
        const sources = ai.sourceIds.map((id) => byId.get(id)).filter(Boolean).map(toSource);
        return { kind: sources.length ? 'answer' : 'unsure', text: ai.text, sources, mode: 'claude' };
      }
      // otherwise: fall back to keyword search
    }
    return keywordReply(getIndex(), message, found);
  }

  async function serveFile(res, file, cache = 'no-cache') {
    if (!existsSync(file)) return false;
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(file));
    return true;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const ip = req.socket.remoteAddress;
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!cors(req, res)) return json(res, 403, { error: 'This website is not allowed to use the widget.' });
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          return res.end();
        }
        if (url.pathname === '/api/config' && req.method === 'GET') {
          return json(res, 200, configFromFaq(getFaq(), mode));
        }
        if (url.pathname === '/api/chat' && req.method === 'POST') {
          if (limited(ip + ':chat', 40)) return json(res, 429, { error: 'Too many messages. Please wait a moment.' });
          return json(res, 200, await chat(await readJson(req)));
        }
        if (url.pathname === '/api/handoff' && req.method === 'POST') {
          if (limited(ip + ':handoff', 5)) return json(res, 429, { error: 'Too many requests. Please try again later.' });
          const { ok, errors, value } = validateHandoff(await readJson(req));
          if (!ok) return json(res, 422, { error: 'Please check your details.', errors });
          const result = await handoff.submit(value);
          return json(res, 201, result);
        }
        return json(res, ['/api/config', '/api/chat', '/api/handoff'].includes(url.pathname) ? 405 : 404, { error: 'Not found or method not allowed.' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        return res.end();
      }
      if (url.pathname === '/widget.js') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return void (await serveFile(res, path.join(root, 'widget', 'widget.js'), 'public, max-age=300'));
      }
      if (url.pathname === '/') {
        res.writeHead(302, { Location: '/demo/' });
        return res.end();
      }
      if (url.pathname.startsWith('/demo/')) {
        const rel = url.pathname.replace(/^\/demo\//, '') || 'index.html';
        const file = path.join(root, 'demo', path.normalize(decodeURIComponent(rel)));
        if (file.startsWith(path.join(root, 'demo')) && (await serveFile(res, file))) return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (err) {
      if (!err.status) logger.error(err);
      if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Internal error.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  const port = Number(process.env.PORT) || 3003;
  const server = createServer();
  server.listen(port, () => {
    const mode = process.env.CHAT_MODE !== 'demo' && process.env.ANTHROPIC_API_KEY ? 'Claude mode (FAQ-grounded)' : 'Demo mode (keyword search)';
    console.log(`Chat widget server: http://localhost:${port}  ·  ${mode}`);
  });
}
