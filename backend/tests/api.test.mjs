import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

// Run only against the separately started disposable integration-test database.
// Port 4191 is the interactive demo and must never receive these test writes.
const base = new URL(process.env.HANDSHAKE_TEST_URL || 'http://127.0.0.1:4192');
const absentJobId = 2147483647;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    || base.port !== '4192' || base.protocol !== 'http:'
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('HANDSHAKE_TEST_URL must be a loopback HTTP origin on port 4192 backed by a disposable database.');
}

class Client {
  cookies = new Map();
  csrfToken = '';

  async request(method, path, body, { csrf = this.csrfToken, headers = {} } = {}) {
    const requestHeaders = { Accept: 'application/json', ...headers };
    if (this.cookies.size) {
      requestHeaders.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (method !== 'GET') {
      requestHeaders['Content-Type'] = 'application/json';
      requestHeaders.Origin = base.origin;
      if (csrf) requestHeaders['X-CSRF-TOKEN'] = csrf;
    }
    const response = await fetch(new URL(path, base), {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const firstPart = cookie.split(';', 1)[0];
      const separator = firstPart.indexOf('=');
      const name = firstPart.slice(0, separator);
      const value = firstPart.slice(separator + 1);
      if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    let data;
    if (text) {
      assert.match(response.headers.get('content-type') || '', /application\/json/i,
        `${method} ${path} must return JSON rather than HTML or a login redirect`);
      try { data = JSON.parse(text); }
      catch { assert.fail(`${method} ${path} returned malformed JSON`); }
    }
    return { status: response.status, data, headers: response.headers, method, path };
  }

  async session() {
    const result = await this.request('GET', '/api/session');
    status(result, 200);
    assert.equal(typeof result.data.csrfToken, 'string');
    assert.ok(result.data.csrfToken.length >= 16, 'Session must supply an opaque CSRF token');
    this.csrfToken = result.data.csrfToken;
    return result.data;
  }
}

function status(result, expected) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  // Never include cookies, authorization material, or the complete session body in failures.
  assert.ok(allowed.includes(result.status),
    `${result.method} ${result.path}: expected ${allowed.join(' or ')}, received ${result.status}`
    + (typeof result.data?.error === 'string' ? ` (${result.data.error.slice(0, 240)})` : ''));
  if (result.status >= 400) {
    assert.equal(typeof result.data?.error, 'string', 'Errors must use the JSON {error} contract');
    assert.ok(result.data.error.length > 0);
  }
  return result.data;
}

function identity(label) {
  return {
    name: `Integration ${label}`,
    email: `test-${label}-${randomUUID()}@handshake.test`,
    password: `Handshake${randomUUID()}!A`,
  };
}

async function register(client, account) {
  await client.session();
  status(await client.request('POST', '/api/auth/register', account), 201);
  const session = await client.session();
  assert.equal(session.user?.email, account.email);
  assert.equal(session.user?.name, account.name);
  assert.ok(session.user?.id);
  return session.user;
}

function assertJob(job) {
  assert.ok(Number.isInteger(job.id) && job.id > 0, 'Job.id must be a positive integer');
  for (const field of ['title', 'company', 'companyInitials', 'location', 'workMode',
    'department', 'employmentType', 'currency', 'description', 'postedAt', 'closesAt']) {
    assert.equal(typeof job[field], 'string', `Job.${field} must be a string`);
    assert.ok(job[field].length > 0, `Job.${field} must not be empty`);
  }
  assert.ok(['Remote', 'Hybrid', 'On-site'].includes(job.workMode));
  assert.ok(['Engineering', 'Data', 'Design', 'Operations'].includes(job.department));
  assert.ok(Number.isFinite(job.salaryMin) && Number.isFinite(job.salaryMax));
  assert.ok(job.salaryMin >= 0 && job.salaryMax >= job.salaryMin);
  assert.equal(job.salaryPeriod, 'hour');
  assert.ok(Array.isArray(job.requirements) && job.requirements.length > 0);
  assert.ok(Array.isArray(job.skills) && job.skills.length > 0);
  assert.ok(job.requirements.every(value => typeof value === 'string'));
  assert.ok(job.skills.every(value => typeof value === 'string'));
  assert.ok(Number.isFinite(Date.parse(job.postedAt)));
  assert.ok(Number.isFinite(Date.parse(job.closesAt)));
  assert.match(job.postedAt, /Z$/, 'Posted date must preserve its explicit UTC timezone');
  assert.match(job.closesAt, /Z$/, 'Closing date must preserve its explicit UTC timezone');
}

function assertApplication(application, jobId) {
  assert.ok(application.id);
  assert.equal(application.job.id, jobId);
  assert.ok(['Submitted', 'Withdrawn'].includes(application.status));
  assert.ok(Number.isFinite(Date.parse(application.submittedAt)));
  assert.ok(Number.isFinite(Date.parse(application.updatedAt)));
  assert.match(application.submittedAt, /Z$/, 'Submission timestamp must preserve its explicit UTC timezone');
  assert.match(application.updatedAt, /Z$/, 'Update timestamp must preserve its explicit UTC timezone');
  assert.ok(Array.isArray(application.events));
  assert.ok(application.events.every(event => ['Submitted', 'Withdrawn'].includes(event.status)
    && Number.isFinite(Date.parse(event.at))));
  assert.ok(application.events.every(event => event.at.endsWith('Z')),
    'Event timestamps must preserve their explicit UTC timezone');
}

test('Handshake API: authenticated opportunity workflow and boundary checks', { timeout: 120_000 }, async t => {
  const visitor = new Client();
  const owner = new Client();
  const outsider = new Client();
  const racer = new Client();
  const ownerAccount = identity('owner');
  const outsiderAccount = identity('outsider');
  const raceAccount = identity('race');
  let jobs;
  let ownerUser;
  let application;
  const motivation = 'I would contribute my backend engineering and collaborative problem-solving experience while learning from this team.';

  await t.test('anonymous session and labeled demo login are available without authentication', async () => {
    const session = await visitor.session();
    assert.equal(session.user, null);
    assert.deepEqual(session.demo, {
      email: 'maya@demo.handshake.test', password: 'HandshakeDemo2026!',
    });
  });

  await t.test('catalog details, explicit filters, and literal search honor the public API contract', async () => {
    const catalog = status(await visitor.request('GET', '/api/jobs'), 200);
    assert.ok(Array.isArray(catalog.items) && catalog.items.length >= 3,
      'Disposable database must contain at least three seeded opportunities');
    assert.equal(catalog.total, catalog.items.length);
    assert.equal(catalog.dataLabel, 'Synthetic demonstration catalog');
    catalog.items.forEach(assertJob);
    jobs = catalog.items;
    const detail = status(await visitor.request('GET', `/api/jobs/${jobs[0].id}`), 200);
    assert.deepEqual(detail, jobs[0]);

    for (const mode of ['Remote', 'Hybrid', 'On-site']) {
      const filtered = status(await visitor.request('GET', `/api/jobs?workMode=${encodeURIComponent(mode)}`), 200);
      assert.equal(filtered.total, filtered.items.length);
      assert.equal(filtered.dataLabel, 'Synthetic demonstration catalog');
      assert.ok(filtered.items.every(job => job.workMode === mode));
    }
    const combined = status(await visitor.request('GET', '/api/jobs?'
      + new URLSearchParams({ workMode: jobs[0].workMode, department: jobs[0].department })), 200);
    assert.equal(combined.dataLabel, 'Synthetic demonstration catalog');
    assert.ok(combined.items.some(job => job.id === jobs[0].id));
    assert.ok(combined.items.every(job => job.workMode === jobs[0].workMode && job.department === jobs[0].department));

    const titleTerm = jobs[0].title.split(/\s+/)[0];
    const searched = status(await visitor.request('GET', '/api/jobs?' + new URLSearchParams({ q: titleTerm })), 200);
    assert.equal(searched.dataLabel, 'Synthetic demonstration catalog');
    assert.ok(searched.items.some(job => job.id === jobs[0].id));
    for (const q of ["' OR 1=1 --", "'; DROP TABLE Jobs; --", `missing-${randomUUID()}`]) {
      const empty = status(await visitor.request('GET', '/api/jobs?' + new URLSearchParams({ q })), 200);
      assert.deepEqual(empty.items, [], 'Search text must remain data and must not relax constraints');
      assert.equal(empty.total, 0);
      assert.equal(empty.dataLabel, 'Synthetic demonstration catalog');
    }
    status(await visitor.request('GET', '/api/jobs?workMode=Anywhere'), 400);
    status(await visitor.request('GET', '/api/jobs?department=Unknown'), 400);
    status(await visitor.request('GET', `/api/jobs/${absentJobId}`), 404);
    const afterInjection = status(await visitor.request('GET', '/api/jobs'), 200);
    assert.equal(afterInjection.total, catalog.total);
  });

  await t.test('anonymous protected reads are rejected and writes require CSRF validation', async () => {
    status(await visitor.request('GET', '/api/saved'), 401);
    status(await visitor.request('GET', '/api/applications'), 401);
    status(await visitor.request('POST', '/api/auth/login', {
      email: 'maya@demo.handshake.test', password: 'HandshakeDemo2026!',
    }, { csrf: '' }), 403);
    status(await visitor.request('POST', '/api/auth/register', ownerAccount, { csrf: 'invalid-token' }), 403);
  });

  await t.test('registration validates input and establishes a new user-bound session', async () => {
    await owner.session();
    const anonymousCsrf = owner.csrfToken;
    for (const invalid of [
      { ...ownerAccount, name: '' },
      { ...ownerAccount, email: 'not-an-email' },
      { ...ownerAccount, password: 'short' },
    ]) status(await owner.request('POST', '/api/auth/register', invalid), 400);
    ownerUser = await register(owner, ownerAccount);
    status(await owner.request('PUT', `/api/saved/${jobs[0].id}`, {}, { csrf: anonymousCsrf }), 403);
    const duplicate = new Client();
    await duplicate.session();
    status(await duplicate.request('POST', '/api/auth/register', ownerAccount), [400, 409]);
    assert.equal((await duplicate.session()).user, null);
    await register(outsider, outsiderAccount);
    await register(racer, raceAccount);
  });

  await t.test('invalid credentials have a generic failure and CSRF tokens are session-bound', async () => {
    const invalidPassword = status(await visitor.request('POST', '/api/auth/login', {
      email: ownerAccount.email, password: 'WrongPassword2026!',
    }), 401);
    const unknownUser = status(await visitor.request('POST', '/api/auth/login', {
      email: `unknown-${randomUUID()}@handshake.test`, password: 'WrongPassword2026!',
    }), 401);
    assert.equal(invalidPassword.error, unknownUser.error, 'Sign-in errors must not enumerate registered email addresses');
    assert.equal((await visitor.session()).user, null);
    status(await outsider.request('PUT', `/api/saved/${jobs[0].id}`, {}, { csrf: owner.csrfToken }), 403);
    assert.deepEqual(status(await outsider.request('GET', '/api/saved'), 200).items, []);
  });

  await t.test('saved opportunities are idempotent, isolated, and removable', async () => {
    const path = `/api/saved/${jobs[0].id}`;
    status(await owner.request('PUT', path, {}), 201);
    status(await owner.request('PUT', path, {}), 200);
    const saved = status(await owner.request('GET', '/api/saved'), 200).items;
    assert.equal(saved.filter(job => job.id === jobs[0].id).length, 1);
    assertJob(saved[0]);
    assert.deepEqual(status(await outsider.request('GET', '/api/saved'), 200).items, []);
    status(await outsider.request('DELETE', path, {}), 204);
    assert.equal(status(await owner.request('GET', '/api/saved'), 200).items.length, 1,
      'Another user deleting the same job must not remove the owner’s saved record');
    status(await owner.request('PUT', `/api/saved/${absentJobId}`, {}), 404);
    status(await owner.request('DELETE', path, {}), 204);
    status(await owner.request('DELETE', path, {}), 204);
    assert.deepEqual(status(await owner.request('GET', '/api/saved'), 200).items, []);
  });

  await t.test('application validation and idempotency preserve one coherent submission', async () => {
    const payload = { jobId: jobs[0].id, motivation };
    status(await owner.request('POST', '/api/applications', payload), 400);
    status(await owner.request('POST', '/api/applications', payload, {
      headers: { 'Idempotency-Key': 'not-a-uuid' },
    }), 400);
    for (const note of ['Too short.', 'x'.repeat(2001)]) {
      status(await owner.request('POST', '/api/applications', { ...payload, motivation: note }, {
        headers: { 'Idempotency-Key': randomUUID() },
      }), 400);
    }
    status(await owner.request('POST', '/api/applications', { ...payload, jobId: absentJobId }, {
      headers: { 'Idempotency-Key': randomUUID() },
    }), 404);
    const key = randomUUID();
    application = status(await owner.request('POST', '/api/applications', payload, {
      headers: { 'Idempotency-Key': key },
    }), 201);
    assertApplication(application, jobs[0].id);
    assert.equal(application.status, 'Submitted');
    assert.equal(application.motivation, motivation);
    assert.equal(application.events.length, 1);
    const replay = status(await owner.request('POST', '/api/applications', payload, {
      headers: { 'Idempotency-Key': key },
    }), 200);
    assert.deepEqual(replay, application);
    status(await owner.request('POST', '/api/applications', { ...payload, motivation: motivation + ' Additional context.' }, {
      headers: { 'Idempotency-Key': key },
    }), 409);
    status(await owner.request('POST', '/api/applications', payload, {
      headers: { 'Idempotency-Key': randomUUID() },
    }), 409);
    const ownerApplications = status(await owner.request('GET', '/api/applications'), 200).items;
    assert.equal(ownerApplications.length, 1);
    assert.deepEqual(ownerApplications[0], application);
    assert.deepEqual(status(await outsider.request('GET', '/api/applications'), 200).items, []);

    // An idempotency key belongs to its user; the same value must work for another user.
    const separate = status(await outsider.request('POST', '/api/applications', payload, {
      headers: { 'Idempotency-Key': key },
    }), 201);
    assert.notEqual(separate.id, application.id);
  });

  await t.test('application ownership and withdrawal transitions are enforced without duplicate events', async () => {
    const path = `/api/applications/${application.id}/withdraw`;
    status(await outsider.request('POST', path, {}), 404);
    status(await owner.request('POST', `/api/applications/${randomUUID()}/withdraw`, {}), 404);
    const stillSubmitted = status(await owner.request('GET', '/api/applications'), 200).items[0];
    assert.equal(stillSubmitted.status, 'Submitted');
    const withdrawn = status(await owner.request('POST', path, {}), 200);
    assertApplication(withdrawn, jobs[0].id);
    assert.equal(withdrawn.status, 'Withdrawn');
    assert.deepEqual(withdrawn.events.map(event => event.status), ['Submitted', 'Withdrawn']);
    const repeated = status(await owner.request('POST', path, {}), 200);
    assert.deepEqual(repeated, withdrawn, 'Retrying withdrawal must not add events or change timestamps');
    assert.equal(status(await outsider.request('GET', '/api/applications'), 200).items[0].status, 'Submitted');
  });

  await t.test('concurrent saved writes and duplicate submissions converge without duplicate rows', async () => {
    const savedPath = `/api/saved/${jobs[1].id}`;
    const savedResponses = await Promise.all([
      racer.request('PUT', savedPath, {}), racer.request('PUT', savedPath, {}),
    ]);
    savedResponses.forEach(result => status(result, [200, 201]));
    assert.deepEqual(savedResponses.map(result => result.status).sort(), [200, 201]);
    assert.equal(status(await racer.request('GET', '/api/saved'), 200).items.length, 1);

    const key = randomUUID();
    const payload = { jobId: jobs[1].id, motivation };
    const identical = await Promise.all(Array.from({ length: 8 }, () =>
      racer.request('POST', '/api/applications', payload, { headers: { 'Idempotency-Key': key } })));
    identical.forEach(result => status(result, [200, 201]));
    assert.equal(identical.filter(result => result.status === 201).length, 1);
    assert.equal(identical.filter(result => result.status === 200).length, 7);
    assert.equal(new Set(identical.map(result => result.data.id)).size, 1);
    identical.forEach(result => assert.deepEqual(result.data, identical[0].data));

    const competing = await Promise.all([
      racer.request('POST', '/api/applications', { jobId: jobs[2].id, motivation }, { headers: { 'Idempotency-Key': randomUUID() } }),
      racer.request('POST', '/api/applications', { jobId: jobs[2].id, motivation }, { headers: { 'Idempotency-Key': randomUUID() } }),
    ]);
    competing.forEach(result => status(result, [201, 409]));
    assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
    const rows = status(await racer.request('GET', '/api/applications'), 200).items;
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(item => item.job.id === jobs[1].id).length, 1);
    assert.equal(rows.filter(item => item.job.id === jobs[2].id).length, 1);
    assert.ok(rows.every(item => item.events.length === 1));

    // Race two first-time withdrawals, then verify a repeated race stays a no-op.
    const withdrawPath = `/api/applications/${identical[0].data.id}/withdraw`;
    const concurrentWithdrawals = await Promise.all([
      racer.request('POST', withdrawPath, {}), racer.request('POST', withdrawPath, {}),
    ]);
    concurrentWithdrawals.forEach(result => status(result, 200));
    assert.deepEqual(concurrentWithdrawals[0].data, concurrentWithdrawals[1].data);
    assert.deepEqual(concurrentWithdrawals[0].data.events.map(event => event.status), ['Submitted', 'Withdrawn']);
    const withdrawalRetries = await Promise.all([
      racer.request('POST', withdrawPath, {}), racer.request('POST', withdrawPath, {}),
    ]);
    withdrawalRetries.forEach(result => {
      status(result, 200);
      assert.deepEqual(result.data, concurrentWithdrawals[0].data,
        'Concurrent retries must not duplicate events or change withdrawal timestamps');
    });
    const persisted = status(await racer.request('GET', '/api/applications'), 200).items
      .find(item => item.id === identical[0].data.id);
    assert.deepEqual(persisted, concurrentWithdrawals[0].data);
  });

  await t.test('logout clears browser authentication and subsequent login preserves owned data', async () => {
    const authenticatedToken = owner.csrfToken;
    status(await owner.request('POST', '/api/auth/logout', {}), 204);
    assert.equal((await owner.session()).user, null);
    status(await owner.request('GET', '/api/applications'), 401);
    status(await owner.request('GET', '/api/saved'), 401);
    status(await owner.request('POST', '/api/auth/login', {
      email: ownerAccount.email, password: ownerAccount.password,
    }, { csrf: authenticatedToken }), 403);
    status(await owner.request('POST', '/api/auth/login', {
      email: ownerAccount.email, password: ownerAccount.password,
    }), 200);
    assert.deepEqual((await owner.session()).user, ownerUser);
    const rows = status(await owner.request('GET', '/api/applications'), 200).items;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, application.id);
    assert.equal(rows[0].status, 'Withdrawn');
    assert.equal((await outsider.session()).user.email, outsiderAccount.email,
      'Logging one client out must not affect another user’s session');
  });
});
