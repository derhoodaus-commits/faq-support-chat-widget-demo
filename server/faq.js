// Loading, validating, and importing the FAQ (JSON or a CSV export from Google Sheets).
import { readFileSync, statSync } from 'node:fs';

/** RFC 4180 CSV parser: quotes, commas, and line breaks inside fields, "" as escape. */
export function parseCsv(text, delimiter) {
  const src = text.replace(/^﻿/, '');
  const sep = delimiter || (src.split('\n')[0].split(';').length > src.split('\n')[0].split(',').length ? ';' : ',');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error('CSV: a quotation mark was never closed.');
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

// English column names; German names from older exports are still accepted
const HEADER_ALIASES = {
  id: ['id', 'key', 'schluessel'],
  category: ['category', 'section', 'topic', 'kategorie', 'bereich'],
  question: ['question', 'frage'],
  answer: ['answer', 'antwort'],
  keywords: ['keywords', 'tags', 'stichworte', 'stichwoerter', 'schlagworte'],
  url: ['link', 'url', 'source', 'quelle'],
};

// Umlaut folding keeps German column names and questions slug-safe
const slug = (s) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** Turns CSV rows (first row = headers) into FAQ entries. */
export function entriesFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV contains no data rows.');
  const header = rows[0].map((h) => slug(h).replace(/-/g, ''));
  const col = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  if (col.question === undefined || col.answer === undefined) {
    throw new Error('CSV needs at least the columns "Question" and "Answer".');
  }
  return rows.slice(1).map((r) => {
    const get = (k) => (col[k] === undefined ? '' : (r[col[k]] || '').trim());
    return {
      id: get('id') || slug(get('question')),
      category: get('category') || 'General',
      question: get('question'),
      answer: get('answer'),
      keywords: get('keywords').split(/[,;|]/).map((k) => k.trim()).filter(Boolean),
      url: get('url') || undefined,
    };
  });
}

/** Validates FAQ entries. Throws one error listing every problem (1-based entry numbers). */
export function validateEntries(entries) {
  const problems = [];
  const ids = new Set();
  if (!Array.isArray(entries) || entries.length === 0) problems.push('No FAQ entries found.');
  (entries || []).forEach((e, i) => {
    const where = `Entry ${i + 1}${e?.id ? ` (${e.id})` : ''}`;
    if (!e || typeof e !== 'object') return problems.push(`${where}: invalid.`);
    if (!e.id || !/^[a-z0-9-]+$/.test(e.id)) problems.push(`${where}: id is missing or contains characters other than a–z, 0–9, and "-".`);
    if (ids.has(e.id)) problems.push(`${where}: duplicate id.`);
    ids.add(e.id);
    if (!e.question?.trim()) problems.push(`${where}: question is missing.`);
    if (!e.answer?.trim()) problems.push(`${where}: answer is missing.`);
    if (e.answer && e.answer.length > 2000) problems.push(`${where}: answer is longer than 2000 characters.`);
    if (e.url && !/^https?:\/\//.test(e.url)) problems.push(`${where}: link must start with http(s)://.`);
  });
  if (problems.length) throw new Error('Invalid FAQ:\n- ' + problems.join('\n- '));
  return entries;
}

/** Reloads the FAQ file whenever it changes (edits take effect without a restart). */
export function createFaqStore(file) {
  let cache = null;
  let mtime = 0;
  return () => {
    const m = statSync(file).mtimeMs;
    if (!cache || m !== mtime) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      validateEntries(data.entries);
      cache = data;
      mtime = m;
    }
    return cache;
  };
}
