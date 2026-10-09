import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dotnet = process.env.HANDSHAKE_DOTNET || 'dotnet';
const origin = 'http://127.0.0.1:4192';
const runtime = join(root, '.runtime', `suite-${randomUUID()}`);
await mkdir(runtime, { recursive: true });
let server;
let log = '';
let stopped = false;

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function stop() {
  if (!server || !server.pid || server.exitCode !== null || stopped) return;
  stopped = true;
  await new Promise(resolveStop => { server.once('exit', resolveStop); server.kill(); });
}

async function start() {
  stopped = false;
  server = spawn(dotnet, [join(root, 'bin/Release/net10.0/Handshake.Api.dll'), '--urls', origin,
    '--Demo:Enabled', 'true', '--Database:Path', join(runtime, 'test.sqlite')], {
    cwd: root, windowsHide: true, env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { log += chunk; });
  server.stderr.on('data', chunk => { log += chunk; });
  let startError;
  server.on('error', error => { startError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startError) throw startError;
    if (server.exitCode !== null) throw new Error('Test API exited before readiness; see .runtime suite server.log.');
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).service === 'Handshake Career Lab') return;
    } catch { }
    await delay(200);
  }
  throw new Error('Test API did not become ready.');
}

const cookies = new Map();
let csrf;
async function request(method, path, body, extraHeaders = {}) {
  const response = await fetch(origin + path, {
    method, signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '),
      ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const index = pair.indexOf('=');
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  assert.ok(response.ok, `${method} ${path} returned ${response.status}`);
  return response.status === 204 ? null : response.json();
}

try {
  // Refuse to use a manually running API, even if it happens to be the same app.
  let occupied = false;
  try { await fetch(origin, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { }
  if (occupied) throw new Error('Port 4192 is occupied. Stop that test server before running the isolated suite.');
  await run(dotnet, ['restore', '--locked-mode']);
  await run(dotnet, ['build', '--configuration', 'Release', '--no-restore', '--nologo']);
  await start();
  await run(process.execPath, ['--test', 'tests/api.test.mjs'], { env: { ...process.env, HANDSHAKE_TEST_URL: origin } });

  csrf = (await request('GET', '/api/session')).csrfToken;
  await request('POST', '/api/auth/login', { email: 'maya@demo.handshake.test', password: 'HandshakeDemo2026!' });
  const signedIn = await request('GET', '/api/session');
  csrf = signedIn.csrfToken;
  await request('PUT', '/api/saved/12', {});
  const application = await request('POST', '/api/applications', { jobId: 12,
    motivation: 'Synthetic restart verification: demonstrate durable application state and session keys across a service restart.' },
    { 'Idempotency-Key': randomUUID() });
  await stop();
  await start();
  assert.equal((await request('GET', '/api/session')).user.id, signedIn.user.id);
  assert.ok((await request('GET', '/api/saved')).items.some(job => job.id === 12));
  assert.deepEqual((await request('GET', '/api/applications')).items.find(item => item.id === application.id), application);
  console.log('PASS: saved job, application, UTC timestamps, and authenticated session survive API restart.');
} finally {
  await stop();
  await writeFile(join(runtime, 'server.log'), log);
}
