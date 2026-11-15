import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCsv, entriesFromCsv, validateEntries, createFaqStore } from '../server/faq.js';

test('CSV: quotes, commas, and line breaks inside fields, doubled quotes', () => {
  const rows = parseCsv('a,b,c\n"x, y","Line 1\nLine 2","says ""Hello"""\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'Line 1\nLine 2', 'says "Hello"']]);
});

test('CSV: semicolon (European Excel), CRLF, BOM, and blank lines', () => {
  const rows = parseCsv('﻿Question;Answer\r\n\r\nA?;B.\r\n');
  assert.deepEqual(rows, [['Question', 'Answer'], ['A?', 'B.']]);
});

test('CSV: an unclosed quote is reported', () => {
  assert.throws(() => parseCsv('a,b\n"broken,1\n'), /never closed/);
});

test('the sample Google Sheets export converts correctly', () => {
  const csv = readFileSync(new URL('../faq/sample-google-sheets-export.csv', import.meta.url), 'utf8');
  const entries = validateEntries(entriesFromCsv(csv));
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0].keywords, ['postage', 'shipping cost', 'free shipping']);
  assert.match(entries[1].answer, /\n/);
  assert.equal(entries[2].id, 'how-often-should-i-water-my-plant', 'a missing ID is generated from the question');
  assert.equal(entries[2].question, 'How often should I "water" my plant?');
  assert.equal(entries[2].category, 'Plant care');
  assert.equal(entries[2].url, undefined);
});

test('German column names from older exports are still recognized', () => {
  const entries = entriesFromCsv('Kategorie;Frage;Antwort;Stichworte\nVersand;Was kostet der Versand?;5,90 €.;porto, versand\n');
  assert.equal(entries[0].question, 'Was kostet der Versand?');
  assert.equal(entries[0].id, 'was-kostet-der-versand');
  assert.deepEqual(entries[0].keywords, ['porto', 'versand']);
});

test('missing required columns and invalid entries are reported clearly', () => {
  assert.throws(() => entriesFromCsv('Title,Text\nx,y\n'), /Question.*Answer/);
  assert.throws(
    () => validateEntries([{ id: 'a', question: 'Q', answer: 'A' }, { id: 'a', question: '', answer: 'A', url: 'ftp://x' }]),
    (err) => /duplicate/.test(err.message) && /question is missing/.test(err.message) && /http/.test(err.message),
  );
});

test('the bundled faq.json is valid', () => {
  const faq = JSON.parse(readFileSync(new URL('../faq/faq.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validateEntries(faq.entries));
  assert.ok(faq.entries.length >= 20);
});

test('the FAQ file is reloaded after a change without a restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'faq-'));
  const file = path.join(dir, 'faq.json');
  writeFileSync(file, JSON.stringify({ company: {}, entries: [{ id: 'a', question: 'Q1', answer: 'A1' }] }));
  const get = createFaqStore(file);
  assert.equal(get().entries[0].question, 'Q1');
  writeFileSync(file, JSON.stringify({ company: {}, entries: [{ id: 'a', question: 'Q2', answer: 'A2' }] }));
  const later = new Date(Date.now() + 5000);
  utimesSync(file, later, later);
  assert.equal(get().entries[0].question, 'Q2');
  rmSync(dir, { recursive: true, force: true });
});
