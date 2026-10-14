// House rules for every tracked or new text file in the repo:
//   no emoji, no en dash (U+2013), no em dash (U+2014), no CSS framework names
//   other than Monsoon, and no mention of who or what wrote the code.
// Test data that needs one of these characters must use an escape sequence.
// Usage: node scripts/check-rules.mjs [files...]   (defaults to git ls-files)
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const binary = /\.(png|jpe?g|gif|ico|webp|avif|pdf|ttf|otf|woff2?|wasm|db|sqlite)$/i;

function listFiles() {
  const args = process.argv.slice(2);
  if (args.length > 0) return args;
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

// Words are assembled from parts so this file does not flag itself.
const w = (...parts) => parts.join('');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (list) => list.map(escape).join('|');

const frameworks = [w('tail', 'wind'), w('boot', 'strap'), w('bul', 'ma'), w('found', 'ation css'), w('materia', 'lize'), w('uni', 'kit'), w('pico', '.css'), w('pico', 'css')];
const authors = [w('Clau', 'de'), w('Anthro', 'pic'), w('Chat', 'GPT'), w('Ope', 'nAI'), w('Co', 'pilot'), w('GP', 'T-4'), w('Gem', 'ini'), w('L', 'LM')];

const frameworkRe = new RegExp(`\\b(${words(frameworks)})\\b`, 'i');
const authorRe = new RegExp(`\\b(${words(authors)})\\b`);
const generatedRe = new RegExp(`\\b${w('A', 'I')}\\b`);
const generatedLongRe = new RegExp(w('artificial', ' intelligence'), 'i');
const symbols = /[©®™]/g;

export const rules = [
  { name: 'en dash', test: (line) => line.includes(String.fromCharCode(0x2013)) },
  { name: 'em dash', test: (line) => line.includes(String.fromCharCode(0x2014)) },
  { name: 'emoji', test: (line) => /\p{Extended_Pictographic}/u.test(line.replace(symbols, '')) },
  { name: 'CSS framework name', test: (line) => frameworkRe.test(line) },
  { name: 'assistant mention', test: (line) => authorRe.test(line) },
  { name: 'generated code mention', test: (line) => generatedRe.test(line) || generatedLongRe.test(line) },
];

const problems = [];
let checked = 0;
for (const file of listFiles()) {
  if (binary.test(file) || file.endsWith('package-lock.json')) continue;
  let text;
  try {
    if (!statSync(file).isFile()) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  checked++;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const rule of rules) {
      if (rule.test(lines[i])) problems.push(`${file}:${i + 1}: ${rule.name}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`House rules broken in ${problems.length} place(s):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`House rules: ${checked} files clean.`);
