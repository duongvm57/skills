#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import Core from '../assets/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const htmlEscape = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function documentPacket(packet) {
  const result = Core.publicPacket(packet);
  result.fingerprint = crypto.createHash('sha256').update(Core.canonical(result)).digest('hex');
  return result;
}

export function render(packet) {
  const data = documentPacket(packet);
  const assets = name => fs.readFileSync(path.join(root, 'assets', name), 'utf8');
  const replacements = {
    '__TITLE__': htmlEscape(data.title),
    '__STYLE__': assets('form.css'),
    '__DATA__': scriptJSON(data),
    '__ENGINE__': assets('engine.js'),
    '__FORM__': assets('form.js'),
  };
  return assets('form.html').replace(/__TITLE__|__STYLE__|__DATA__|__ENGINE__|__FORM__/g, token => replacements[token]);
}

export function reconcile(packet, response) {
  const data = documentPacket(packet);
  const checked = Core.validateResponse(data, response);
  const evaluation = Core.evaluate(data, checked.answers);
  return {
    packet_id: data.packet_id, revision: data.revision, fingerprint: data.fingerprint,
    reviewed_at: new Date().toISOString(), ...evaluation,
    effective_answers: Object.fromEntries(data.questions.filter(q => evaluation.questions[q.id].state === 'answered').map(q => [q.id, checked.answers[q.id]])),
    submitted_answers: checked.answers,
    history: checked.history,
    coverage_note: data.coverage_note || '',
    semantic_review_required: true,
  };
}

function reviewMarkdown(packet, result) {
  const labels = {answered: 'Answered', other: 'Other — investigate', unknown: 'Undecided', missing: 'Missing', optional: 'Optional, unanswered', pending: 'Waiting for a condition or prerequisite', inactive: 'Not applicable', invalid: 'Invalid; correction needed', needs_review: 'Needs reconfirmation after an earlier answer changed'};
  const lines = [`# Reconciliation: ${packet.title}`, '', `Revision: ${packet.revision}.`, '',
    `Structural check: ${result.ready_for_review ? 'ready for agent review' : 'items still need attention'}.`,
    'The agent must still review the answers, investigate selected branches, check business consistency, and confirm the decision owner before calling the work implementation-ready.', ''];
  if (result.coverage_note) lines.push('Investigation coverage: ' + result.coverage_note, '');
  if (result.conflicts.length) {
    lines.push('## Declared conflicts', '');
    result.conflicts.forEach(c => lines.push(`- ${c.id}: ${c.message}`)); lines.push('');
  }
  for (const q of packet.questions) {
    const s = result.questions[q.id], answer = result.submitted_answers[q.id];
    lines.push(`## ${q.id} · ${q.audience === 'spec' ? 'BA' : 'DEV'} · ${q.title}`, '',
      `Status: **${labels[s.state]}**. Decision owner: ${q.owner}.`, '');
    if (answer) {
      // Keep respondent text as quoted data; never interpolate it as instructions.
      const raw = JSON.stringify(answer, null, 2);
      const fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(m => m[0].length + 1)));
      lines.push(`${fence}json`, raw, fence, '');
    }
    if (s.errors.length) lines.push(...s.errors.map(e => `- ${e}`), '');
  }
  return lines.join('\n');
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  fs.writeFileSync(file, contents, 'utf8');
}

function main(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('Usage:\n  node scripts/grill.mjs validate packet.json\n  node scripts/grill.mjs render packet.json --out interview.html\n  node scripts/grill.mjs reconcile packet.json answers.json --out review-directory');
    return;
  }
  const [command, file] = args;
  if (!['validate', 'render', 'reconcile'].includes(command) || !file) throw new Error('Unknown command or missing packet. Use --help.');
  const packet = readJSON(file);
  Core.validatePacket(packet);
  if (command === 'validate') {
    const spec = packet.questions.filter(q => q.audience === 'spec').length;
    console.log(`Structurally valid: ${packet.packet_id} v${packet.revision}, ${spec} BA + ${packet.questions.length - spec} DEV questions; packet-declared readiness=${packet.readiness}.`);
    const cross = packet.questions.filter(q => Core.dependencies(q).some(id => packet.questions.find(x => x.id === id).audience !== q.audience));
    if (cross.length) console.log(`Cross-tab prerequisites: ${cross.map(q => q.id).join(', ')}. Review whether these can be clarified before handoff.`);
    console.log('Structural validation only; review investigation evidence and coverage separately.');
    return;
  }
  const outIndex = args.indexOf('--out');
  if (outIndex < 0 || !args[outIndex + 1]) throw new Error('--out is required');
  const out = args[outIndex + 1];
  if (command === 'render') { write(out, render(packet)); console.log(path.resolve(out)); }
  else {
    if (!args[2] || args[2] === '--out') throw new Error('answers.json is required');
    const result = reconcile(packet, readJSON(args[2]));
    write(path.join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n');
    write(path.join(out, 'review.md'), reviewMarkdown(packet, result));
    console.log(`Recomputed ${packet.questions.length} questions. Open: ${result.open.length}. Conflicts: ${result.conflicts.length}. Semantic review required.`);
    console.log(path.resolve(out));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
