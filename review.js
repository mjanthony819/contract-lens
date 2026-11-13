// Review workflow: stable finding keys, recorded decisions, release gate, session files.
import { reportMarkdown } from './engine.js';

export const STATUSES = {
  'accepted-risk': 'Accepted risk',
  'will-migrate': 'Will migrate callers',
  'false-positive': 'Not an issue (explain)',
};
export const POLICIES = { breaking: 'Block on breaking changes', potential: 'Block on breaking and potential risks', review: 'Block on everything, including manual reviews' };
const MAX_DECISIONS = 1000, MAX_NOTE = 500, MAX_BYTES = 1048576;

// Keys do not use the CL-00N counter, so a decision survives reordering between runs.
export function findingKey(f) {
  if (f.reasons && f.location && !f.id) return 'review|' + f.operation + '|' + f.location + '|' + [...f.reasons].sort().join(';');
  return f.kind + '|' + f.operation + '|' + f.location + '|' + f.message;
}
export function reviewKey(r) { return 'review|' + r.operation + '|' + r.location + '|' + [...r.reasons].sort().join(';'); }

export function items(report) {
  return [
    ...report.findings.map(f => ({ key: findingKey(f), tier: f.kind, label: f.id + ' ' + f.operation + ' ' + f.location, ref: f })),
    ...report.review.map(r => ({ key: reviewKey(r), tier: 'review', label: r.operation + ' ' + r.location, ref: r })),
  ];
}

const RANK = { breaking: 1, potential: 2, review: 3 };
// A blocking item passes the gate only when a decision with a note is recorded for it.
export function releaseGate(report, decisions = {}, policy = 'breaking') {
  if (!RANK[policy]) throw Error('Unknown policy: ' + policy);
  const all = items(report), blocking = all.filter(i => RANK[i.tier] <= RANK[policy]);
  const open = blocking.filter(i => !decisions[i.key] || !decisions[i.key].note || !decisions[i.key].note.trim());
  const keys = new Set(all.map(i => i.key));
  const stale = Object.keys(decisions).filter(k => !keys.has(k));
  return { policy, pass: open.length === 0, blocking: blocking.length, decided: blocking.length - open.length, open: open.map(i => i.label), stale: stale.length, staleKeys: stale };
}

export function validateDecisions(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw Error('Decisions must be an object');
  const out = Object.create(null); let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (['__proto__', 'prototype', 'constructor'].includes(k)) throw Error('Unsafe decision key');
    if (++n > MAX_DECISIONS) throw Error('Too many decisions (limit ' + MAX_DECISIONS + ')');
    if (typeof k !== 'string' || k.length > 2000) throw Error('Invalid decision key');
    if (!v || typeof v !== 'object' || !Object.hasOwn(STATUSES, v.status)) throw Error('Invalid decision status for a finding');
    if (typeof v.note !== 'string') throw Error('Decision note must be text');
    out[k] = { status: v.status, note: v.note.slice(0, MAX_NOTE) };
  }
  return { ...out };
}

export function sessionFile(report, decisions, meta = {}) {
  const keys = new Set(items(report).map(i => i.key)); // unmatched (stale) decisions are never written out
  return JSON.stringify({ format: 'contract-lens-review', version: 1, baseline: meta.baseline || null, candidate: meta.candidate || null, decisions: Object.fromEntries(Object.entries(decisions).filter(([k]) => keys.has(k))) }, null, 2);
}
export function parseSession(text) {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw Error('Session file exceeds 1 MiB limit');
  let o; try { o = JSON.parse(text); } catch { throw Error('Session file is not valid JSON'); }
  if (!o || o.format !== 'contract-lens-review' || o.version !== 1) throw Error('Not a Contract Lens review session (version 1)');
  return { baseline: o.baseline ?? null, candidate: o.candidate ?? null, decisions: validateDecisions(o.decisions) };
}

export function reviewMarkdown(report, decisions = {}, policy = 'breaking') {
  const gate = releaseGate(report, decisions, policy);
  let md = reportMarkdown(report);
  const lines = ['', '## Release review', '', 'Policy: ' + POLICIES[policy] + '. Gate: **' + (gate.pass ? 'PASS (all blocking items acknowledged, not fixed)' : 'OPEN') + '** (' + gate.decided + ' of ' + gate.blocking + ' blocking items have a recorded decision and note).', ''];
  for (const i of items(report)) {
    const d = decisions[i.key];
    lines.push('- ' + i.label + ' [' + i.tier + ']: ' + (d ? STATUSES[d.status] + (d.note ? ' - ' + d.note.replace(/\s+/g, ' ') : '') : 'no decision recorded'));
  }
  if (gate.stale) lines.push('', gate.stale + ' saved decision(s) did not match any item in this analysis. They were not applied and are not written to new session files.');
  lines.push('', 'Accepted-risk and will-migrate are waivers or plans. They are not evidence that a migration happened or that the API is compatible.');
  return md + '\n' + lines.join('\n') + '\n';
}
