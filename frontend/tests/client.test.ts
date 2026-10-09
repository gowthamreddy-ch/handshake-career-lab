import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationDrafts, jobQuery, motivationError, SubmissionIntent, displayDate } from '../src/domain.js';
import { api, ApiError, getSession } from '../src/api.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('search preserves AND query and exact filters, safely encoding special characters', () => {
  assert.equal(jobQuery('  C# & .NET  ', 'On-site', 'Engineering'), '?q=C%23+%26+.NET&workMode=On-site&department=Engineering');
  assert.equal(jobQuery(' ', '', ''), '');
});

test('a lost-response retry keeps its idempotency key; changed intent gets a new key', () => {
  let next = 0; const intent = new SubmissionIntent(() => `request-${++next}`);
  assert.equal(intent.key('42', 'My introduction'), 'request-1');
  assert.equal(intent.key(42, 'My introduction'), 'request-1');
  assert.equal(intent.key('42', 'Changed introduction'), 'request-2');
  assert.equal(intent.key('43', 'Changed introduction'), 'request-3');
});

test('motivation validates non-whitespace length and preserves the content', () => {
  assert.ok(motivationError(' '.repeat(100)));
  assert.ok(motivationError('a'.repeat(49)));
  assert.equal(motivationError('a'.repeat(50)), null);
  assert.equal(motivationError('a'.repeat(2000)), null);
  assert.ok(motivationError('a'.repeat(2001)));
});

test('application drafts and retry keys survive a modal/session interruption without crossing accounts', () => {
  const drafts = new ApplicationDrafts();
  const first = drafts.get('candidate-one', 42);
  first.motivation = 'My introduction remains available after signing back in.';
  const firstKey = first.intent.key(42, first.motivation);
  const resumed = drafts.get('candidate-one', '42');
  assert.equal(resumed.motivation, first.motivation);
  assert.equal(resumed.intent.key('42', resumed.motivation), firstKey);
  assert.equal(drafts.get('candidate-two', 42).motivation, '');
  assert.equal(drafts.get('candidate-one', 43).motivation, '');
  drafts.clear();
  assert.equal(drafts.get('candidate-one', 42).motivation, '');
});

test('dates are explicit and stable across browser time zones', () => {
  assert.equal(displayDate('2026-10-08T00:00:00Z'), 'Oct 8, 2026');
  assert.equal(displayDate('unavailable'), 'Date unavailable');
});

test('writes send same-origin credentials, a refreshed CSRF token, and the caller idempotency key', async () => {
  const seen: RequestInit[] = [];
  globalThis.fetch = (async (_input, init) => {
    seen.push(init!);
    return new Response(JSON.stringify(seen.length === 1 ? { user: null, csrfToken: 'anonymous-token', demo: {} } : seen.length === 2 ? { user: { id: 1 }, csrfToken: 'signed-in-token', demo: {} } : { id: 1 }), { status: 200 });
  }) as typeof fetch;
  await getSession(); await getSession();
  await api('/applications', { method: 'POST', body: '{}', headers: { 'Idempotency-Key': 'same-intent' } });
  const headers = new Headers(seen[2].headers);
  assert.equal(headers.get('X-CSRF-TOKEN'), 'signed-in-token');
  assert.equal(headers.get('Idempotency-Key'), 'same-intent');
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(seen[2].credentials, 'same-origin');
});

test('idempotent delete accepts an empty 204 response', async () => {
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  assert.equal(await api('/saved/1', { method: 'DELETE', body: '{}' }), undefined);
});

test('API rejection preserves useful server errors without retrying writes', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ error: 'You already applied to this internship.' }), { status: 409 }); }) as typeof fetch;
  await assert.rejects(api('/applications', { method: 'POST', body: '{}' }), error => error instanceof ApiError && error.status === 409 && error.message.includes('already applied'));
  assert.equal(calls, 1);
});

test('network failure stays actionable and does not leak transport details', async () => {
  globalThis.fetch = (async () => { throw new Error('internal connection information'); }) as typeof fetch;
  await assert.rejects(api('/jobs'), error => error instanceof ApiError && error.status === 0 && error.message.includes('local API') && !error.message.includes('internal connection'));
});

test('aborted searches propagate cancellation so stale results can be discarded', async () => {
  globalThis.fetch = (async () => { throw new DOMException('Canceled', 'AbortError'); }) as typeof fetch;
  await assert.rejects(api('/jobs'), error => error instanceof Error && error.name === 'AbortError');
});
