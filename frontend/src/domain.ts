export function jobQuery(q: string, workMode: string, department: string): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (workMode) params.set('workMode', workMode);
  if (department) params.set('department', department);
  return params.size ? `?${params.toString()}` : '';
}

// A retry with the same intent reuses its key even if a response was lost.
export class SubmissionIntent {
  private lastIntent = '';
  private lastKey = '';
  constructor(private createKey: () => string = () => crypto.randomUUID()) {}
  key(jobId: string | number, motivation: string): string {
    const intent = JSON.stringify([String(jobId), motivation]);
    if (intent !== this.lastIntent) { this.lastIntent = intent; this.lastKey = this.createKey(); }
    return this.lastKey;
  }
}

export class ApplicationDrafts {
  private items = new Map<string, { motivation: string; intent: SubmissionIntent }>();
  get(userId: number | string, jobId: number | string) {
    const key = JSON.stringify([String(userId), String(jobId)]);
    if (!this.items.has(key)) this.items.set(key, { motivation: '', intent: new SubmissionIntent() });
    return this.items.get(key)!;
  }
  clear() { this.items.clear(); }
}

export function motivationError(value: string): string | null {
  if (value.trim().length < 50) return 'Write at least 50 characters about your interest in this role.';
  if (value.length > 2000) return 'Keep your introduction to 2,000 characters or fewer.';
  return null;
}
export function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}
export function pay(min: number, max: number, currency = 'USD'): string {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  return `${money.format(min)}–${money.format(max)}`;
}
