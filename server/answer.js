// Demo-mode answers (keyword search + small talk) and the public widget config.
// Browser-safe on purpose (no Node imports): the server uses it for /api/*, and the static
// GitHub Pages build ships this file plus search.js unchanged so the widget can answer in the browser.
import { search, detectIntent } from './search.js';

export { buildIndex } from './search.js';

export const SMALLTALK = {
  greeting: 'Hi there! Ask me anything about shipping, returns, payment, or plant care.',
  thanks: "You're welcome! Anything else I can help with?",
  human: 'Happy to connect you with our team. Tap “Talk to a person” and your message will reach us along with this chat.',
};

export const toSource = (e) => ({ id: e.id, question: e.question, category: e.category, url: e.url || null });

/** What the widget needs to know about the company (same shape as GET /api/config). */
export function configFromFaq(faq, mode) {
  const { company } = faq;
  return {
    name: company.name, assistantName: company.assistantName, greeting: company.greeting,
    suggestions: company.suggestions || [], supportHours: company.supportHours, mode, note: company.note,
  };
}

/** Greeting, thanks, or "talk to a human" — or null if the message is a real question. */
export function smalltalkReply(message, mode = 'demo') {
  const intent = detectIntent(message);
  return intent ? { kind: intent === 'human' ? 'handoff' : 'smalltalk', text: SMALLTALK[intent], sources: [], mode } : null;
}

/** Answer from keyword search: the top FAQ entry if confident, otherwise an honest "unsure" with suggestions. */
export function keywordReply(index, message, found = search(index, message)) {
  if (found.confident) {
    const top = found.results[0].entry;
    const related = found.results.slice(1).filter((r) => r.score >= found.results[0].score * 0.6).map((r) => toSource(r.entry));
    return { kind: 'answer', text: top.answer, sources: [toSource(top)], related, mode: 'demo' };
  }
  return {
    kind: 'unsure',
    text: found.results.length
      ? "I couldn't find a reliable answer to that. Did you mean one of these questions? If not, our team is happy to help."
      : "Sorry, I couldn't find anything about that in our FAQ. Our team is happy to help — just tap “Talk to a person.”",
    sources: [],
    related: found.results.slice(0, 3).map((r) => toSource(r.entry)),
    mode: 'demo',
  };
}

/** Full demo-mode reply, exactly as the server gives it without an API key. */
export function demoReply(index, message) {
  return smalltalkReply(message) ?? keywordReply(index, message);
}
