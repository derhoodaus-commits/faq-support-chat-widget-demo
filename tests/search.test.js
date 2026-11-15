import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, stem, tokenize, buildIndex, search, detectIntent } from '../server/search.js';

const faq = JSON.parse(readFileSync(new URL('../faq/faq.json', import.meta.url), 'utf8'));
const index = buildIndex(faq.entries);
const cases = JSON.parse(readFileSync(new URL('./search-cases.json', import.meta.url), 'utf8'));
// Plausible shop questions the FAQ doesn't (or only partly) cover: [question, expected entry id, or null = fall back]
const offtopic = JSON.parse(readFileSync(new URL('./offtopic-cases.json', import.meta.url), 'utf8'));

test('normalization: case, apostrophes, punctuation, accents, umlauts', () => {
  assert.equal(normalize("Where's my PARCEL?!"), 'wheres my parcel');
  assert.equal(normalize('E-mail  pet-friendly'), 'email pet friendly');
  assert.equal(normalize('Café Größe'), 'cafe groesse');
});

test('stemming strips plural and verb endings, leaves short words alone', () => {
  assert.equal(stem('plants'), 'plant');
  assert.equal(stem('watering'), 'water');
  assert.equal(stem('shipping'), 'ship');
  assert.equal(stem('flies'), 'fly');
  assert.equal(stem('payment'), 'pay');
  assert.equal(stem('damaged'), stem('damage'));
  assert.equal(stem('pot'), 'pot');
  assert.equal(stem('spring'), 'spring');
});

test('stopwords are dropped, synonyms are added', () => {
  assert.deepEqual(tokenize('What is the postage?'), ['postag']);
  const expanded = tokenize('What is the postage?', { expand: true });
  assert.ok(expanded.includes('ship') && expanded.includes('cost'));
});

test(`accuracy: all ${cases.length} paraphrased test questions land confidently on the right entry`, () => {
  const misses = [];
  for (const [q, expected] of cases) {
    const r = search(index, q);
    if (!r.confident || r.results[0]?.entry.id !== expected) misses.push(`${q} → ${r.results[0]?.entry.id} (${r.confident ? 'confident' : 'unsure'})`);
  }
  assert.deepEqual(misses, []);
});

test('typos and run-together words', () => {
  assert.equal(search(index, 'shiping costs').results[0].entry.id, 'shipping-cost');
  assert.equal(search(index, 'returnlabel printing').results[0].entry.id, 'returns');
  assert.equal(search(index, 'trackinglink').results[0].entry.id, 'tracking');
});

test('questions outside the FAQ are not answered confidently', () => {
  for (const q of ['What will the weather be like tomorrow?', 'What is the capital of France?', 'Are you hiring? Any jobs?', 'I want to buy a car', 'asdf qwer', '???']) {
    assert.equal(search(index, q).confident, false, q);
  }
});

test(`${offtopic.length} plausible shop questions get the right entry or the fallback, never an unrelated confident answer`, () => {
  const wrong = [];
  for (const [q, expected] of offtopic) {
    const r = search(index, q);
    const got = r.confident ? r.results[0].entry.id : null;
    if (got !== expected) wrong.push(`${q} → ${got ?? 'fallback'} (expected ${expected ?? 'fallback'})`);
  }
  assert.deepEqual(wrong, []);
});

test('an unknown topic word raises the bar; generic words alone are not enough', () => {
  const r = search(index, 'Do you offer plant care workshops?');
  assert.deepEqual(r.unknown, ['workshops']);
  assert.equal(r.confident, false);
  assert.ok(!r.terms.includes('shop'), '"workshop" must not be split into "work" + "shop"');
  assert.equal(search(index, 'Do you offer a growth guarantee?').results[0].entry.id, 'guarantee');
  assert.equal(search(index, 'Do you offer a growth guarantee?').confident, true);
});

test('phrases: "pay by invoice" means the payment method, not the document', () => {
  assert.equal(search(index, 'Can I pay by invoice?').results[0].entry.id, 'payment-methods');
  assert.equal(search(index, 'Where can I find the invoice?').results[0].entry.id, 'invoice');
  assert.equal(search(index, "My package hasn't arrived yet").results[0].entry.id, 'tracking');
});

test('intents: human, thanks, greeting', () => {
  assert.equal(detectIntent('I want to talk to a human'), 'human');
  assert.equal(detectIntent('Can I speak to a real person?'), 'human');
  assert.equal(detectIntent('Thanks!'), 'thanks');
  assert.equal(detectIntent('Thank you so much'), 'thanks');
  assert.equal(detectIntent('Hello'), 'greeting');
  assert.equal(detectIntent('Hi, how much is shipping?'), null);
});
