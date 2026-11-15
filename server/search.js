// Keyword search for demo mode (no API key needed).
// Pipeline: normalize text → drop stopwords → light English stemming → add synonyms and phrases
// → map typos and word parts to known terms → BM25 ranking with field weights.

const STOPWORDS = new Set(`
a about above after again against all also am an and any are as at be because been before being below between both
but by can could did do does doing done down during each either else ever every few for from further get gets getting
got had has have having he her here hers him his how i if in into is it its itself just let lets me might mine more most
much must my myself no nor now of off on once only or other our ours out over own per please same she should so some
such than that the their theirs them then there these they this those through to too under until up upon us very was we
were what whatever when where whether which while who whom whose why will with within would yet you your yours yourself
im ive id youre dont doesnt didnt cant couldnt wont wouldnt isnt arent wasnt shouldnt thats theres whats wheres hows whens
hi hello hey thanks thank thx cheers ok okay yes yeah sure want wanted wanna need like would know tell question questions
really actually exactly maybe possible possibly anyone someone something anything thing things way ask asking buy buying
u ur pls plz offer offers offering provide provides many certain work works
`.trim().split(/\s+/));

// Everyday wording and variants → terms used in the FAQ (normalized, before stemming)
const SYNONYMS = {
  postage: ['shipping cost'],
  fee: ['cost'],
  fees: ['cost'],
  charge: ['cost'],
  charges: ['cost'],
  delivered: ['delivery'],
  deliver: ['delivery'],
  arrive: ['delivery'],
  arrival: ['arrive', 'delivery'],
  quickly: ['fast', 'delivery'],
  dispatched: ['dispatch'],
  shipment: ['package', 'tracking'],
  parcel: ['package'],
  refund: ['money back'],
  refunds: ['refund', 'money back'],
  refunded: ['refund', 'money back'],
  reimbursed: ['refund'],
  reimbursement: ['refund'],
  repayment: ['refund'],
  returning: ['return'],
  broken: ['damaged'],
  broke: ['damaged'],
  smashed: ['damaged'],
  cracked: ['damaged'],
  crushed: ['damaged'],
  squashed: ['damaged'],
  ruined: ['damaged'],
  defective: ['damaged'],
  paypal: ['payment', 'payment method'],
  klarna: ['payment', 'payment method'],
  visa: ['credit card', 'payment'],
  mastercard: ['credit card', 'payment'],
  amex: ['credit card', 'payment'],
  paying: ['payment'],
  cats: ['cat', 'pet'],
  cat: ['pet'],
  kitten: ['cat', 'pet'],
  kitty: ['cat', 'pet'],
  dogs: ['dog', 'pet'],
  dog: ['pet'],
  puppy: ['dog', 'pet'],
  pets: ['pet'],
  poison: ['toxic'],
  poisonous: ['toxic'],
  harmful: ['toxic'],
  login: ['password'],
  signin: ['password'],
  username: ['password', 'account'],
  locked: ['password', 'account'],
  frost: ['winter'],
  cold: ['winter'],
  freezing: ['winter'],
  snow: ['winter'],
  chilly: ['winter'],
  cancelled: ['cancel'],
  cancelling: ['cancel'],
  canceling: ['cancel'],
  cancellation: ['cancel'],
  modify: ['change'],
  amend: ['change'],
  update: ['change'],
  coupon: ['voucher'],
  promo: ['voucher', 'discount'],
  giftcard: ['gift card', 'voucher'],
  receipt: ['invoice'],
  bill: ['invoice'],
  bugs: ['pests'],
  bug: ['pests'],
  gnats: ['pests'],
  gnat: ['pests'],
  flies: ['pests'],
  fly: ['pests'],
  midges: ['pests'],
  insects: ['pests'],
  mites: ['pests'],
  aphids: ['pests'],
  mealybugs: ['pests'],
  thrips: ['pests'],
  critters: ['pests'],
  holiday: ['vacation'],
  holidays: ['vacation'],
  trip: ['vacation'],
  travel: ['vacation'],
  traveling: ['vacation'],
  travelling: ['vacation'],
  away: ['vacation'],
  agent: ['contact'],
  human: ['contact'],
  person: ['contact'],
  representative: ['contact'],
  call: ['phone', 'contact'],
  phone: ['contact'],
  telephone: ['phone', 'contact'],
  hotline: ['phone', 'contact'],
  hours: ['contact'],
  weekend: ['delivery'],
  weekends: ['weekend', 'delivery'],
  saturday: ['weekend', 'delivery'],
  saturdays: ['weekend', 'delivery'],
  sunday: ['weekend', 'delivery'],
  sundays: ['weekend', 'delivery'],
  // Plant words the FAQ doesn't spell out, so they don't count as unknown topics
  leaf: ['plant'],
  leaves: ['plant'],
  fern: ['plant'],
  ferns: ['plant'],
  cactus: ['plant'],
  cacti: ['plant'],
  succulent: ['plant'],
  succulents: ['plant'],
  orchid: ['plant'],
  orchids: ['plant'],
  ficus: ['plant'],
  palm: ['plant'],
  palms: ['plant'],
  thirsty: ['water'],
  overwater: ['water', 'soggy'],
  overwatered: ['water', 'soggy'],
  transplant: ['repot'],
  replant: ['repot'],
  potting: ['repot', 'pot'],
  outgrown: ['repot', 'bigger'],
  sunlight: ['light', 'sun'],
  sunny: ['sun', 'light'],
  shady: ['shade', 'light'],
  placement: ['spot', 'light'],
  died: ['guarantee'],
  dead: ['guarantee'],
  dying: ['guarantee'],
  dies: ['guarantee'],
  unsubscribe: ['newsletter'],
  spam: ['newsletter', 'emails'],
  overseas: ['countries', 'international'],
  worldwide: ['countries', 'international'],
  uk: ['countries'],
  usa: ['countries'],
};

// Word groups that mean more than the sum of their words
const PHRASES = [
  [/\b(pay later|on account|by invoice|pay (by|with|via) invoice|buy now pay later)\b/, ['payment', 'payment method']],
  [/\b(not|never|hasnt|havent|didnt|still not|not yet) (arrived|come|came|shown up|turned up|been delivered|delivered|here)\b/, ['tracking', 'package', 'status']],
  [/\bwhere is my (order|package|parcel|shipment|delivery|stuff)\b/, ['tracking', 'package', 'status']],
  [/\bmoney back\b/, ['refund']],
  [/\b(send|sending|ship|mail)( \w+){0,3} back\b/, ['return']],
  [/\b(log|sign) ?(in|into|on)\b/, ['password', 'login']],
  [/\b(delivery|shipping) (fee|fees|charge|charges|price)\b/, ['shipping cost']],
  [/\bhow much\b.*\b(ship|shipping|delivery)\b|\b(ship|shipping|delivery)\b.*\bhow much\b/, ['cost']],
  [/\b(promo|discount|coupon) code\b/, ['voucher']],
  [/\b(opening|business|office|service) hours\b|\bwhen are you open\b/, ['contact']],
  [/\b(stop|no more) (sending|emailing|mailing)\b/, ['newsletter', 'unsubscribe']],
];

/** Lowercase, fold umlauts and accents, drop apostrophes and punctuation. */
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/\be-mail/g, 'email')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const hasVowel = (s) => /[aeiouy]/.test(s);
const SUFFIXES = [['ingly', ''], ['edly', ''], ['ments', ''], ['ment', ''], ['ness', ''], ['ing', ''], ['ied', 'y'], ['ed', ''], ['ly', '']];

/** Light English stemmer (plural, -ing, -ed, -ly, -ment, -ness); good enough for FAQ search. */
export function stem(word) {
  let w = word;
  if (w.length <= 3 || /\d/.test(w)) return w;
  // Plural
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (/(sses|ches|shes|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  // One derivational/verbal suffix; the stem must keep at least 3 letters and a vowel ("ly" needs 4)
  for (const [suf, rep] of SUFFIXES) {
    if (!w.endsWith(suf)) continue;
    const base = w.slice(0, -suf.length) + rep;
    if (base.length >= (suf === 'ly' ? 4 : 3) && hasVowel(base)) {
      w = base;
      // "shipping" → "shipp" → "ship", "repotted" → "repott" → "repot"
      if ((suf === 'ing' || suf === 'ed') && /([b-df-hj-km-np-rtv-xz])\1$/.test(w)) w = w.slice(0, -1);
    }
    break;
  }
  // Silent e: "damage"/"damaged" → "damag", "arrive"/"arrived" → "arriv"
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

export function tokenize(text, { expand = false } = {}) {
  const norm = normalize(text);
  const words = norm.split(' ').filter((w) => w && !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)));
  const out = [];
  const add = (phrase) => { for (const part of normalize(phrase).split(' ')) if (part && !STOPWORDS.has(part)) out.push(stem(part)); };
  for (const w of words) {
    out.push(stem(w));
    if (expand && SYNONYMS[w]) SYNONYMS[w].forEach(add);
  }
  if (expand) for (const [re, extra] of PHRASES) if (re.test(norm)) extra.forEach(add);
  return out;
}

/** Levenshtein distance with early exit. */
function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const FIELD_WEIGHTS = { question: 3, keywords: 2.5, category: 1.5, answer: 1 };
const K1 = 1.2;
const B = 0.6;

export function buildIndex(entries) {
  const docs = entries.map((e) => {
    const tf = new Map();
    let len = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const value = field === 'keywords' ? (e.keywords || []).join(' ') : e[field] || '';
      for (const t of tokenize(value)) {
        tf.set(t, (tf.get(t) || 0) + weight);
        len += weight;
      }
    }
    // What the entry is *about*: words of its question and single-word keywords, plus multi-word keywords.
    // A word that only appears in the answer ("proper care") or only modifies a longer keyword ("gift" in
    // "gift card") is not enough to answer confidently.
    const topic = new Set(tokenize(e.question || ''));
    const topicPhrases = [];
    for (const k of e.keywords || []) {
      const parts = tokenize(k);
      if (parts.length === 1) topic.add(parts[0]);
      else if (parts.length > 1) topicPhrases.push(parts);
    }
    return { entry: e, tf, len, topic, topicPhrases };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(docs.length, 1);
  return { docs, df, avgLen, vocab: [...df.keys()] };
}

/** Maps unknown query terms to known ones: typos, word parts, run-together words. */
function resolveTerm(term, index) {
  if (index.df.has(term)) return [{ term, weight: 1 }];
  const found = [];
  // Run-together words: "returnlabel" → "return" + "label", "trackinglink" → "track" + "link".
  // Both ends must be known terms, otherwise "workshop" would turn into "shop".
  const starts = index.vocab.filter((v) => v.length >= 3 && term.length > v.length + 2 && term.startsWith(v));
  const ends = index.vocab.filter((v) => v.length >= 3 && term.length > v.length + 2 && term.endsWith(v));
  for (const a of starts) for (const b of ends) {
    if (a.length + b.length > term.length) continue;
    if (a.length >= 4) found.push({ term: a, weight: 0.7 });
    if (b.length >= 4) found.push({ term: b, weight: 0.7 });
  }
  // Word beginnings: "invo" ↔ "invoice"
  if (!found.length && term.length >= 4) {
    for (const v of index.vocab) if (v.startsWith(term) && v.length > term.length) found.push({ term: v, weight: 0.6 });
  }
  // Typos: at most 1 edit for short words, 2 for long ones
  if (!found.length && term.length >= 5) {
    const max = term.length >= 8 ? 2 : 1;
    let best = max + 1;
    let bestTerms = [];
    for (const v of index.vocab) {
      const d = editDistance(term, v, max);
      if (d < best) { best = d; bestTerms = [v]; } else if (d === best) bestTerms.push(v);
    }
    if (best <= max) for (const v of bestTerms.slice(0, 3)) found.push({ term: v, weight: best === 1 ? 0.85 : 0.65 });
  }
  return found;
}

/**
 * Finds matching FAQ entries.
 * @returns {{ results: Array<{entry, score}>, confident: boolean }}
 */
/** Content words of the query that the FAQ doesn't know at all – not even via synonyms, phrases, typos, or word parts. */
function unknownWords(query, index) {
  const norm = normalize(query);
  const inPhrase = new Set(PHRASES.flatMap(([re]) => norm.match(re)?.[0].split(' ') ?? []));
  const expand = (p) => normalize(p).split(' ').filter((x) => x && !STOPWORDS.has(x)).map(stem);
  return norm.split(' ')
    .filter((w) => w && !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)) && !inPhrase.has(w))
    .filter((w) => ![stem(w), ...(SYNONYMS[w] || []).flatMap(expand)].some((t) => resolveTerm(t, index).length));
}

export function search(index, query, { limit = 3, threshold = 2.6 } = {}) {
  const raw = tokenize(query, { expand: true });
  if (!raw.length) return { results: [], confident: false, terms: [], unknown: [] };
  const terms = new Map();
  for (const t of raw) for (const r of resolveTerm(t, index)) terms.set(r.term, Math.max(terms.get(r.term) || 0, r.weight));

  const N = index.docs.length;
  const scored = index.docs.map((d) => {
    let score = 0;
    let exact = 0; // topic terms matched exactly
    let near = 0; // topic terms matched via typo or word part
    for (const [t, w] of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      if (d.topic.has(t)) w >= 1 ? exact++ : near++;
      const idf = Math.log(1 + (N - index.df.get(t) + 0.5) / (index.df.get(t) + 0.5));
      score += w * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / index.avgLen)));
    }
    // Multi-word keyword: matches if all its words match, or its last word (the head: "card" in "gift card")
    for (const p of d.topicPhrases) {
      const hit = p.every((t) => terms.has(t)) ? Math.max(...p.map((t) => terms.get(t))) : terms.get(p.at(-1));
      if (hit) hit >= 1 ? exact++ : near++;
    }
    return { entry: d.entry, score: Math.round(score * 100) / 100, exact, near };
  });
  scored.sort((a, b) => b.score - a.score);
  const results = scored.filter((s) => s.score > 0).slice(0, limit);
  // Confident only if the top hit scores high enough AND matches its topic (question or keywords) – exactly, or
  // fuzzily with a clearly higher score. Words that only appear in the answer don't count. Every word the FAQ doesn't know raises the bar: in "plant care workshops" or "student discount" the unknown
  // word is usually the actual topic, and a match on the remaining generic words is not a real answer.
  const top = results[0];
  const unknown = unknownWords(query, index);
  const bar = threshold * (1 + 1.5 * unknown.length);
  const confident = Boolean(top) && top.score >= bar && (top.exact > 0 || (top.near > 0 && top.score >= bar * 1.5));
  return { results: results.map(({ exact, near, ...r }) => r), confident, terms: [...terms.keys()], unknown };
}

// ---------- Simple intents (greeting, thanks, human) ----------
const INTENTS = [
  { id: 'human', re: /\b(humans?|real person|actual person|live (agent|person|chat)|(an? |your )?agent|representative|operator|staff member|(speak|talk|chat) (to|with) (a |an |someone|somebody|support|customer service|staff|your team|the team))\b/ },
  { id: 'thanks', re: /^(thanks|thank you|thank u|thx|ty|cheers|many thanks|(ok|okay|great|perfect|awesome|super) thanks?( you)?)\b/ },
  { id: 'greeting', re: /^(hi|hello|hey|hiya|howdy|yo|good (morning|afternoon|evening)|(hi|hello|hey) there)\W*$/ },
];

export function detectIntent(text) {
  const n = normalize(text);
  return INTENTS.find((i) => i.re.test(n))?.id ?? null;
}
