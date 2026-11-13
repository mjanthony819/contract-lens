import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSpec, compareSpecs } from './engine.js';
import { oldSpec, breakingSpec, safeSpec, reviewSpec } from './fixtures.js';
import { items, findingKey, releaseGate, validateDecisions, sessionFile, parseSession, reviewMarkdown } from './review.js';
import { run } from './cli.js';

const rep = (a, b) => compareSpecs(parseSpec(JSON.stringify(a)), parseSpec(JSON.stringify(b)));
const breaking = () => rep(oldSpec, breakingSpec);
const dec = (report, note = 'ok', status = 'will-migrate') => Object.fromEntries(items(report).map(i => [i.key, { status, note }]));

test('finding keys are unique and do not depend on the CL counter', () => {
  const r = breaking(), keys = items(r).map(i => i.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every(k => !/CL-\d/.test(k)));
  const reversed = { ...r, findings: [...r.findings].reverse() };
  assert.deepEqual(new Set(items(reversed).map(i => i.key)), new Set(keys));
});
test('gate is open until every blocking finding has a decision AND a note', () => {
  const r = breaking();
  let g = releaseGate(r, {}, 'breaking');
  assert.equal(g.pass, false); assert.equal(g.blocking, 4); assert.equal(g.open.length, 4);
  const d = dec(r, '');
  assert.equal(releaseGate(r, d, 'breaking').pass, false, 'empty note must not pass');
  assert.equal(releaseGate(r, dec(r, 'ticket 12'), 'breaking').pass, true);
  const first = items(r)[0].key; const partial = { [first]: { status: 'accepted-risk', note: 'x' } };
  g = releaseGate(r, partial, 'breaking'); assert.equal(g.decided, 1); assert.equal(g.open.length, 3);
});
test('policy levels change what blocks', () => {
  const r = rep(oldSpec, reviewSpec);
  assert.equal(r.findings.length, 0); assert.equal(r.review.length, 3);
  assert.equal(releaseGate(r, {}, 'breaking').pass, true);
  assert.equal(releaseGate(r, {}, 'potential').pass, true);
  assert.equal(releaseGate(r, {}, 'review').pass, false);
  assert.equal(releaseGate(rep(oldSpec, safeSpec), {}, 'review').pass, true);
  assert.throws(() => releaseGate(r, {}, 'nope'), /Unknown policy/);
});
test('decisions that match nothing are reported as stale, not silently applied', () => {
  const r = rep(oldSpec, safeSpec);
  const g = releaseGate(r, { 'breaking|GET /x|y|z': { status: 'accepted-risk', note: 'n' } }, 'breaking');
  assert.equal(g.stale, 1); assert.equal(g.pass, true);
});
test('session round trip keeps decisions and rejects bad files', () => {
  const r = breaking(), d = dec(r, 'plan A');
  const back = parseSession(sessionFile(r, d, { baseline: '1.4.0', candidate: '2.0.0' }));
  assert.deepEqual(back.decisions, d); assert.equal(back.candidate, '2.0.0');
  assert.throws(() => parseSession('not json'), /not valid JSON/);
  assert.throws(() => parseSession('{"format":"other"}'), /Not a Contract Lens/);
  assert.throws(() => parseSession(JSON.stringify({ format: 'contract-lens-review', version: 1, decisions: { a: { status: 'bogus', note: '' } } })), /Invalid decision status/);
  assert.throws(() => parseSession('{"format":"contract-lens-review","version":1,"decisions":{"__proto__":{"status":"accepted-risk","note":""}}}'), /Unsafe/);
  assert.throws(() => parseSession('x'.repeat(1048577)), /1 MiB/);
});
test('validateDecisions truncates long notes and limits entry count', () => {
  const v = validateDecisions({ k: { status: 'accepted-risk', note: 'a'.repeat(900) } });
  assert.equal(v.k.note.length, 500);
  const many = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => ['k' + i, { status: 'accepted-risk', note: '' }]));
  assert.throws(() => validateDecisions(many), /Too many/);
  assert.throws(() => validateDecisions([]), /object/);
});
test('markdown report records decisions and the gate', () => {
  const r = breaking(), md = reviewMarkdown(r, { [items(r)[0].key]: { status: 'accepted-risk', note: 'Approved by API council' } }, 'breaking');
  assert.match(md, /Gate: \*\*OPEN\*\* \(1 of 4/); assert.match(md, /Accepted risk - Approved by API council/); assert.match(md, /no decision recorded/);
  assert.match(reviewMarkdown(r, dec(r), 'breaking'), /Gate: \*\*PASS \(all blocking items acknowledged, not fixed\)/);
});
test('CLI exit codes: 1 open, 0 with decisions, 2 on input errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-')), a = join(dir, 'a.json'), b = join(dir, 'b.json'), s = join(dir, 's.json'), bad = join(dir, 'bad.json');
  writeFileSync(a, JSON.stringify(oldSpec)); writeFileSync(b, JSON.stringify(breakingSpec)); writeFileSync(bad, 'x: [');
  let r = run([a, b]); assert.equal(r.code, 1); assert.match(r.out, /Gate \(breaking\): OPEN, 4/);
  writeFileSync(s, sessionFile(breaking(), dec(breaking(), 'tracked')));
  r = run([a, b, '--decisions', s]); assert.equal(r.code, 0); assert.match(r.out, /PASS/);
  assert.equal(run([a, b, '--format', 'json']).code, 1); assert.equal(JSON.parse(run([a, b, '--format', 'json']).out).gate.open.length, 4);
  assert.match(run([a, b, '--format', 'md']).out, /Release review/);
  assert.equal(run([a, bad]).code, 2); assert.equal(run([a]).code, 2); assert.equal(run([a, b, '--fail-on', 'x']).code, 2);
  assert.equal(run([a, b, '--nope', '1']).code, 2); assert.equal(run([a, join(dir, 'missing.json')]).code, 2);
  assert.equal(run([a, b, '--decisions', bad]).code, 2);
  const safe = join(dir, 'safe.json'); writeFileSync(safe, JSON.stringify(safeSpec)); assert.equal(run([a, safe]).code, 0);
});

test('CLI rejects a session with decisions for a different release and labels acknowledged gates honestly', async () => {
  writeFileSync('/tmp/cl-old.json', JSON.stringify(oldSpec)); writeFileSync('/tmp/cl-new.json', JSON.stringify(breakingSpec));
  writeFileSync('/tmp/cl-stale.json', JSON.stringify({ format: 'contract-lens-review', version: 1, decisions: { 'breaking|GET /nope|x|y': { status: 'accepted-risk', note: 'old waiver' } } }));
  const r = run(['/tmp/cl-old.json', '/tmp/cl-new.json', '--decisions', '/tmp/cl-stale.json']);
  assert.equal(r.code, 2); assert.match(r.out, /match no finding/);
  const rp = breaking();
  const d = Object.fromEntries(items(rp).map(i => [i.key, { status: 'will-migrate', note: 'planned' }]));
  writeFileSync('/tmp/cl-ok.json', sessionFile(rp, { ...d, 'x|y|z|w': { status: 'accepted-risk', note: 'stale' } }));
  assert.equal(JSON.parse((await import('node:fs')).readFileSync('/tmp/cl-ok.json', 'utf8')).decisions['x|y|z|w'], undefined);
  const ok = run(['/tmp/cl-old.json', '/tmp/cl-new.json', '--decisions', '/tmp/cl-ok.json']);
  assert.equal(ok.code, 0); assert.match(ok.out, /acknowledged, not fixed/);
});
