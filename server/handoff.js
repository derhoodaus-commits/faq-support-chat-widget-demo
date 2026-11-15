// Handoff to a person: validate the request, store it as a ticket and, if SMTP is configured, send it by email.
import { appendFile, mkdir } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import nodemailer from 'nodemailer';

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeTicket = () => 'FH-' + Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export function validateHandoff(input = {}) {
  const value = {
    name: typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '',
    email: typeof input.email === 'string' ? input.email.trim().toLowerCase() : '',
    message: typeof input.message === 'string' ? input.message.trim() : '',
    consent: input.consent === true,
    transcript: (Array.isArray(input.transcript) ? input.transcript : [])
      .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string')
      .slice(-40)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) })),
    page: typeof input.page === 'string' ? input.page.slice(0, 300) : '',
  };
  const errors = {};
  if (value.name.length < 2) errors.name = 'Please enter your name.';
  else if (value.name.length > 80) errors.name = 'That name is too long.';
  if (!EMAIL_RE.test(value.email) || value.email.length > 254) errors.email = 'Please check your email address.';
  if (value.message.length < 5) errors.message = 'Please briefly describe what you need.';
  else if (value.message.length > 2000) errors.message = 'Please keep it under 2000 characters.';
  if (!value.consent) errors.consent = 'Please agree to share your details with our team.';
  return { ok: Object.keys(errors).length === 0, errors, value };
}

export function formatMail(ticket, h, companyName) {
  const lines = [
    `New request from the chat widget (${companyName})`,
    `Ticket: ${ticket}`,
    `Name: ${h.name}`,
    `Email: ${h.email}`,
    h.page ? `Page: ${h.page}` : null,
    '',
    'Message:',
    h.message,
    '',
    h.transcript.length ? 'Chat history:' : 'No chat history included.',
    ...h.transcript.map((m) => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.text}`),
  ].filter((l) => l !== null);
  return { subject: `[${ticket}] Chat request from ${h.name}`, text: lines.join('\n') };
}

/**
 * @param {object} opts
 * @param {string} opts.dataDir   folder for handoffs.jsonl
 * @param {object} [opts.transport] nodemailer transport (tests); otherwise built from SMTP_* env variables
 */
export function createHandoffService({ dataDir, transport, env = process.env, companyName = 'Shop' }) {
  let mailer = transport ?? null;
  if (!mailer && env.SMTP_HOST) {
    mailer = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT) || 587,
      secure: env.SMTP_SECURE === 'true',
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  const to = env.SUPPORT_EMAIL || 'help@farnhaus.example';
  const from = env.MAIL_FROM || 'chat-widget@farnhaus.example';

  return {
    mailEnabled: Boolean(mailer),
    async submit(value) {
      const ticket = makeTicket();
      await mkdir(dataDir, { recursive: true });
      await appendFile(path.join(dataDir, 'handoffs.jsonl'), JSON.stringify({ ticket, ...value, createdAt: new Date().toISOString() }) + '\n');
      let mailed = false;
      if (mailer) {
        const { subject, text } = formatMail(ticket, value, companyName);
        await mailer.sendMail({ from, to, replyTo: value.email, subject, text });
        mailed = true;
      }
      return { ticket, mailed };
    },
  };
}
