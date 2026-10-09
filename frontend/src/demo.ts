import type { Application, Job, Session, User } from './types.js';

/** Browser-only scenario simulator. It is not authentication or a security boundary. */
export const DEMO_STORAGE_KEY = 'handshake-career-lab:v1';
const PERSONA: User = { id: 'pages-demo-maya', name: 'Maya Chen', email: 'maya@example.test' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ['Remote', 'Hybrid', 'On-site'];
const DEPARTMENTS = ['Engineering', 'Data', 'Design', 'Operations'];
const corruptMessage = 'Saved demo data is unreadable or from an unsupported version. Use Reset demo to clear only this app’s demo data; other browser data will be kept.';

export class DemoError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'DemoError'; }
}
export interface DemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface StoredApplication {
  id: string; jobId: number; status: 'Submitted' | 'Withdrawn'; motivation: string;
  submittedAt: string; updatedAt: string; events: { status: 'Submitted' | 'Withdrawn'; at: string }[];
}
interface Replay { key: string; fingerprint: string; applicationId: string }
interface State {
  version: 1; active: boolean; savedIds: number[]; applications: StoredApplication[]; replays: Replay[];
}
export interface DemoOptions {
  catalog: readonly Job[];
  storage: DemoStorage | (() => DemoStorage);
  createId?: () => string;
  now?: () => Date;
}
export interface DemoApi { request<T>(path: string, options?: RequestInit): Promise<T> }

const empty = (): State => ({ version: 1, active: false, savedIds: [], applications: [], replays: [] });
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const timestamp = (value: unknown): value is string => typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value));
const noteIsValid = (value: unknown): value is string => typeof value === 'string' && value.trim().length >= 50 && value.length <= 2000;
const fingerprint = (jobId: number, motivation: string) => JSON.stringify([jobId, motivation]);

export function createDemoApi(options: DemoOptions): DemoApi {
  // Own our copy; neither callers nor returned objects can mutate catalog state.
  const catalog = structuredClone(options.catalog) as Job[];
  const catalogById = new Map(catalog.map(job => [Number(job.id), job]));
  if (!catalog.length || catalogById.size !== catalog.length || catalog.some(job => !Number.isInteger(job.id) || Number(job.id) <= 0)) {
    throw new Error('The demo requires a nonempty synthetic catalog with unique positive integer IDs.');
  }
  const createId = options.createId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());

  function storage(): DemoStorage {
    try { return typeof options.storage === 'function' ? options.storage() : options.storage; }
    catch { throw new DemoError('Browser storage is unavailable. Allow site storage, then retry. No demo changes were saved.', 503); }
  }
  function validState(value: unknown): value is State {
    if (!record(value) || !hasKeys(value, ['version', 'active', 'savedIds', 'applications', 'replays'])
      || value.version !== 1 || typeof value.active !== 'boolean'
      || !Array.isArray(value.savedIds) || !Array.isArray(value.applications) || !Array.isArray(value.replays)
      || value.savedIds.length > catalog.length || value.applications.length > catalog.length || value.replays.length > catalog.length) return false;
    if (value.savedIds.some(id => !Number.isInteger(id) || !catalogById.has(id)) || new Set(value.savedIds).size !== value.savedIds.length) return false;
    const appIds = new Set<string>(); const appJobs = new Set<number>();
    for (const app of value.applications) {
      if (!record(app) || !hasKeys(app, ['id', 'jobId', 'status', 'motivation', 'submittedAt', 'updatedAt', 'events'])
        || typeof app.id !== 'string' || !UUID.test(app.id) || appIds.has(app.id)
        || typeof app.jobId !== 'number' || !catalogById.has(app.jobId) || appJobs.has(app.jobId)
        || !['Submitted', 'Withdrawn'].includes(String(app.status)) || !noteIsValid(app.motivation)
        || !timestamp(app.submittedAt) || !timestamp(app.updatedAt) || Date.parse(app.updatedAt) < Date.parse(app.submittedAt)
        || !Array.isArray(app.events) || app.events.length !== (app.status === 'Submitted' ? 1 : 2)) return false;
      for (let index = 0; index < app.events.length; index++) {
        const event = app.events[index];
        if (!record(event) || !hasKeys(event, ['status', 'at']) || !timestamp(event.at)
          || event.status !== (index === 0 ? 'Submitted' : 'Withdrawn')
          || event.at !== (index === 0 ? app.submittedAt : app.updatedAt)) return false;
      }
      if (app.status === 'Submitted' && app.submittedAt !== app.updatedAt) return false;
      appIds.add(app.id); appJobs.add(app.jobId);
    }
    const keys = new Set<string>(); const replayApps = new Set<string>();
    for (const replay of value.replays) {
      if (!record(replay) || !hasKeys(replay, ['key', 'fingerprint', 'applicationId'])
        || typeof replay.key !== 'string' || !UUID.test(replay.key) || replay.key !== replay.key.toLowerCase() || keys.has(replay.key)
        || typeof replay.applicationId !== 'string' || !appIds.has(replay.applicationId) || replayApps.has(replay.applicationId)) return false;
      const app = value.applications.find(item => item.id === replay.applicationId);
      if (replay.fingerprint !== fingerprint(app.jobId, app.motivation)) return false;
      keys.add(replay.key); replayApps.add(replay.applicationId);
    }
    return value.replays.length === value.applications.length;
  }
  function read(): State {
    let raw: string | null;
    try { raw = storage().getItem(DEMO_STORAGE_KEY); }
    catch { throw new DemoError('Browser storage is unavailable. Allow site storage, then retry. No demo changes were saved.', 503); }
    if (raw === null) return empty();
    let value: unknown;
    try { if (raw.length > 256_000) throw new Error(); value = JSON.parse(raw); }
    catch { throw new DemoError(corruptMessage, 503); }
    if (!validState(value)) throw new DemoError(corruptMessage, 503);
    return value;
  }
  function write(state: State): void {
    if (!validState(state)) throw new DemoError('The demo could not safely save this change. Reset demo or reload, then try again.', 503);
    try { storage().setItem(DEMO_STORAGE_KEY, JSON.stringify(state)); }
    catch { throw new DemoError('The browser could not save this demo change. Allow site storage or free space, then retry. Your previous saved state has been kept. Reset demo clears only this app’s data.', 503); }
  }
  function session(state: State): Session {
    return { user: state.active ? structuredClone(PERSONA) : null, csrfToken: 'pages-demo-no-security-boundary', demo: null };
  }
  function requirePersona(state: State) { if (!state.active) throw new DemoError('Start the fictional Maya demo to save roles or track applications.', 401); }
  function job(id: number): Job { const found = catalogById.get(id); if (!found) throw new DemoError('This synthetic opportunity was not found.', 404); return found; }
  function application(stored: StoredApplication): Application {
    const { jobId, ...rest } = stored;
    return { ...rest, job: job(jobId) };
  }
  function body(options: RequestInit): Record<string, unknown> {
    if (options.body === undefined || options.body === null || options.body === '') return {};
    let value: unknown;
    try { if (typeof options.body !== 'string' || options.body.length > 12_000) throw new Error(); value = JSON.parse(options.body); }
    catch { throw new DemoError('Use a valid JSON object for this demo action.', 400); }
    if (!record(value)) throw new DemoError('Use a valid JSON object for this demo action.', 400);
    return value;
  }
  function requireEmptyBody(request: RequestInit) {
    if (Object.keys(body(request)).length) throw new DemoError('This demo action does not accept extra fields.', 400);
  }
  function currentTime(atLeast?: string): string {
    const time = now();
    if (!(time instanceof Date) || !Number.isFinite(time.getTime())) throw new DemoError('The demo clock is unavailable. Reload and try again.', 503);
    return new Date(Math.max(time.getTime(), atLeast ? Date.parse(atLeast) : time.getTime())).toISOString();
  }

  function dispatch(path: string, request: RequestInit): unknown {
    if (request.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new DemoError('Unknown demo route.', 404);
    const url = new URL(path, 'https://pages-demo.invalid');
    const route = url.pathname; const method = (request.method ?? 'GET').toUpperCase();
    if (url.hash) throw new DemoError('Unknown demo route.', 404);
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new DemoError('This method is not supported in the browser demo.', 405);
    if (route !== '/jobs' && url.search) throw new DemoError('This demo route does not accept query parameters.', 400);
    if (method === 'GET' && route === '/jobs') {
      for (const key of url.searchParams.keys()) if (!['q', 'workMode', 'department'].includes(key) || url.searchParams.getAll(key).length !== 1) {
        throw new DemoError('Use a single search value and supported filters.', 400);
      }
      const q = (url.searchParams.get('q') ?? '').trim();
      const workMode = url.searchParams.get('workMode') ?? ''; const department = url.searchParams.get('department') ?? '';
      if (q.length > 120 || (workMode && !MODES.includes(workMode)) || (department && !DEPARTMENTS.includes(department))) {
        throw new DemoError('Choose a listed work mode or field and keep search text within 120 characters.', 400);
      }
      const terms = q.toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
      const items = catalog.filter(item => (!workMode || item.workMode === workMode) && (!department || item.department === department)
        && terms.every(term => [item.title, item.company, item.location, ...item.skills].join(' ').toLocaleLowerCase('en-US').includes(term)));
      return { items, total: items.length, dataLabel: 'Synthetic demonstration catalog' };
    }
    const detail = /^\/jobs\/([1-9]\d*)$/.exec(route);
    if (method === 'GET' && detail) return job(Number(detail[1]));
    if (route === '/auth/login' || route === '/auth/register') throw new DemoError('The public browser demo does not accept accounts or passwords. Start the fictional Maya demo instead.', 405);
    if (method === 'POST' && route === '/demo/reset') {
      requireEmptyBody(request);
      try { storage().removeItem(DEMO_STORAGE_KEY); }
      catch { throw new DemoError('The browser prevented Reset demo. Allow site storage, then retry. No other browser data has been changed.', 503); }
      return session(empty());
    }
    // Validate routes before accessing storage, so unknown paths cannot masquerade as persistence errors.
    const saved = /^\/saved\/([1-9]\d*)$/.exec(route);
    const withdrawal = /^\/applications\/([0-9a-f-]+)\/withdraw$/i.exec(route);
    const supported = (method === 'GET' && ['/session', '/saved', '/applications'].includes(route))
      || (method === 'POST' && ['/demo/start', '/auth/logout', '/applications'].includes(route))
      || (saved && ['PUT', 'DELETE'].includes(method)) || (withdrawal && method === 'POST');
    if (!supported) throw new DemoError('Unknown demo route.', 404);
    const state = read();
    if (method === 'GET' && route === '/session') return session(state);
    if (method === 'POST' && route === '/demo/start') { requireEmptyBody(request); state.active = true; write(state); return session(state); }
    if (method === 'POST' && route === '/auth/logout') { requireEmptyBody(request); state.active = false; write(state); return undefined; }
    requirePersona(state);
    if (method === 'GET' && route === '/saved') return { items: state.savedIds.map(id => job(id)) };
    if (saved && ['PUT', 'DELETE'].includes(method)) {
      requireEmptyBody(request); const id = Number(saved[1]); job(id);
      if (method === 'PUT' && !state.savedIds.includes(id)) { state.savedIds.unshift(id); write(state); }
      if (method === 'DELETE' && state.savedIds.includes(id)) { state.savedIds = state.savedIds.filter(value => value !== id); write(state); }
      return method === 'DELETE' ? undefined : job(id);
    }
    if (method === 'GET' && route === '/applications') return { items: state.applications.map(application) };
    if (method === 'POST' && route === '/applications') {
      const payload = body(request);
      if (!hasKeys(payload, ['jobId', 'motivation']) || typeof payload.jobId !== 'number' || !Number.isSafeInteger(payload.jobId) || payload.jobId <= 0 || !noteIsValid(payload.motivation)) {
        throw new DemoError('Choose a synthetic role and write a 50–2,000 character introduction.', 400);
      }
      job(payload.jobId);
      const key = new Headers(request.headers).get('Idempotency-Key')?.toLowerCase();
      if (!key || !UUID.test(key)) throw new DemoError('This application needs a valid request key. Reload the page and try again.', 400);
      const hash = fingerprint(payload.jobId, payload.motivation); const prior = state.replays.find(item => item.key === key);
      if (prior) {
        if (prior.fingerprint !== hash) throw new DemoError('That request key belongs to a different introduction. Review the form and submit again.', 409);
        return application(state.applications.find(item => item.id === prior.applicationId)!);
      }
      if (state.applications.some(item => item.jobId === payload.jobId)) throw new DemoError('Maya already has a demo application for this role. View it in Applications.', 409);
      const id = createId();
      if (!UUID.test(id) || state.applications.some(item => item.id === id)) throw new DemoError('The demo could not create a unique application ID. Reload and try again.', 503);
      const at = currentTime();
      const created: StoredApplication = { id, jobId: payload.jobId, motivation: payload.motivation, status: 'Submitted', submittedAt: at, updatedAt: at, events: [{ status: 'Submitted', at }] };
      state.applications.unshift(created); state.replays.push({ key, fingerprint: hash, applicationId: id }); write(state);
      return application(created);
    }
    if (method === 'POST' && withdrawal) {
      requireEmptyBody(request);
      if (!UUID.test(withdrawal[1])) throw new DemoError('This demo application was not found.', 404);
      const found = state.applications.find(item => item.id.toLowerCase() === withdrawal[1].toLowerCase());
      if (!found) throw new DemoError('This demo application was not found.', 404);
      if (found.status === 'Submitted') {
        const at = currentTime(found.updatedAt); found.status = 'Withdrawn'; found.updatedAt = at; found.events.push({ status: 'Withdrawn', at }); write(state);
      }
      return application(found);
    }
    throw new DemoError('Unknown demo route.', 404);
  }

  return {
    async request<T>(path: string, request: RequestInit = {}): Promise<T> {
      // No networking or submitted-code execution. Each synchronous transaction reads
      // the latest browser value and writes once; cross-tab locks are not simulated.
      return structuredClone(dispatch(path, request)) as T;
    },
  };
}
