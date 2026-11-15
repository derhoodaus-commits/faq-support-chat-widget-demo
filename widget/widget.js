/*!
 * Farnhaus help widget — embeddable customer support chat (demo project)
 * Embed with one line:  <script src="https://YOUR-SERVER/widget.js" defer></script>
 * Optional attributes: data-color="#1d5c45"  data-position="left|right"  data-api="https://…"  data-open="true"
 * Static mode (no server, e.g. GitHub Pages): data-mode="static" [data-faq-url="…/faq.json"]
 *   → loads the FAQ and the search engine (engine/answer.js next to widget.js) and answers in the browser;
 *     no /api calls, and the "talk to a person" form is validated but never sent.
 * Runs in Shadow DOM: the host page's styles don't affect the widget, and vice versa.
 */
(() => {
  if (window.__farnhausWidget) return;
  window.__farnhausWidget = true;

  const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  const BASE = new URL('.', script?.src || location.href);
  const API = (script?.dataset.api || BASE.href).replace(/\/$/, '');
  const STATIC = script?.dataset.mode === 'static';
  // data-faq-url resolves like any HTML URL (relative to the page); default: faq.json next to widget.js
  const FAQ_URL = new URL(script?.dataset.faqUrl || new URL('faq.json', BASE).href, document.baseURI);
  const ENGINE_URL = new URL('engine/answer.js', BASE);
  const COLOR = /^#[0-9a-f]{3,8}$/i.test(script?.dataset.color || '') ? script.dataset.color : '#1d5c45';
  const LEFT = script?.dataset.position === 'left';
  const STORE = 'farnhaus-chat-v1';

  // ---------- State (survives page changes in the same tab) ----------
  let state = { open: false, messages: [], view: 'chat' };
  try { state = { ...state, ...JSON.parse(sessionStorage.getItem(STORE) || '{}') }; } catch { /* ignore */ }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify({ open: state.open, messages: state.messages.slice(-60) })); } catch { /* ignore */ } };
  let config = null;
  let busy = false;

  // ---------- DOM ----------
  const host = document.createElement('div');
  host.id = 'farnhaus-chat';
  const root = host.attachShadow({ mode: 'open' });

  const ICON_CHAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z" fill="currentColor"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l15-7-5 15-2.5-6.5z" fill="currentColor"/></svg>';
  const ICON_LEAF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4c-8 0-13 4-13 10 0 1.6.4 3 1.2 4.2L5 20.5l1.1 1.1 2.3-2.3c1.2.8 2.6 1.2 4.1 1.2 6 0 8.5-6 6.5-16.5zM9 17c2-4 4.5-6.5 8-8.5-2.8 2.6-5 5.4-6.6 9z" fill="currentColor"/></svg>';
  const ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  root.innerHTML = `
<style>
  :host { all: initial !important; }
  * { box-sizing: border-box; }
  .w { --c: ${COLOR}; --ink: #17211c; --muted: #56615b; --line: #dfe5e1; --soft: #f2f6f3; --bg: #fff;
       font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased; }
  button, input, textarea { font: inherit; color: inherit; }
  :focus-visible { outline: 3px solid #1a5fd0; outline-offset: 2px; }
  .launcher { z-index: 2147483000; position: fixed; bottom: 20px; ${LEFT ? 'left' : 'right'}: 20px; width: 60px; height: 60px; border-radius: 50%; border: 0;
    background: var(--c); color: #fff; cursor: pointer; display: grid; place-items: center;
    box-shadow: 0 8px 24px rgb(0 0 0 / .22), 0 2px 6px rgb(0 0 0 / .14); transition: transform .18s ease, box-shadow .18s ease; }
  .launcher:hover { transform: translateY(-2px) scale(1.03); box-shadow: 0 12px 28px rgb(0 0 0 / .26); }
  .launcher:active { transform: scale(.97); }
  .launcher svg { width: 28px; height: 28px; }
  .panel { z-index: 2147483000; position: fixed; bottom: 92px; ${LEFT ? 'left' : 'right'}: 20px; width: 380px; height: min(620px, calc(100vh - 120px));
    background: var(--bg); border-radius: 16px; box-shadow: 0 24px 60px rgb(0 0 0 / .24), 0 4px 14px rgb(0 0 0 / .12);
    display: flex; flex-direction: column; overflow: hidden; transform-origin: ${LEFT ? 'bottom left' : 'bottom right'}; }
  .panel[hidden] { display: none; }
  @media (prefers-reduced-motion: no-preference) { .panel.anim { animation: pop .2s cubic-bezier(.2,.8,.3,1); } }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.97); } }
  @media (max-width: 480px) {
    .panel { inset: 0; width: 100%; height: 100%; height: 100dvh; border-radius: 0; bottom: 0; }
    .w.is-open .launcher { display: none; }
  }
  header { background: var(--c); color: #fff; padding: 14px 12px 14px 16px; display: flex; align-items: center; gap: 12px; }
  .avatar { width: 38px; height: 38px; border-radius: 50%; background: rgb(255 255 255 / .18); display: grid; place-items: center; flex: none; }
  .avatar svg { width: 22px; height: 22px; }
  .title { flex: 1; min-width: 0; }
  .title strong { display: block; font-size: 16px; line-height: 1.25; }
  .title span { font-size: 13px; opacity: .92; }
  .icon-btn { width: 44px; height: 44px; border: 0; background: transparent; color: #fff; border-radius: 10px; cursor: pointer; display: grid; place-items: center; flex: none; }
  .icon-btn[hidden] { display: none; }
  .icon-btn:hover { background: rgb(255 255 255 / .16); }
  .icon-btn svg { width: 22px; height: 22px; }
  header :focus-visible { outline-color: #fff; }
  .mode { font-size: 12px; color: var(--muted); background: var(--soft); padding: 6px 16px; border-bottom: 1px solid var(--line); }
  .log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; overscroll-behavior: contain; }
  .msg { max-width: 86%; padding: 10px 14px; border-radius: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .bot { align-self: flex-start; background: var(--soft); border-bottom-left-radius: 4px; }
  .user { align-self: flex-end; background: var(--c); color: #fff; border-bottom-right-radius: 4px; }
  .sources { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); white-space: normal; }
  .sources a { color: var(--ink); font-weight: 600; text-underline-offset: 2px; }
  .related { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; white-space: normal; }
  .chip, .related button { text-align: left; border: 1px solid var(--line); background: #fff; border-radius: 12px; padding: 8px 12px; cursor: pointer; font-size: 14px; min-height: 40px; }
  .chip:hover, .related button:hover { border-color: var(--c); background: #fbfdfc; }
  .chips { display: flex; flex-direction: column; gap: 6px; align-self: stretch; }
  .typing { align-self: flex-start; background: var(--soft); border-radius: 16px; padding: 12px 14px; display: flex; gap: 4px; }
  .typing i { width: 7px; height: 7px; border-radius: 50%; background: #8a958f; display: block; }
  @media (prefers-reduced-motion: no-preference) {
    .typing i { animation: blink 1s infinite ease-in-out; } .typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
  }
  @keyframes blink { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
  form.ask { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--line); }
  form.ask input { flex: 1; min-width: 0; height: 46px; border: 1px solid #b8c2bc; border-radius: 12px; padding: 0 14px; background: #fff; font-size: 16px; }
  form.ask input:focus { outline: none; border-color: var(--c); box-shadow: 0 0 0 3px rgb(29 92 69 / .2); }
  .send { width: 46px; height: 46px; border: 0; border-radius: 12px; background: var(--c); color: #fff; cursor: pointer; display: grid; place-items: center; flex: none; }
  .send:disabled { opacity: .5; cursor: default; }
  .send svg { width: 20px; height: 20px; }
  .handoff-link { border: 0; border-top: 1px solid var(--line); background: #fff; padding: 10px 16px 12px; font-size: 14px; color: var(--ink); cursor: pointer; text-align: center; min-height: 44px; }
  .handoff-link span { text-decoration: underline; text-underline-offset: 3px; font-weight: 600; }
  .handoff-link:hover span { color: var(--c); }
  .demo-note { font-size: 11px; color: var(--muted); text-align: center; padding: 0 12px 8px; background: #fff; }
  .hf { flex: 1; overflow-y: auto; padding: 16px; }
  .hf p.lead { margin: 0 0 14px; color: var(--muted); font-size: 14px; }
  .field { margin-bottom: 12px; }
  .field label { display: block; font-weight: 600; font-size: 14px; margin-bottom: 4px; }
  .field input, .field textarea { width: 100%; border: 1px solid #b8c2bc; border-radius: 10px; padding: 10px 12px; font-size: 16px; background: #fff; }
  .field textarea { min-height: 96px; resize: vertical; }
  .field input:focus, .field textarea:focus { outline: none; border-color: var(--c); box-shadow: 0 0 0 3px rgb(29 92 69 / .2); }
  .field [aria-invalid="true"] { border-color: #b3261e; }
  .err { color: #b3261e; font-size: 13px; margin: 4px 0 0; font-weight: 600; }
  .err:empty { display: none; }
  .check { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: start; font-size: 14px; margin-bottom: 10px; }
  .check input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--c); }
  .primary { width: 100%; height: 48px; border: 0; border-radius: 12px; background: var(--c); color: #fff; font-weight: 600; cursor: pointer; margin-top: 4px; }
  .primary:disabled { opacity: .6; }
  .done { text-align: center; padding: 24px 8px; }
  .done strong { display: block; font-size: 18px; margin-bottom: 8px; }
  .ticket { font-family: ui-monospace, Consolas, monospace; background: var(--soft); padding: 2px 8px; border-radius: 6px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
<div class="w">
  <button class="launcher" type="button" aria-expanded="false" aria-controls="fh-panel" aria-label="Open help chat">${ICON_CHAT}</button>
  <section class="panel" id="fh-panel" role="dialog" aria-modal="false" aria-labelledby="fh-title" hidden>
    <header>
      <button class="icon-btn back" type="button" aria-label="Back to chat" hidden>${ICON_BACK}</button>
      <span class="avatar" aria-hidden="true">${ICON_LEAF}</span>
      <div class="title"><strong id="fh-title">Help</strong><span class="sub">Replies instantly</span></div>
      <button class="icon-btn close" type="button" aria-label="Close chat">${ICON_CLOSE}</button>
    </header>
    <div class="chat-view" style="display:flex;flex-direction:column;flex:1;min-height:0">
      <p class="mode" hidden></p>
      <div class="log" role="log" aria-live="polite" aria-label="Chat history" tabindex="0"></div>
      <form class="ask" autocomplete="off">
        <label class="sr" for="fh-input">Your question</label>
        <input id="fh-input" name="q" maxlength="500" placeholder="Ask a question…" enterkeyhint="send">
        <button class="send" type="submit" aria-label="Send">${ICON_SEND}</button>
      </form>
      <button class="handoff-link" type="button"><span>Talk to a person</span></button>
      <p class="demo-note"></p>
    </div>
    <div class="hf" hidden></div>
  </section>
</div>`;

  const $ = (s) => root.querySelector(s);
  const w = $('.w');
  const launcher = $('.launcher');
  const panel = $('.panel');
  const log = $('.log');
  const form = $('form.ask');
  const input = $('#fh-input');
  const sendBtn = $('.send');
  const chatView = $('.chat-view');
  const hf = $('.hf');
  const backBtn = $('.back');

  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const c of [].concat(children)) if (c) n.append(c);
    return n;
  };

  // ---------- Rendering ----------
  function renderMessage(m) {
    const bubble = el('div', { className: `msg ${m.role === 'user' ? 'user' : 'bot'}` });
    bubble.append(el('span', { className: 'sr', textContent: m.role === 'user' ? 'You: ' : 'Assistant: ' }), m.text);
    if (m.sources?.length) {
      const src = el('div', { className: 'sources' }, 'Source: ');
      m.sources.forEach((s, i) => {
        if (i) src.append(', ');
        src.append(s.url ? el('a', { href: s.url, target: '_blank', rel: 'noopener', textContent: s.question }) : el('strong', { textContent: s.question }));
      });
      bubble.append(src);
    }
    if (m.related?.length) {
      const box = el('div', { className: 'related' });
      for (const r of m.related) {
        box.append(el('button', { type: 'button', textContent: r.question, onclick: () => ask(r.question) }));
      }
      bubble.append(box);
    }
    if (m.kind === 'unsure' || m.kind === 'handoff') {
      bubble.append(el('div', { className: 'related' }, el('button', { type: 'button', textContent: 'Talk to a person', onclick: () => showHandoff() })));
    }
    return bubble;
  }

  function renderLog() {
    log.replaceChildren();
    const greeting = config?.greeting || 'Hi! How can I help?';
    log.append(renderMessage({ role: 'assistant', text: greeting }));
    if (!state.messages.length && config?.suggestions?.length) {
      const chips = el('div', { className: 'chips', role: 'group', ariaLabel: 'Common questions' });
      for (const s of config.suggestions) chips.append(el('button', { type: 'button', className: 'chip', textContent: s, onclick: () => ask(s) }));
      log.append(chips);
    }
    for (const m of state.messages) log.append(renderMessage(m));
    log.scrollTop = log.scrollHeight;
  }

  function applyConfig() {
    if (!config) return;
    $('#fh-title').textContent = config.assistantName || 'Help';
    const modeEl = $('.mode');
    modeEl.hidden = false;
    modeEl.textContent = config.mode === 'claude'
      ? 'Answers are written from our FAQ, with sources.'
      : config.mode === 'static'
        ? 'Demo mode: FAQ keyword search in your browser, with sources. No AI, nothing is sent.'
        : 'Answers come straight from our FAQ, with sources.';
    $('.demo-note').textContent = config.note ? 'Demo project · fictional company' : '';
  }

  // ---------- Open / close ----------
  function setOpen(open, { focus = true } = {}) {
    state.open = open;
    panel.hidden = !open;
    w.classList.toggle('is-open', open);
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Close help chat' : 'Open help chat');
    launcher.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
    if (open) {
      panel.classList.remove('anim');
      if (focus) { // animate only when opened by the user, not when restored after a page change
        void panel.offsetWidth;
        panel.classList.add('anim');
      }
      if (!config) loadConfig();
      renderLog();
      if (focus) (state.view === 'handoff' ? hf.querySelector('input') : input)?.focus();
    } else if (focus) launcher.focus();
    save();
  }
  launcher.addEventListener('click', () => setOpen(!state.open));
  $('.close').addEventListener('click', () => setOpen(false));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.open) {
      e.stopPropagation();
      if (state.view === 'handoff') showChat();
      else setOpen(false);
    }
  });

  // ---------- Static mode: FAQ + search engine loaded once, answers computed in the browser ----------
  let engine = null;
  function loadEngine() {
    engine ??= Promise.all([
      import(ENGINE_URL.href),
      fetch(FAQ_URL).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ]).then(([m, faq]) => ({ m, faq, index: m.buildIndex(faq.entries) }));
    engine.catch(() => { engine = null; }); // allow a retry later
    return engine;
  }
  // Source links in the static FAQ may be relative to the FAQ file
  const absUrls = (list) => list?.map((s) => ({ ...s, url: s.url ? new URL(s.url, FAQ_URL).href : null }));

  async function staticReply(q) {
    let e;
    try { e = await loadEngine(); } catch { throw new Error("The help content couldn't be loaded. Please reload the page and try again."); }
    await new Promise((r) => setTimeout(r, 350)); // short pause so the reply doesn't feel abrupt
    const data = e.m.demoReply(e.index, q.slice(0, 500));
    return { ...data, sources: absUrls(data.sources), related: absUrls(data.related) };
  }

  async function loadConfig() {
    try {
      if (STATIC) {
        const { m, faq } = await loadEngine();
        config = m.configFromFaq(faq, 'static');
      } else {
        const res = await fetch(`${API}/api/config`);
        if (!res.ok) throw new Error(res.status);
        config = await res.json();
      }
    } catch {
      config = { greeting: 'Hi! How can I help?', suggestions: [], mode: STATIC ? 'static' : 'demo' };
    }
    applyConfig();
    if (state.open && state.view === 'chat') renderLog();
  }

  // ---------- Asking ----------
  async function ask(text) {
    const q = String(text).trim();
    if (!q || busy) return;
    busy = true;
    sendBtn.disabled = true;
    const history = state.messages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    state.messages.push({ role: 'user', text: q });
    renderLog();
    const typing = el('div', { className: 'typing', ariaLabel: 'Writing a reply' }, [el('i'), el('i'), el('i')]);
    log.append(typing);
    log.scrollTop = log.scrollHeight;
    try {
      let data;
      if (STATIC) data = await staticReply(q);
      else {
        const res = await fetch(`${API}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: q, history }),
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Error');
      }
      state.messages.push({ role: 'assistant', text: data.text, sources: data.sources, related: data.related, kind: data.kind });
    } catch (err) {
      state.messages.push({
        role: 'assistant', kind: 'unsure',
        text: err.message && err.message !== 'Failed to fetch' && err.message !== 'Error'
          ? err.message
          : "I can't be reached right now. Please try again in a moment or message our team.",
      });
    } finally {
      busy = false;
      sendBtn.disabled = false;
      save();
      renderLog();
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = '';
    ask(q);
    input.focus();
  });

  // ---------- Handoff to a person ----------
  function showChat() {
    state.view = 'chat';
    hf.hidden = true;
    chatView.style.display = 'flex';
    backBtn.hidden = true;
    $('.sub').textContent = 'Replies instantly';
    input.focus();
  }

  function showFieldErrors(f, errors) {
    f.querySelectorAll('[data-err]').forEach((p) => (p.textContent = ''));
    f.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
    let first = null;
    for (const [k, v] of Object.entries(errors)) {
      const p = f.querySelector(`[data-err="${k}"]`);
      if (p) p.textContent = v;
      const field = f.elements[k];
      field?.setAttribute('aria-invalid', 'true');
      first ??= field;
    }
    first?.focus();
  }

  function showHandoff() {
    state.view = 'handoff';
    chatView.style.display = 'none';
    hf.hidden = false;
    backBtn.hidden = false;
    $('.sub').textContent = config?.supportHours ? `Our team · ${config.supportHours}` : 'Our team';
    const lastQuestion = [...state.messages].reverse().find((m) => m.role === 'user')?.text || '';
    hf.innerHTML = `
      <p class="lead">${STATIC
        ? 'Demo version: this form is checked, but nothing is sent or stored. In the live version your message goes to our customer service team.'
        : 'Your message goes to our customer service team. We reply by email, usually within one business day.'}</p>
      <form novalidate>
        <div class="field"><label for="hf-name">Name</label><input id="hf-name" name="name" autocomplete="name" aria-describedby="hf-name-err"><p class="err" id="hf-name-err" data-err="name"></p></div>
        <div class="field"><label for="hf-email">Email</label><input id="hf-email" name="email" type="email" autocomplete="email" inputmode="email" aria-describedby="hf-email-err"><p class="err" id="hf-email-err" data-err="email"></p></div>
        <div class="field"><label for="hf-msg">How can we help?</label><textarea id="hf-msg" name="message" maxlength="2000" aria-describedby="hf-msg-err"></textarea><p class="err" id="hf-msg-err" data-err="message"></p></div>
        <label class="check"><input type="checkbox" name="transcript" checked> <span>Include this chat</span></label>
        <label class="check"><input type="checkbox" name="consent" aria-describedby="hf-consent-err"> <span>I agree that my details will be shared with the team to handle my request.</span></label>
        <p class="err" id="hf-consent-err" data-err="consent"></p>
        <button class="primary" type="submit">${STATIC ? 'Send message (demo)' : 'Send message'}</button>
        <p class="err" data-err="_" role="alert"></p>
      </form>`;
    hf.querySelector('#hf-msg').value = lastQuestion;
    const f = hf.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const body = {
        name: fd.get('name'), email: fd.get('email'), message: fd.get('message'),
        consent: f.consent.checked, page: location.href,
        transcript: f.transcript.checked ? state.messages.map((m) => ({ role: m.role, text: m.text })) : [],
      };
      // Check in the browser first (same rules as the server) to save a round trip
      const local = {};
      if (String(body.name || '').trim().length < 2) local.name = 'Please enter your name.';
      if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(String(body.email || '').trim())) local.email = 'Please check your email address.';
      if (String(body.message || '').trim().length < 5) local.message = 'Please briefly describe what you need.';
      if (!body.consent) local.consent = 'Please agree to share your details with our team.';
      if (Object.keys(local).length) {
        showFieldErrors(f, local);
        return;
      }
      if (STATIC) {
        // Static demo: never send anything — just confirm that the form would have gone out
        hf.replaceChildren(el('div', { className: 'done', tabIndex: -1 }, [
          el('strong', { textContent: 'Demo only – nothing was sent.' }),
          el('p', { textContent: 'Your details passed the checks. In the live version, your message' + (body.transcript.length ? ' and this chat' : '') + ' would now reach the team by email, with a ticket number.' }),
          el('p', { textContent: 'This demo has no server: nothing left your browser.' }),
          el('button', { type: 'button', className: 'primary', textContent: 'Back to chat', onclick: showChat }),
        ]));
        hf.querySelector('.done').focus();
        return;
      }
      const btn = f.querySelector('.primary');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      f.querySelectorAll('[data-err]').forEach((p) => (p.textContent = ''));
      f.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
      try {
        const res = await fetch(`${API}/api/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (res.status === 422) {
          showFieldErrors(f, data.errors || {});
          return;
        }
        if (!res.ok) throw new Error(data.error);
        hf.replaceChildren(el('div', { className: 'done', tabIndex: -1 }, [
          el('strong', { textContent: 'Thanks! We got your message.' }),
          el('p', {}, ['Your ticket number: ', el('span', { className: 'ticket', textContent: data.ticket })]),
          el('p', { textContent: "We'll get back to you by email." }),
          el('button', { type: 'button', className: 'primary', textContent: 'Back to chat', onclick: showChat }),
        ]));
        hf.querySelector('.done').focus();
      } catch (err) {
        f.querySelector('[data-err="_"]').textContent = err.message || "Couldn't send your message. Please try again later.";
      } finally {
        if (btn.isConnected) {
          btn.disabled = false;
          btn.textContent = 'Send message';
        }
      }
    });
    hf.querySelector('#hf-name').focus();
  }
  $('.handoff-link').addEventListener('click', showHandoff);
  backBtn.addEventListener('click', showChat);

  // ---------- Start ----------
  const mount = () => {
    document.body.append(host);
    if (state.open || script?.dataset.open === 'true') setOpen(true, { focus: false });
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
  window.FarnhausChat = { open: () => setOpen(true), close: () => setOpen(false), ask: (q) => { setOpen(true); ask(q); } };
})();
