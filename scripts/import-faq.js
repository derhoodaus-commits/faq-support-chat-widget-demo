// Imports a CSV export from Google Sheets (File → Download → CSV) into faq/faq.json.
// Usage: npm run faq:import -- path/to/file.csv [--dry-run]
// Columns (case-insensitive): Question, Answer, optional ID, Category, Keywords (comma-separated), Link.
// German column names (Frage, Antwort, Kategorie, Stichworte) are accepted too.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entriesFromCsv, validateEntries } from '../server/faq.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry-run');

if (!file) {
  console.error('Please specify a CSV file: npm run faq:import -- faq/sample-google-sheets-export.csv');
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(2);
}
try {
  const entries = validateEntries(entriesFromCsv(readFileSync(file, 'utf8')));
  const target = path.join(root, 'faq', 'faq.json');
  const current = JSON.parse(readFileSync(target, 'utf8'));
  const next = { ...current, entries };
  if (dry) console.log(`Dry run: ${entries.length} entries are valid; faq.json was not changed.`);
  else {
    writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
    console.log(`Wrote ${entries.length} entries to faq/faq.json. The server picks them up without a restart.`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
