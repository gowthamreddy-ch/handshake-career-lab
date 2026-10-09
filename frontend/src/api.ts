import type { Session } from './types.js';
import type { Job } from './types.js';
import { IS_PAGES_DEMO } from './mode.js';
import { createDemoApi, DemoError, type DemoApi } from './demo.js';
import catalog from './catalog.json' with { type: 'json' };
let csrfToken = '';
let pagesDemo: DemoApi | undefined;
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (IS_PAGES_DEMO) {
    pagesDemo ??= createDemoApi({ catalog: catalog as Job[], storage: () => localStorage });
    try { return await pagesDemo.request<T>(path, options); }
    catch (error) {
      if (error instanceof DemoError) throw new ApiError(error.message, error.status);
      throw error;
    }
  }
  const headers = new Headers(options.headers);
  if (options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    headers.set('X-CSRF-TOKEN', csrfToken);
  }
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  try {
    const response = await fetch(`/api${path}`, { ...options, headers, signal, credentials: 'same-origin' });
    if (response.status === 204) return undefined as T;
    const data = await response.json().catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      return null;
    }) as { error?: string } | null;
    if (!response.ok) throw new ApiError(data?.error || 'Something went wrong. Please try again.', response.status);
    if (data === null) throw new ApiError('The service returned an unreadable response. Please try again.', 502);
    return data as T;
  }
  catch (error) {
    if (timeout.signal.aborted) throw new ApiError('The request timed out. A submitted action may have succeeded; your form has been kept. Retry an unchanged application to safely check its result.', 0);
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('We could not reach Career Lab. Check that the local API is running, then try again. Your form is still here.', 0);
  }
  finally { clearTimeout(timer); }
}
export async function getSession(): Promise<Session> {
  const session = await api<Session>('/session');
  csrfToken = session.csrfToken;
  return session;
}
export const json = (value: unknown) => JSON.stringify(value);
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
