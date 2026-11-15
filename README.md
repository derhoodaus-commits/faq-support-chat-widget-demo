# Help Widget – a customer support chat for any website

> **Demo project.** “Farnhaus Plants” is a fictional online shop (name checked by web search beforehand);
> the FAQ, prices, and deadlines are examples.

## What is it?

A chat widget you can add to any website with **one line of code**. It answers customer questions from an FAQ –
**with a source for every answer**. If it can't find a good answer, it says so honestly and offers
**“Talk to a person”**: a short form that sends the request, including the chat history, to the team as a ticket
(email via SMTP and/or a file).

Two modes:

| Mode | When | How it answers |
|---|---|---|
| **Demo mode** (default) | no API key | Custom keyword search over the FAQ: normalization, stopwords, English stemming, synonyms, phrases, typo and run-together-word handling, BM25 ranking. Answer = FAQ text, source = FAQ entry. |
| **Claude mode** (optional) | `ANTHROPIC_API_KEY` set | Claude writes a short answer **based only on the FAQ entries** and cites them; the citations become clickable sources. On errors, refusals, or connection problems, keyword search takes over automatically. |

## Live demo (GitHub Pages)

**<https://derhoodaus-commits.github.io/faq-support-chat-widget-demo/>**

The live demo is a **fully static** build of the same widget – no server, no API, no keys:

- **Does:** the demo shop with the widget, FAQ answers with sources (links open the generated FAQ page), suggestions,
  typo handling, “Did you mean …?”, and the honest fallback with “Talk to a person”. The answers come from the
  **same keyword search** as the server's demo mode (`server/answer.js` + `server/search.js` are shipped unchanged as
  ES modules and run in the browser; a test checks that both give identical replies). Also included: the embed test on a
  page with hostile CSS (`foreign-site.html`) and a 404 page.
- **Doesn't:** Claude mode (needs the server and a key) and real handoff – the form is validated, but on submit it
  only confirms that this is a demo and **nothing was sent or stored**.

Build it locally:

```bash
npm run build:pages        # → dist-pages/ (index.html, foreign-site.html, faq.html, 404.html, widget.js, engine/, faq.json, .nojekyll)
npm run test:e2e:pages     # serves dist-pages under /faq-support-chat-widget-demo/ and tests it in Chromium (1440 px + 390 px)
```

`.github/workflows/pages.yml` builds and deploys it on every push to `main` (or manually via *Run workflow*).
`PAGES_URL` / `PAGES_BASE` change the public URL shown in the snippet and the base path used by `404.html`.

Static embed (no server needed; `faq.json` and `engine/` are loaded from next to `widget.js`):

```html
<script src="https://derhoodaus-commits.github.io/faq-support-chat-widget-demo/widget.js" data-mode="static" defer></script>
```

## What problem does it solve?

Small shops answer the same questions by email over and over (shipping, returns, payment). The widget answers them
instantly, around the clock, without guessing – and anything it doesn't know reaches the team as a structured
request with the chat history instead of a vague email.

## Embed it on any website (one line)

1. Start the server (see below) or run it on your own server/subdomain, e.g. `https://help.your-company.com`.
2. Paste this line before `</body>` – WordPress, Shopify, Wix, Webflow, or plain HTML all work:

```html
<script src="https://help.your-company.com/widget.js" defer></script>
```

Optional attributes on the same tag:

| Attribute | Example | Effect |
|---|---|---|
| `data-color` | `data-color="#1d5c45"` | Brand color (hex) |
| `data-position` | `data-position="left"` | Bottom left instead of bottom right |
| `data-open` | `data-open="true"` | Open the chat on page load |
| `data-api` | `data-api="https://api.example.com"` | API runs on a different server than `widget.js` |
| `data-mode` | `data-mode="static"` | No server: search runs in the browser, handoff form is demo-only (see *Live demo*) |
| `data-faq-url` | `data-faq-url="/help/faq.json"` | Static mode only: your own FAQ file (default: `faq.json` next to `widget.js`; other domains need CORS) |

`window.FarnhausChat.open()`, `.close()`, and `.ask("question")` are also available for your own buttons.
**WordPress:** a plugin like “Insert Headers and Footers” or the theme before `</body>`. **Shopify:** `theme.liquid` before `</body>`.
For other domains, add the shop's address to `ALLOWED_ORIGINS` (CORS).

## Maintaining the FAQ

- Edit `faq/faq.json` directly (company, greeting, suggestions, entries with `id`, `category`, `question`, `answer`,
  `keywords`, `url`). The server reloads the file on changes **without a restart** and validates it (duplicate IDs,
  missing fields, invalid links).
- **From Google Sheets:** create a sheet with the columns `Question`, `Answer`, and optionally `ID`, `Category`,
  `Keywords`, `Link` → *File → Download → CSV* → import:

```bash
npm run faq:import -- faq/sample-google-sheets-export.csv --dry-run
npm run faq:import -- path/to/export.csv
```

The import handles commas and semicolons (European Excel), line breaks inside cells, English column names (German
ones from older exports work too), and generates missing IDs from the question.

## Tech and decisions

| Area | Decision | Why |
|---|---|---|
| Widget | Vanilla JS, ~25 KB, **Shadow DOM**, no dependencies | Runs on any page; the page's CSS doesn't affect the widget and vice versa (tested with a deliberately “hostile” page). |
| Server | Node.js `node:http` | Small, no framework; serves `widget.js`, the demo pages, and the API. |
| Search (demo mode) | Custom implementation instead of a search library | Tuned for English (light stemmer, contractions like “hasn't”, synonyms like postage/refund/bugs), fully transparent, no key needed. An answer only counts as “confident” if it scores high enough **and** matches what the entry is about (its question or keywords, not just a word somewhere in the answer). Every word the FAQ doesn't know at all raises the bar – in “plant care workshops” or “student discount” the unknown word is the real topic – so such questions get “Talk to a person” instead of a wrong answer. |
| Claude mode | Official SDK `@anthropic-ai/sdk`, model `claude-opus-5-5` (configurable via `ANTHROPIC_MODEL`), low effort (`effort: low`, plenty for chat), FAQ in a **cached** system prompt, server-side fallback on refusals (`fallbacks: "default"`) | Short, friendly answers that still rely only on the FAQ; citations make every statement checkable. Replies in the customer's language (English by default). Large FAQs (> 60 entries) send only the top search hits. |
| Keys | Only via environment variable / `.env` (not in the repo), `.env.example` as a template | No keys in the code. |
| Handoff to a person | Form in the widget, validated in the browser **and** on the server, ticket number `FH-XXXXXX`, stored in `data/handoffs.jsonl`, email via SMTP (nodemailer) with Reply-To set to the customer | Works right away without a mail server; add SMTP details to go live. |
| Security | CORS allowlist (`ALLOWED_ORIGINS`), size and length limits, simple rate limiting, output only via `textContent` (no HTML from answers), roles in the history are checked | Protects against abuse and script injection. |
| Convenience | History persists across page changes (sessionStorage), suggestions, “Did you mean …?”, typing indicator | Feels like a real support chat. |
| Accessibility | Launcher with `aria-expanded`, dialog with a title, history as `role="log"` (screen readers announce answers), Escape closes and returns focus, visible focus rings, contrast ≥ 4.5:1, full screen on phones | Usable with keyboard and screen reader. |

## Getting started

Requirement: Node.js 20.12 or newer.

```bash
npm install
npm start
```

Then open <http://localhost:3003/demo/> (demo shop with the widget embedded) and
<http://localhost:3003/demo/foreign-site.html> (test with foreign CSS, widget on the left in purple).

To enable Claude mode: copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY=…`, and restart. The console shows the
active mode. `CHAT_MODE=demo` forces demo mode.

## Tests

```bash
npm test                # 45 tests (node:test): search, CSV import, Claude mode, API, static build
npm run test:e2e        # 33 browser checks with Playwright (Python) + screenshots (server mode)
npm run test:e2e:pages  # 103 browser checks of the static GitHub Pages build (desktop + phone)
```

**What was tested (all passing):**

- **Search:** normalization, stemming, stopwords, synonyms; **40 paraphrased customer questions** all land
  confidently on the right entry (including “postage”, “send a plant back”, “tiny black flies in the soil”,
  “I can't log into my account”); typos (“shiping costs”, “retun an item”) and run-together words (“returnlabel”);
  6 off-topic questions are **not** answered confidently; 33 plausible shop questions the FAQ doesn't cover (workshops, gift wrapping, student discount, hiring, wholesale, pick-up, …) get the fallback or the one entry that really answers them (opening hours → contact); phrases (“pay by invoice”, “hasn't arrived”);
  intents (human, thanks, greeting).
- **FAQ/CSV:** quotes, commas, and line breaks in cells, semicolons, CRLF, BOM, unclosed quotes, German column
  names, validation with clear messages, reloading without a restart.
- **Claude mode (with a fake instead of the real API, so no cost):** correct model, fallback parameters, effort,
  cached FAQ block, system prompt rules (FAQ only, customer's language, citation format, handoff); citations →
  sources, made-up IDs are ignored; refusal, connection, and rate-limit errors → fallback to keyword search;
  programming errors aren't swallowed; large FAQ; history is sanitized (roles, order, length).
- **API:** serving the widget and demo pages, path traversal, config, answers with sources, honest reply to
  unknown questions, small talk, input validation (400/415/405), Claude mode and fallback, `CHAT_MODE=demo`,
  handoff with validation, ticket, storage, and **email content** (nodemailer in JSON test mode),
  CORS (allowed, denied, preflight), rate limiting.
- **Static build:** all 40 test questions, the 33 shop questions, and 17 edge cases give the same reply as the server's demo mode; engine
  files identical to the server modules; every `href`/`src` in the output resolves to an existing file (and anchor)
  under `/faq-support-chat-widget-demo/`, nothing root-relative, no `/api`. In the browser: no console errors, no failed
  requests, no `/api` calls and no POST requests at all, handoff confirms “nothing was sent”, 404 page.
- **Browser:** open/close, focus handling, suggestions, answers with linked sources, typos, unknown question with
  handoff button, handoff (errors on fields with focus, success with ticket, history stored), Escape + focus back,
  Enter opens, history after a page change, **foreign CSS doesn't leak in** (font, letter spacing, borders),
  `data-color`/`data-position`, contrast, full screen on phones without horizontal scrolling, tablet,
  no console errors.

Screenshots: [`screenshots/`](screenshots/) (desktop, tablet, phone, handoff, foreign site).

## What's not perfect / limitations

- **Claude mode was not tested against the real API**, because that requires a paid key; request building, response
  handling, and all error paths are tested with a fake SDK client. Run through it once with a real key before going live.
- Keyword search is built for English. Other languages would need their own stopwords, stemming, and synonyms
  (Claude mode, by contrast, answers in the customer's language).
- Borderline cases remain: “Can I change my email address?” is answered with the change-order entry (it looks just
  like “change the shipping address”), and “Do you repot plants for customers?” gets the repotting guide.
- The 40 test questions were written alongside the synonym list, so real-world accuracy will be somewhat lower;
  unanswered questions end up as a handoff, not a wrong answer.
- Rate limiting lives in memory (fine for one server; use e.g. Redis for multiple instances).
- No admin area: FAQ maintenance via the JSON file or Google Sheets import, tickets via email or the JSONL file.
- No live handoff to a human chat agent (the form creates an email ticket).
