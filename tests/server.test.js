import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { createServer } from '../server/index.js';

let dir, servers = [];
const silent = { warn() {}, error() {}, log() {} };

async function start(opts = {}) {
  const s = createServer({ dataDir: dir, env: {}, logger: silent, ...opts });
  await new Promise((r) => s.listen(0, r));
  servers.push(s);
  return `http://127.0.0.1:${s.address().port}`;
}
const post = (base, url, body, headers = {}) =>
  fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

before(() => { dir = mkdtempSync(path.join(tmpdir(), 'widget-')); });
after(() => { servers.forEach((s) => s.close()); rmSync(dir, { recursive: true, force: true }); });

test('serves widget.js and the demo pages', async () => {
  const base = await start();
  const w = await fetch(base + '/widget.js');
  assert.equal(w.status, 200);
  assert.match(w.headers.get('content-type'), /javascript/);
  assert.equal(w.headers.get('access-control-allow-origin'), '*');
  assert.match(await w.text(), /attachShadow/);
  assert.equal((await fetch(base + '/demo/')).status, 200);
  assert.equal((await fetch(base + '/demo/foreign-site.html')).status, 200);
  assert.equal((await fetch(base + '/', { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(base + '/demo/../server/index.js')).status, 404);
});

test('config: demo mode without a key', async () => {
  const base = await start();
  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(cfg.mode, 'demo');
  assert.equal(cfg.name, 'Farnhaus Plants');
  assert.ok(cfg.suggestions.length >= 2);
});

test('chat (demo): answer from the FAQ with a source', async () => {
  const base = await start();
  const r = await (await post(base, '/api/chat', { message: "What's the postage?" })).json();
  assert.equal(r.kind, 'answer');
  assert.match(r.text, /€5\.90/);
  assert.equal(r.sources[0].id, 'shipping-cost');
  assert.match(r.sources[0].url, /^https:\/\/www\.farnhaus\.example/);
});

test('chat (demo): unknown question → honest reply pointing to a person', async () => {
  const base = await start();
  const r = await (await post(base, '/api/chat', { message: 'What will the weather be like tomorrow?' })).json();
  assert.equal(r.kind, 'unsure');
  assert.match(r.text, /team/);
  assert.deepEqual(r.sources, []);
});

test('chat: small talk and asking for a person', async () => {
  const base = await start();
  assert.equal((await (await post(base, '/api/chat', { message: 'Hello' })).json()).kind, 'smalltalk');
  assert.equal((await (await post(base, '/api/chat', { message: 'I want to talk to a human' })).json()).kind, 'handoff');
});

test('chat: input is validated', async () => {
  const base = await start();
  assert.equal((await post(base, '/api/chat', { message: '   ' })).status, 400);
  assert.equal((await post(base, '/api/chat', { message: 'x'.repeat(501) })).status, 400);
  const bad = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(base + '/api/chat', { method: 'POST', body: 'x' })).status, 415);
  assert.equal((await fetch(base + '/api/chat')).status, 405);
});

test('Claude mode: answer and sources come from the answerer', async () => {
  const base = await start({ claudeAnswerer: async ({ question }) => ({ text: `Answer to: ${question}`, sourceIds: ['returns', 'does-not-exist'] }) });
  assert.equal((await (await fetch(base + '/api/config')).json()).mode, 'claude');
  const r = await (await post(base, '/api/chat', { message: 'Returns?' })).json();
  assert.equal(r.mode, 'claude');
  assert.equal(r.text, 'Answer to: Returns?');
  assert.deepEqual(r.sources.map((s) => s.id), ['returns']);
});

test('Claude mode: falls back to keyword search on error (null)', async () => {
  const base = await start({ claudeAnswerer: async () => null });
  const r = await (await post(base, '/api/chat', { message: 'How much does shipping cost?' })).json();
  assert.equal(r.mode, 'demo');
  assert.equal(r.sources[0].id, 'shipping-cost');
});

test('CHAT_MODE=demo forces demo mode even with a key', async () => {
  const base = await start({ env: { CHAT_MODE: 'demo', ANTHROPIC_API_KEY: 'not-real' } });
  assert.equal((await (await fetch(base + '/api/config')).json()).mode, 'demo');
});

test('handoff to a person: validation', async () => {
  const base = await start();
  const r = await post(base, '/api/handoff', { name: 'A', email: 'not-an-email', message: '', consent: false });
  assert.equal(r.status, 422);
  const { errors } = await r.json();
  assert.deepEqual(Object.keys(errors).sort(), ['consent', 'email', 'message', 'name']);
});

test('handoff to a person: ticket, storage, and email with chat history', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const sent = [];
  const orig = transport.sendMail.bind(transport);
  transport.sendMail = async (m) => { const info = await orig(m); sent.push(JSON.parse(info.message)); return info; };
  const base = await start({ mailTransport: transport });
  const res = await post(base, '/api/handoff', {
    name: 'Jane Sample', email: 'Jane@Example.org', message: 'My Monstera has yellow leaves.', consent: true,
    transcript: [{ role: 'user', text: 'Yellow leaves?' }, { role: 'assistant', text: "I couldn't find anything about that." }, { role: 'system', text: 'x' }],
  });
  assert.equal(res.status, 201);
  const { ticket, mailed } = await res.json();
  assert.match(ticket, /^FH-[A-Z0-9]{6}$/);
  assert.equal(mailed, true);
  const stored = readFileSync(path.join(dir, 'handoffs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(stored.ticket, ticket);
  assert.equal(stored.email, 'jane@example.org');
  assert.equal(stored.transcript.length, 2, 'unknown roles are dropped');
  assert.match(JSON.stringify(sent[0].replyTo), /jane@example.org/);
  assert.match(sent[0].subject, new RegExp(ticket));
  assert.match(sent[0].subject, /Chat request from Jane Sample/);
  assert.match(sent[0].text, /Customer: Yellow leaves\?/);
  assert.match(sent[0].text, /Chat history:/);
});

test('CORS: allowed and foreign origins, preflight', async () => {
  const base = await start({ env: { ALLOWED_ORIGINS: 'https://shop.example' } });
  const ok = await fetch(base + '/api/config', { headers: { Origin: 'https://shop.example' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://shop.example');
  const pre = await fetch(base + '/api/chat', { method: 'OPTIONS', headers: { Origin: 'https://shop.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  const denied = await fetch(base + '/api/config', { headers: { Origin: 'https://foreign.example' } });
  assert.equal(denied.status, 403);
});

test('rate limit: after 5 handoffs in 5 minutes → 429', async () => {
  const base = await start();
  let last;
  for (let i = 0; i < 6; i++) last = await post(base, '/api/handoff', { name: 'Test', email: 't@example.org', message: 'Hello team', consent: true });
  assert.equal(last.status, 429);
});
