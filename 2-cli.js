#!/usr/bin/env node
// Contract Lens CLI: compare two OpenAPI 3.0 files and gate a release. Reads local files only.
import { readFileSync, statSync } from 'node:fs';
import { parseSpec, compareSpecs } from './engine.js';
import { items, releaseGate, parseSession, reviewMarkdown, POLICIES } from './review.js';

const USAGE = 'Usage: node cli.js <baseline.(json|yaml)> <candidate.(json|yaml)> [--fail-on breaking|potential|review] [--decisions session.json] [--format text|json|md]\nExit codes: 0 gate passes, 1 gate open, 2 input error.';
function read(path) { if (statSync(path).size > 1048576) throw Error(path + ' exceeds 1 MiB limit'); return readFileSync(path, 'utf8'); }

export function run(argv) {
  const pos = [], opt = { 'fail-on': 'breaking', format: 'text' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { code: 0, out: USAGE };
    if (a.startsWith('--')) { const k = a.slice(2); if (!['fail-on', 'decisions', 'format'].includes(k)) return { code: 2, out: 'Unknown option ' + a + '\n' + USAGE }; if (i + 1 >= argv.length) return { code: 2, out: 'Missing value for ' + a }; opt[k] = argv[++i]; } else pos.push(a);
  }
  if (pos.length !== 2) return { code: 2, out: USAGE };
  if (!POLICIES[opt['fail-on']]) return { code: 2, out: 'Unknown --fail-on value. Use breaking, potential or review.' };
  if (!['text', 'json', 'md'].includes(opt.format)) return { code: 2, out: 'Unknown --format value. Use text, json or md.' };
  try {
    const report = compareSpecs(parseSpec(read(pos[0])), parseSpec(read(pos[1])));
    const decisions = opt.decisions ? parseSession(read(opt.decisions)).decisions : {};
    const gate = releaseGate(report, decisions, opt['fail-on']);
    if (gate.stale) return { code: 2, out: 'Error: ' + gate.stale + ' decision(s) in the session file match no finding in this comparison (stale or for a different release). Regenerate the session; unrelated waivers are not carried over.' };
    let out;
    if (opt.format === 'json') out = JSON.stringify({ gate, report }, null, 2);
    else if (opt.format === 'md') out = reviewMarkdown(report, decisions, opt['fail-on']);
    else {
      const l = ['Contract Lens: ' + report.operations.length + ' baseline operations, ' + report.findings.length + ' findings, ' + report.review.length + ' manual reviews.'];
      for (const i of items(report)) l.push(' - [' + i.tier + '] ' + i.label + (decisions[i.key] ? ' (decision: ' + decisions[i.key].status + ')' : ''));
      l.push('Gate (' + opt['fail-on'] + '): ' + (gate.pass ? 'PASS (all blocking items acknowledged, not fixed; waivers are not compatibility evidence)' : 'OPEN, ' + gate.open.length + ' blocking item(s) without a decision and note') + (gate.stale ? '; ' + gate.stale + ' stale decision(s) ignored' : ''));
      l.push('No findings is not proof of compatibility. Scope: bounded OpenAPI 3.0 subset.');
      out = l.join('\n');
    }
    return { code: gate.pass ? 0 : 1, out };
  } catch (e) { return { code: 2, out: 'Error: ' + e.message }; }
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) { const r = run(process.argv.slice(2)); (r.code === 2 ? console.error : console.log)(r.out); process.exitCode = r.code; }
