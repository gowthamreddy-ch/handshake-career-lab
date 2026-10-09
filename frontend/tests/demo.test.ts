import { test } from 'node:test';
import assert from 'node:assert/strict';
import catalogJson from '../src/catalog.json' with { type: 'json' };
import { createDemoApi, DEMO_STORAGE_KEY, DemoError, type DemoStorage } from '../src/demo.js';
import { IS_PAGES_DEMO } from '../src/mode.js';
import type { Application, Job, Session } from '../src/types.js';

class MemoryStorage implements DemoStorage {
  values = new Map<string, string>();
  writes = 0; failRead = false; failWrite = false; failRemove = false;
  getItem(key: string) { if (this.failRead) throw new Error('denied'); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrite) throw new Error('quota'); this.writes++; this.values.set(key, value); }
  removeItem(key: string) { if (this.failRemove) throw new Error('denied'); this.values.delete(key); }
}
const catalog = catalogJson as Job[];
const note = 'I would like to build thoughtful software with this fictional team and practice communicating my engineering decisions.';
const uuid = (value: number) => `${value.toString(16).padStart(8, '0')}-1234-4000-8000-123456789abc`;
const post = (body: unknown = {}, key?: string): RequestInit => ({ method: 'POST', body: JSON.stringify(body), headers: key ? { 'Idempotency-Key': key } : undefined });
const rejects = (status: number) => (error: unknown) => error instanceof DemoError && error.status === status;

function setup(storage = new MemoryStorage()) {
  let id = 1; let time = new Date('2026-10-08T18:00:00Z');
  const api = createDemoApi({ catalog, storage, createId: () => uuid(id++), now: () => time });
  return { api, storage, setTime: (value: string) => { time = new Date(value); } };
}

test('Node defaults to the real API mode; Pages simulation needs the explicit build flag', () => {
  assert.equal(IS_PAGES_DEMO, false);
});

test('synthetic search preserves literal AND terms and exact filters without silently broadening', async () => {
  const { api } = setup();
  const full = await api.request<{ items: Job[]; total: number; dataLabel: string }>('/jobs');
  assert.equal(full.total, 12);
  assert.equal(full.dataLabel, 'Synthetic demonstration catalog');
  const result = await api.request<{ items: Job[]; total: number }>('/jobs?' + new URLSearchParams({ q: 'C# .NET', workMode: 'Hybrid', department: 'Engineering' }));
  assert.ok(result.total > 0);
  assert.ok(result.items.every(job => job.workMode === 'Hybrid' && job.department === 'Engineering'));
  const noResult = await api.request<{ items: Job[]; total: number }>('/jobs?' + new URLSearchParams({ q: 'C# .NET', department: 'Design' }));
  assert.deepEqual(noResult.items, []);
  assert.equal(noResult.total, 0);
  assert.deepEqual((await api.request<{ items: Job[] }>('/jobs?' + new URLSearchParams({ q: "' OR 1=1 --" }))).items, []);
  for (const query of ['workMode=Anywhere', 'department=Unknown', 'q=' + 'x'.repeat(121), 'q=one&q=two', 'unknown=value']) {
    await assert.rejects(api.request('/jobs?' + query), rejects(400));
  }
  assert.deepEqual(await api.request('/jobs/1'), full.items.find(job => job.id === 1));
  await assert.rejects(api.request('/jobs/99999'), rejects(404));
});

test('passwordless Maya session persists without accepting or storing account credentials', async () => {
  const { api, storage } = setup();
  assert.deepEqual(await api.request('/session'), { user: null, csrfToken: 'pages-demo-no-security-boundary', demo: null });
  await assert.rejects(api.request('/saved'), rejects(401));
  await assert.rejects(api.request('/auth/login', post({ email: 'someone@example.test', password: 'not-sent' })), rejects(405));
  await assert.rejects(api.request('/auth/register', post({ name: 'Someone' })), rejects(405));
  const started = await api.request<Session>('/demo/start', post());
  assert.equal(started.user?.name, 'Maya Chen');
  assert.equal(started.demo, null);
  const restored = setup(storage).api;
  assert.deepEqual(await restored.request('/session'), started);
  assert.doesNotMatch(storage.getItem(DEMO_STORAGE_KEY)!, /password|credential|token|someone@example|not-sent/i);
});

test('saved roles are idempotent, survive reload, and remain after leaving the persona', async () => {
  const { api, storage } = setup();
  await api.request('/demo/start', post());
  await Promise.all(Array.from({ length: 4 }, () => api.request('/saved/1', { method: 'PUT', body: '{}' })));
  assert.equal((await api.request<{ items: Job[] }>('/saved')).items.length, 1);
  await api.request('/auth/logout', post());
  assert.equal((await api.request<Session>('/session')).user, null);
  await assert.rejects(api.request('/saved'), rejects(401));
  const restored = setup(storage).api;
  await restored.request('/demo/start', post());
  assert.equal((await restored.request<{ items: Job[] }>('/saved')).items[0].id, 1);
  await restored.request('/saved/1', { method: 'DELETE', body: '{}' });
  await restored.request('/saved/1', { method: 'DELETE', body: '{}' });
  assert.deepEqual((await restored.request<{ items: Job[] }>('/saved')).items, []);
});

test('application retries and withdrawal preserve one application and stable history', async () => {
  const { api, storage, setTime } = setup();
  await api.request('/demo/start', post());
  const payload = { jobId: 1, motivation: note };
  const key = uuid(101);
  const first = await api.request<Application>('/applications', post(payload, key));
  assert.equal(first.status, 'Submitted');
  assert.equal(first.events.length, 1);
  assert.equal(first.submittedAt, '2026-10-08T18:00:00.000Z');
  const replay = await api.request('/applications', post(payload, key.toUpperCase()));
  assert.deepEqual(replay, first);
  await assert.rejects(api.request('/applications', post({ ...payload, motivation: note + ' More detail.' }, key)), rejects(409));
  await assert.rejects(api.request('/applications', post(payload, uuid(102))), rejects(409));
  await assert.rejects(api.request('/applications', post({ ...payload, jobId: 2 }, key)), rejects(409));
  setTime('2026-10-08T19:00:00Z');
  const withdrawn = await api.request<Application>(`/applications/${first.id}/withdraw`, post());
  assert.equal(withdrawn.status, 'Withdrawn');
  assert.deepEqual(withdrawn.events.map(event => event.status), ['Submitted', 'Withdrawn']);
  setTime('2026-10-08T20:00:00Z');
  assert.deepEqual(await api.request(`/applications/${first.id}/withdraw`, post()), withdrawn);
  // A later retry returns the persisted current application, including withdrawal.
  const restored = setup(storage).api;
  assert.deepEqual(await restored.request('/applications', post(payload, key)), withdrawn);
  assert.deepEqual((await restored.request<{ items: Application[] }>('/applications')).items, [withdrawn]);
});

test('simultaneous same-tab calls with one retry key converge without duplicate applications', async () => {
  const { api } = setup();
  await api.request('/demo/start', post());
  const results = await Promise.all(Array.from({ length: 8 }, () => api.request<Application>('/applications', post({ jobId: 2, motivation: note }, uuid(200)))));
  results.forEach(result => assert.deepEqual(result, results[0]));
  assert.equal((await api.request<{ items: Application[] }>('/applications')).items.length, 1);
  const withdrawals = await Promise.all(results.map(result => api.request(`/applications/${result.id}/withdraw`, post())));
  withdrawals.forEach(result => assert.deepEqual(result, withdrawals[0]));
});

test('invalid routes, payloads, keys, and canceled actions do not mutate the simulation', async () => {
  const { api, storage } = setup();
  await api.request('/demo/start', post());
  const before = storage.getItem(DEMO_STORAGE_KEY);
  const invalid: [string, RequestInit, number][] = [
    ['/applications', post({ jobId: 1, motivation: note }), 400],
    ['/applications', post({ jobId: 1, motivation: note }, 'not-a-uuid'), 400],
    ['/applications', post({ jobId: '1', motivation: note }, uuid(1)), 400],
    ['/applications', post({ jobId: 1, motivation: 'short' }, uuid(1)), 400],
    ['/applications', post({ jobId: 1, motivation: ' '.repeat(60) }, uuid(1)), 400],
    ['/applications', post({ jobId: 1, motivation: 'x'.repeat(2001) }, uuid(1)), 400],
    ['/applications', post({ jobId: 1, motivation: note, status: 'Withdrawn' }, uuid(1)), 400],
    ['/applications', post({ jobId: 9000, motivation: note }, uuid(1)), 404],
    ['/applications', { method: 'POST', body: '{bad' }, 400],
    ['/applications', post(null), 400],
    ['/demo/start', post({ userId: 'someone-else' }), 400],
    ['/saved/1', { method: 'PATCH', body: '{}' }, 405],
    ['/unknown', post(), 404],
    ['https://elsewhere.invalid/session', {}, 404],
    ['//elsewhere.invalid/session', {}, 404],
    ['/session?admin=true', {}, 400],
  ];
  for (const [path, options, status] of invalid) await assert.rejects(api.request(path, options), rejects(status));
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(api.request('/saved/1', { method: 'PUT', body: '{}', signal: canceled.signal }), error => error instanceof Error && error.name === 'AbortError');
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), before);
});

test('response and input catalog mutation cannot change future reads', async () => {
  const input = structuredClone(catalog);
  const api = createDemoApi({ catalog: input, storage: new MemoryStorage() });
  input[0].title = 'Unexpected modification';
  const job = await api.request<Job>('/jobs/1');
  job.title = 'Also modified'; job.requirements.push('Injected requirement');
  const unchanged = await api.request<Job>('/jobs/1');
  assert.equal(unchanged.title, catalog[0].title);
  assert.deepEqual(unchanged.requirements, catalog[0].requirements);
  await api.request('/demo/start', post());
  const application = await api.request<Application>('/applications', post({ jobId: 1, motivation: note }, uuid(2)));
  application.events.push({ status: 'Invented', at: '2026-10-08T19:00:00Z' });
  application.job.skills.push('Injected');
  const saved = (await api.request<{ items: Application[] }>('/applications')).items[0];
  assert.equal(saved.events.length, 1);
  assert.deepEqual(saved.job.skills, catalog[0].skills);
});

test('corrupt or unsupported storage is preserved until explicit app-scoped reset', async () => {
  const { api, storage } = setup();
  storage.setItem('another-app:important', 'keep this');
  for (const corrupt of ['{broken', 'null', JSON.stringify({ version: 2 }), 'x'.repeat(256_001)]) {
    storage.setItem(DEMO_STORAGE_KEY, corrupt);
    await assert.rejects(api.request('/session'), error => error instanceof DemoError && error.status === 503 && error.message.includes('Reset demo'));
    await assert.rejects(api.request('/demo/start', post()), rejects(503));
    assert.equal(storage.getItem(DEMO_STORAGE_KEY), corrupt, 'Do not silently overwrite unreadable data');
    assert.equal((await api.request<{ total: number }>('/jobs')).total, 12, 'Public catalog remains browsable');
  }
  const reset = await api.request<Session>('/demo/reset', post());
  assert.equal(reset.user, null);
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), null);
  assert.equal(storage.getItem('another-app:important'), 'keep this');
  await api.request('/demo/start', post());
  assert.deepEqual((await api.request<{ items: Job[] }>('/saved')).items, []);
  assert.deepEqual((await api.request<{ items: Application[] }>('/applications')).items, []);
});

test('stored state invariants reject tampered IDs, history, duplicate records, and replay fingerprints', async () => {
  const { api, storage } = setup();
  await api.request('/demo/start', post());
  await api.request('/applications', post({ jobId: 1, motivation: note }, uuid(9)));
  const valid = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
  const changes = [
    (state: typeof valid) => { state.savedIds = [99999]; },
    (state: typeof valid) => { state.savedIds = [1, 1]; },
    (state: typeof valid) => { state.active = 'yes'; },
    (state: typeof valid) => { state.applications[0].status = 'Accepted'; },
    (state: typeof valid) => { state.applications[0].jobId = 99999; },
    (state: typeof valid) => { state.applications[0].events[0].at = 'not-a-date'; },
    (state: typeof valid) => { state.applications.push(state.applications[0]); },
    (state: typeof valid) => { state.replays[0].fingerprint = 'forged'; },
    (state: typeof valid) => { state.replays = []; },
    (state: typeof valid) => { state.password = 'unexpected'; },
  ];
  for (const change of changes) {
    const altered = structuredClone(valid); change(altered); const raw = JSON.stringify(altered); storage.setItem(DEMO_STORAGE_KEY, raw);
    await assert.rejects(api.request('/session'), rejects(503));
    assert.equal(storage.getItem(DEMO_STORAGE_KEY), raw);
  }
});

test('denied and quota-limited storage produce explicit errors without dropping previous state', async () => {
  const { api, storage } = setup();
  storage.failRead = true;
  await assert.rejects(api.request('/session'), error => error instanceof DemoError && error.message.includes('Allow site storage'));
  storage.failRead = false;
  await api.request('/demo/start', post());
  const before = storage.getItem(DEMO_STORAGE_KEY);
  storage.failWrite = true;
  await assert.rejects(api.request('/saved/1', { method: 'PUT', body: '{}' }), rejects(503));
  await assert.rejects(api.request('/applications', post({ jobId: 1, motivation: note }, uuid(50))), rejects(503));
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), before);
  assert.deepEqual((await api.request<{ items: Application[] }>('/applications')).items, []);
  storage.failWrite = false;
  await api.request('/applications', post({ jobId: 1, motivation: note }, uuid(50)));
  assert.equal((await api.request<{ items: Application[] }>('/applications')).items.length, 1);
  storage.failRemove = true;
  const existing = storage.getItem(DEMO_STORAGE_KEY);
  await assert.rejects(api.request('/demo/reset', post()), rejects(503));
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), existing);
  const deniedGetter = createDemoApi({ catalog, storage: () => { throw new Error('SecurityError'); } });
  await assert.rejects(deniedGetter.request('/session'), rejects(503));
});

test('browser simulator never calls fetch while exercising the complete fictional workflow', async () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = (async () => { requests++; throw new Error('No network allowed'); }) as typeof fetch;
  try {
    const { api } = setup();
    await api.request('/session'); await api.request('/jobs'); await api.request('/demo/start', post());
    await api.request('/saved/1', { method: 'PUT', body: '{}' });
    const created = await api.request<Application>('/applications', post({ jobId: 1, motivation: note }, uuid(60)));
    await api.request(`/applications/${created.id}/withdraw`, post()); await api.request('/auth/logout', post()); await api.request('/demo/reset', post());
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});
