import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, errorText, getSession, json } from './api';
import { ApplicationDrafts, displayDate, jobQuery, motivationError, pay, type SubmissionIntent } from './domain';
import type { Application, Job, Session, User, View } from './types';
import { IS_PAGES_DEMO } from './mode';

type IconName = 'arrow' | 'search' | 'bookmark' | 'location' | 'close' | 'check' | 'briefcase' | 'logout' | 'grid' | 'spark' | 'chevron';
function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    bookmark: <path d="M6 4h12v17l-6-4-6 4z"/>, location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>, check: <path d="m5 12 4 4L19 6"/>, briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12c5 3 13 3 18 0M12 12v4"/></>,
    logout: <><path d="M9 4H4v16h5M10 12h11m-5-5 5 5-5 5"/></>, grid: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
    spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>, chevron: <path d="m9 5 7 7-7 7"/>,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Modal({ title, children, close, wide = false, busy = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog className={`modal ${wide ? 'wide' : ''}`} ref={ref} aria-label={title} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) close(); }} onClick={event => { if (!busy && event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); } }}>
    <button className="icon-button modal-close" disabled={busy} onClick={close} aria-label={`Close ${title}`}><Icon name="close"/></button>{children}
  </dialog>;
}

function DemoStart({ authenticated, busyChanged }: { authenticated: () => Promise<void>; busyChanged: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => () => busyChanged(false), [busyChanged]);
  async function start() {
    if (busy) return; setBusy(true); busyChanged(true); setError('');
    try { await api('/demo/start', { method: 'POST', body: json({}) }); await authenticated(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); busyChanged(false); }
  }
  return <div className="auth-content demo-start-content"><span className="eyebrow">INTERACTIVE BROWSER DEMO</span><h2>Take a look through<br/>Maya’s eyes.</h2><p className="muted">Explore a fictional candidate’s demo workspace. Save internships, try an application, and follow its status.</p><div className="demo-persona"><span className="avatar">M</span><div><strong>Maya</strong><span>Fictional student · Demo persona</span></div></div><ul className="demo-facts"><li><Icon name="check"/>No password or server account</li><li><Icon name="check"/>Saved roles and applications stay in this browser</li><li><Icon name="check"/>No employer is contacted</li></ul>{error && <p className="inline-error" role="alert">{error}</p>}<button className="button primary full" type="button" disabled={busy} onClick={start}>{busy ? 'Opening demo…' : 'Start demo'}<Icon name="arrow"/></button><p className="fine-print">Use fictional information only. Reset demo clears this project’s saved browser data whenever you’re done.</p></div>;
}

function AuthForm({ session, authenticated, busyChanged }: { session: Session | null; authenticated: () => Promise<void>; busyChanged: (busy: boolean) => void }) {
  const demoAccount = session?.demo;
  const [register, setRegister] = useState(false);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [reconcile, setReconcile] = useState(false);
  useEffect(() => () => busyChanged(false), [busyChanged]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); busyChanged(true); setError('');
    let authAccepted = false;
    try {
      if (!reconcile) { await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: json(register ? { name: name.trim(), email: email.trim(), password } : { email: email.trim(), password }) }); authAccepted = true; }
      await authenticated();
    } catch (failure) {
      if (reconcile && failure instanceof ApiError && failure.status === 401) { setReconcile(false); setError('Connection restored. Please sign in again; your form has been kept.'); }
      else if (authAccepted || (failure instanceof ApiError && (failure.status === 0 || failure.status === 403 || failure.status >= 500))) { setReconcile(true); setError('We need to check your session before sending another request. Your previous sign-in or registration may have succeeded. Use Check session below.'); }
      else setError(errorText(failure));
    } finally { setBusy(false); busyChanged(false); }
  }
  return <div className="auth-content">
    <span className="eyebrow">YOUR NEXT CHAPTER</span><h2>{register ? 'Make room for possibility.' : 'Good to see you.'}</h2>
    <p className="muted">{register ? 'Create a local demo account to save roles and track your applications.' : 'Sign in to keep your shortlist and applications together.'}</p>
    <div className="segmented" aria-label="Account action"><button type="button" aria-pressed={!register} disabled={busy} onClick={() => { setRegister(false); setError(''); }}>Sign in</button><button type="button" aria-pressed={register} disabled={busy} onClick={() => { setRegister(true); setError(''); }}>Create account</button></div>
    {demoAccount && !register && <div className="demo-account"><div><strong>Just exploring?</strong><span>Use the seeded demo candidate.</span></div><button className="text-button" type="button" disabled={busy} onClick={() => { setEmail(demoAccount.email); setPassword(demoAccount.password); setError(''); }}>Fill demo account <Icon name="arrow"/></button></div>}
    <form onSubmit={submit} className="form-stack">
      {register && <label>Full name<input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} disabled={busy}/></label>}
      <label>Email address<input type="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={busy}/></label>
      <label>Password<div className="password-input"><input type={showPassword ? 'text' : 'password'} required minLength={register ? 12 : 1} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div>{register && <span className="field-note">Use 12–128 characters, including uppercase, lowercase, a number, and a symbol. Use a password only for this demo.</span>}</label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="button primary full" disabled={busy || (!session && !reconcile)} formNoValidate={reconcile}>{busy ? 'Please wait…' : reconcile ? 'Check session' : register ? 'Create account' : 'Sign in'}<Icon name="arrow"/></button>
    </form><p className="fine-print">Local demonstration only. No real employers, recruitment service, or university affiliation.</p>
  </div>;
}

function ApplyForm({ job, user, draft, applied, recoverSession, busyChanged }: { job: Job; user: User; draft: { motivation: string; intent: SubmissionIntent }; applied: (application: Application) => Promise<void>; recoverSession: () => Promise<boolean>; busyChanged: (busy: boolean) => void }) {
  const [motivation, setMotivation] = useState(draft.motivation); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [needsSession, setNeedsSession] = useState(false);
  useEffect(() => () => busyChanged(false), [busyChanged]);
  async function reconnect() {
    setBusy(true); busyChanged(true);
    try { if (await recoverSession()) { setNeedsSession(false); setError(IS_PAGES_DEMO ? 'Your demo workspace is ready. Review your fictional note, then submit again.' : 'Your session is ready. Review your introduction, then submit again. The same request key will be used.'); } }
    catch (failure) { setNeedsSession(true); setError(errorText(failure)); }
    finally { setBusy(false); busyChanged(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const invalid = motivationError(motivation); if (invalid) { setError(invalid); return; }
    setError(''); setBusy(true); busyChanged(true);
    try {
      const result = await api<Application>('/applications', { method: 'POST', headers: { 'Idempotency-Key': draft.intent.key(job.id, motivation) }, body: json({ jobId: job.id, motivation }) });
      await applied(result);
    } catch (failure) {
      setError(errorText(failure));
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { setNeedsSession(true); await reconnect(); }
    } finally { setBusy(false); busyChanged(false); }
  }
  return <div className="auth-content"><span className="eyebrow">TAKE THE NEXT STEP</span><h2>A short introduction.<br/>A new possibility.</h2><p className="muted">{job.title} · {job.company}</p>
    <div className="applicant"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><span>{IS_PAGES_DEMO ? 'Fictional demo persona' : user.email}</span></div><span className="pill">{IS_PAGES_DEMO ? 'Demo' : 'Candidate'}</span></div>
    <form className="form-stack" onSubmit={submit}><label htmlFor="motivation">{IS_PAGES_DEMO ? 'Write a fictional introduction for Maya' : 'What interests you about this opportunity?'}</label><textarea id="motivation" rows={7} required minLength={50} maxLength={2000} value={motivation} onChange={e => { draft.motivation = e.target.value; setMotivation(e.target.value); }} disabled={busy} placeholder={IS_PAGES_DEMO ? 'Use fictional information only. Do not enter your name, contact details, or any other personal information.' : 'Share what you would like to learn and the skills or experience you would bring.'} aria-describedby="motivation-note"/>
      <div className="field-meta" id="motivation-note"><span>{IS_PAGES_DEMO ? '50–2,000 characters. Fictional information only; no personal information.' : '50–2,000 characters. No sensitive personal details.'}</span><span>{motivation.length}/2,000</span></div>
      {IS_PAGES_DEMO && <button className="text-button" type="button" disabled={busy} onClick={() => { const example = 'I enjoy learning through hands-on projects and would like to explore this fictional internship. As Maya, I would bring curiosity, thoughtful questions, and a willingness to practice new skills with the team.'; draft.motivation = example; setMotivation(example); }}>Use a fictional example <Icon name="spark"/></button>}
      <div className="quiet-note"><Icon name="briefcase"/><p>{IS_PAGES_DEMO ? 'This practice application is saved only in this browser. No employer is contacted, and no server account is created.' : 'This submits to your local demo account. No application is sent to an employer.'}</p></div>
      {error && <p className="inline-error" role="alert">{error}</p>}{needsSession && <button className="button secondary full" type="button" disabled={busy} onClick={reconnect}>{IS_PAGES_DEMO ? 'Reopen demo workspace' : 'Reconnect session'} <Icon name="arrow"/></button>}<button className="button primary full" disabled={busy || needsSession}>{busy ? 'Please wait…' : 'Submit demo application'}<Icon name="arrow"/></button>
    </form></div>;
}

function JobCard({ job, saved, busy, select, save }: { job: Job; saved: boolean; busy: boolean; select: () => void; save: () => void }) {
  return <article className="job-card">
    <div className="card-top"><span className={`company-mark tone-${job.department.toLowerCase()}`}>{job.companyInitials}</span><div><span className="company-name">{job.company}</span><span className="small-meta">{job.department}</span></div><button className={`icon-button save-button ${saved ? 'is-saved' : ''}`} onClick={save} disabled={busy} aria-label={`${saved ? 'Unsave' : 'Save'} ${job.title} at ${job.company}`} aria-pressed={saved}><Icon name="bookmark"/></button></div>
    <h3><button onClick={select}>{job.title}</button></h3><div className="job-location"><Icon name="location"/>{job.location}</div>
    <div className="tags"><span>{job.workMode}</span><span>{job.employmentType}</span></div><p className="card-description">{job.description}</p>
    <div className="card-footer"><div><strong>{pay(job.salaryMin, job.salaryMax, job.currency)}<small> / hour</small></strong><span>USD · Hourly compensation</span></div><button className="round-arrow" onClick={select} aria-label={`View ${job.title} at ${job.company}`}><Icon name="arrow"/></button></div>
  </article>;
}

type ModalState = { kind: 'auth' } | { kind: 'detail'; job: Job } | { kind: 'apply'; job: Job } | null;
export default function App() {
  const [session, setSession] = useState<Session | null>(null); const sessionRef = useRef<Session | null>(null);
  const [sessionError, setSessionError] = useState(''); const [view, setView] = useState<View>('discover');
  const [query, setQuery] = useState(''); const [search, setSearch] = useState(''); const [workMode, setWorkMode] = useState(''); const [department, setDepartment] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]); const [total, setTotal] = useState(0); const [loading, setLoading] = useState(true); const [jobsError, setJobsError] = useState(''); const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState<Job[]>([]); const [applications, setApplications] = useState<Application[]>([]); const [privateBusy, setPrivateBusy] = useState(false); const [privateError, setPrivateError] = useState(''); const [privateReload, setPrivateReload] = useState(0);
  const [saving, setSaving] = useState<Set<string>>(new Set()); const [withdrawing, setWithdrawing] = useState(''); const [confirmWithdraw, setConfirmWithdraw] = useState('');
  const [modal, setModal] = useState<ModalState>(null); const [modalBusy, setModalBusy] = useState(false); const pendingAction = useRef<{ kind: 'apply' | 'save'; job: Job } | null>(null); const applicationDrafts = useRef(new ApplicationDrafts());
  const [notice, setNotice] = useState(''); const [actionError, setActionError] = useState(''); const [signingOut, setSigningOut] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false); const [resetting, setResetting] = useState(false);
  const user = session?.user;
  async function refreshSession() {
    let current: Session;
    try { current = await getSession(); } catch (failure) { setSessionError(errorText(failure)); throw failure; }
    if (sessionRef.current?.user?.id !== current.user?.id) {
      setSaved([]); setApplications([]); setPrivateError(''); setPrivateBusy(Boolean(current.user));
    }
    sessionRef.current = current; setSession(current); setSessionError(''); return current;
  }
  useEffect(() => { refreshSession().catch(error => setSessionError(errorText(error))); }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setJobsError('');
    api<{ items: Job[]; total: number }>('/jobs' + jobQuery(search, workMode, department), { signal: controller.signal }).then(data => { if (controller.signal.aborted) return; setJobs(data.items); setTotal(data.total); }).catch(error => { if (!controller.signal.aborted) setJobsError(errorText(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, workMode, department, reload]);
  useEffect(() => {
    if (!user) { setSaved([]); setApplications([]); setPrivateError(''); setPrivateBusy(false); return; }
    const controller = new AbortController(); const ownerId = user.id; setPrivateBusy(true); setPrivateError('');
    Promise.all([api<{ items: Job[] }>('/saved', { signal: controller.signal }), api<{ items: Application[] }>('/applications', { signal: controller.signal })]).then(([bookmarks, history]) => { if (controller.signal.aborted || sessionRef.current?.user?.id !== ownerId) return; setSaved(bookmarks.items); setApplications(history.items); }).catch(error => { if (!controller.signal.aborted) { setPrivateError(errorText(error)); if (error instanceof ApiError && (error.status === 401 || error.status === 403)) refreshSession().catch(() => {}); } }).finally(() => { if (!controller.signal.aborted) setPrivateBusy(false); });
    return () => controller.abort();
  }, [user?.id, privateReload]);
  function navigate(next: View) { setView(next); setActionError(''); setNotice(''); }
  function isSaved(job: Job) { return saved.some(item => String(item.id) === String(job.id)); }
  function hasApplication(job: Job) { return applications.find(item => String(item.job.id) === String(job.id)); }
  function authenticate(action?: { kind: 'apply' | 'save'; job: Job }) { pendingAction.current = action || null; setModal({ kind: 'auth' }); }
  async function mutateSaved(job: Job) {
    const id = String(job.id); if (saving.has(id)) return;
    const ownerId = sessionRef.current?.user?.id; const removing = isSaved(job);
    setSaving(previous => new Set(previous).add(id)); setActionError('');
    try {
      await api(`/saved/${encodeURIComponent(id)}`, { method: removing ? 'DELETE' : 'PUT', body: json({}) });
      if (sessionRef.current?.user?.id !== ownerId) return;
      setSaved(previous => removing ? previous.filter(item => String(item.id) !== id) : previous.some(item => String(item.id) === id) ? previous : [job, ...previous]);
      setPrivateReload(value => value + 1);
      setNotice(removing ? 'Opportunity removed from your shortlist.' : 'Opportunity saved to your shortlist.');
    } catch (error) { setActionError(errorText(error)); if (error instanceof ApiError && (error.status === 401 || error.status === 403)) refreshSession().catch(() => {}); }
    finally { setSaving(previous => { const next = new Set(previous); next.delete(id); return next; }); }
  }
  function toggleSave(job: Job) { if (!user) authenticate({ kind: 'save', job }); else void mutateSaved(job); }
  function apply(job: Job) { if (!user) authenticate({ kind: 'apply', job }); else setModal({ kind: 'apply', job }); }
  async function authenticated() {
    const current = await refreshSession();
    if (!current.user) throw new ApiError(IS_PAGES_DEMO ? 'The demo workspace is not open. Please start the demo again.' : 'No signed-in session was found. Please sign in again.', 401);
    const action = pendingAction.current; pendingAction.current = null;
    setNotice(IS_PAGES_DEMO ? 'Maya’s demo workspace is open. Your changes stay in this browser.' : 'You’re signed in. Your next chapter starts here.');
    if (action?.kind === 'apply') setModal({ kind: 'apply', job: action.job });
    else { setModal(null); if (action?.kind === 'save') { await mutateSaved(action.job); setPrivateReload(value => value + 1); } }
  }
  async function recoverApplication(job: Job, ownerId: string | number) {
    const current = await refreshSession();
    if (current.user?.id === ownerId) return true;
    authenticate({ kind: 'apply', job }); setNotice(IS_PAGES_DEMO ? 'Start the demo again to resume Maya’s fictional introduction.' : 'Please sign in again to resume. Your introduction has been kept for its original account.');
    return false;
  }
  async function logout() {
    if (signingOut) return; setSigningOut(true); setActionError('');
    let accepted = false;
    try { await api('/auth/logout', { method: 'POST', body: json({}) }); accepted = true; sessionRef.current = null; applicationDrafts.current.clear(); setSession(null); setSaved([]); setApplications([]); setModal(null); setView('discover'); await refreshSession(); setNotice(IS_PAGES_DEMO ? 'Demo workspace closed. Your saved roles and practice applications remain in this browser until you reset the demo.' : 'Signed out. Your saved roles and applications are stored with your account.'); }
    catch (error) {
      setActionError(errorText(error));
      if (!accepted) {
        try { const current = await refreshSession(); if (!current.user) { applicationDrafts.current.clear(); setModal(null); setView('discover'); setNotice(IS_PAGES_DEMO ? 'The demo workspace is closed. Saved demo data remains in this browser.' : 'Your session is signed out. Your saved roles and applications remain with your account.'); } }
        catch { /* The connection retry is exposed by refreshSession. Do not repeat the write. */ }
      }
    }
    finally { setSigningOut(false); }
  }
  async function withdraw(application: Application) {
    if (withdrawing) return; setWithdrawing(String(application.id)); setActionError(''); const ownerId = user?.id;
    try { const updated = await api<Application>(`/applications/${encodeURIComponent(application.id)}/withdraw`, { method: 'POST', body: json({}) }); if (sessionRef.current?.user?.id !== ownerId) return; setApplications(previous => previous.map(item => String(item.id) === String(updated.id) ? updated : item)); setPrivateReload(value => value + 1); setConfirmWithdraw(''); setNotice(IS_PAGES_DEMO ? 'Practice application withdrawn. Its history remains in this browser.' : 'Application withdrawn. Its history remains in your account.'); }
    catch (error) { setActionError(errorText(error)); if (error instanceof ApiError && (error.status === 401 || error.status === 403)) refreshSession().catch(() => {}); }
    finally { setWithdrawing(''); }
  }
  async function resetDemo() {
    if (!IS_PAGES_DEMO || resetting || modalBusy || saving.size || withdrawing || signingOut) return;
    setResetting(true); setActionError('');
    try {
      await api('/demo/reset', { method: 'POST', body: json({}) });
      sessionRef.current = null; applicationDrafts.current.clear(); pendingAction.current = null;
      setSession(null); setSaved([]); setApplications([]); setSaving(new Set()); setPrivateBusy(false); setPrivateError('');
      setModal(null); setModalBusy(false); setConfirmWithdraw(''); setView('discover'); setQuery(''); setSearch(''); setWorkMode(''); setDepartment('');
      await refreshSession(); setPrivateReload(value => value + 1); setReload(value => value + 1); setConfirmReset(false);
      setNotice('Demo reset. This project’s saved roles, applications, and drafts have been cleared from this browser.');
    } catch (failure) { setActionError(errorText(failure)); }
    finally { setResetting(false); }
  }
  const filtered = Boolean(search || workMode || department);
  const nav = <>{(['discover', 'saved', 'applications'] as const).map(item => <button key={item} className={view === item ? 'active' : ''} onClick={() => navigate(item)} aria-current={view === item ? 'page' : undefined}><Icon name={item === 'discover' ? 'grid' : item === 'saved' ? 'bookmark' : 'briefcase'}/>{item === 'discover' ? 'Discover' : item === 'saved' ? 'Saved roles' : 'Applications'}{user && item !== 'discover' && <span className="nav-count">{item === 'saved' ? saved.length : applications.length}</span>}</button>)}</>;
  return <><a className="skip-link" href="#main">Skip to opportunities</a>
    {IS_PAGES_DEMO ? <div className="pages-demo-banner"><div className="pages-demo-summary"><div><strong><span className="demo-dot"/>Interactive browser demo</strong><p>No server account · No employer contacted · Data stays only in this browser</p></div><button className="demo-reset-button" onClick={() => setConfirmReset(!confirmReset)} disabled={resetting || modalBusy || Boolean(saving.size) || Boolean(withdrawing) || signingOut} aria-expanded={confirmReset} aria-controls="demo-reset-confirm">Reset demo</button></div>{confirmReset && <div className="demo-reset-confirm" id="demo-reset-confirm"><p>Clear this project’s saved roles, applications, and drafts from this browser?</p><div><button className="button reset-confirm-button" disabled={resetting || modalBusy || Boolean(saving.size) || Boolean(withdrawing) || signingOut} onClick={resetDemo}>{resetting ? 'Resetting…' : 'Clear demo data'}</button><button className="demo-reset-button" disabled={resetting} onClick={() => setConfirmReset(false)}>Keep my demo</button></div></div>}</div> : <div className="demo-strip"><span className="demo-dot"/>SYNTHETIC LOCAL DEMO <span className="strip-divider">/</span><span>Explore the experience. These aren’t real vacancies.</span></div>}
    <header className={IS_PAGES_DEMO ? 'site-header pages-header' : 'site-header'}><button className="brand" aria-label="Handshake Career Lab home" onClick={() => navigate('discover')}><span className="brand-mark">h<span>↗</span></span><span>handshake<span className="brand-subtitle">CAREER LAB</span></span></button><nav className="desktop-nav" aria-label="Main navigation">{nav}</nav><div className="account-control">{user ? <><span className="avatar small">{user.name.slice(0, 1).toUpperCase()}</span><span className="account-name">{IS_PAGES_DEMO ? 'Maya’s demo' : user.name.split(' ')[0]}</span><button className={IS_PAGES_DEMO ? 'button secondary small-button demo-exit' : 'icon-button'} onClick={logout} disabled={signingOut} aria-label={IS_PAGES_DEMO ? 'Exit demo' : 'Sign out'}>{IS_PAGES_DEMO && <span>Exit demo</span>}<Icon name="logout"/></button></> : <button className="button secondary small-button" onClick={() => authenticate()} disabled={!session}>{IS_PAGES_DEMO ? 'Start demo' : 'Sign in'} <Icon name="arrow"/></button>}</div></header>
    <nav className="mobile-nav" aria-label="Mobile navigation">{nav}</nav>
    <main id="main">
      {sessionError && <div className="page-notice error" role="alert"><span>{sessionError}</span><button onClick={() => refreshSession().catch(error => setSessionError(errorText(error)))}>{IS_PAGES_DEMO ? 'Retry browser storage' : 'Retry connection'}</button></div>}
      {notice && <div className="page-notice success" role="status"><Icon name="check"/><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss notification"><Icon name="close"/></button></div>}
      {actionError && <div className="page-notice error" role="alert"><span>{actionError}</span><button className="icon-button" onClick={() => setActionError('')} aria-label="Dismiss error"><Icon name="close"/></button></div>}
      {view === 'discover' ? <>
        <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="tiny-line"/> BIG IDEAS START SOMEWHERE</span><h1>Your next chapter.<br/><span>Find your first step.</span></h1><p>Internships worth a closer look. Find your direction,<br className="desktop-break"/> save what sparks your interest, and take the next step.</p><a className="hero-link" href="#opportunities">Explore opportunities <Icon name="arrow"/></a></div>
          <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="art-star">✳</span><div className="mini-note note-one"><span className="note-icon"><Icon name="spark"/></span><div>A little curiosity.<strong>A lot of possibility.</strong></div></div><div className="path-card"><div className="path-card-top"><span>YOUR PATH, YOUR PACE</span><Icon name="arrow"/></div><div className="path-steps"><span className="step done"><Icon name="check"/></span><i/><span className="step current">2</span><i/><span className="step">3</span></div><div className="step-labels"><span>Discover</span><span>Make a move</span><span>Grow</span></div></div><div className="mini-note note-two"><span className="lime-dot"/><span>Start where you are.</span></div><span className="art-spark">+</span></div>
        </section>
        <section className="discovery" id="opportunities" aria-labelledby="opportunities-title"><div className="section-heading"><div><span className="eyebrow">THE OPPORTUNITY BOARD</span><h2 id="opportunities-title">Find your kind of internship.</h2></div><span className="catalog-label"><span className="catalog-dot"/> Synthetic catalog</span></div>
          <form className="search-bar" role="search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}><label className="search-field"><Icon name="search"/><span className="sr-only">Search title, company, skills, or location</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Role, skill, company, or city" maxLength={120}/></label><div className="search-select"><label htmlFor="work-mode">Where you work</label><select id="work-mode" value={workMode} onChange={e => setWorkMode(e.target.value)}><option value="">Any work mode</option><option>Remote</option><option>Hybrid</option><option>On-site</option></select></div><button className="button primary search-submit">Find opportunities <Icon name="arrow"/></button></form>
          <div className="filter-row"><div className="filter-tabs" aria-label="Filter by field">{['', 'Engineering', 'Data', 'Design', 'Operations'].map(value => <button key={value} aria-pressed={department === value} onClick={() => setDepartment(value)}>{value || 'All fields'}</button>)}</div>{filtered && <button className="text-button clear-filters" onClick={() => { setQuery(''); setSearch(''); setWorkMode(''); setDepartment(''); }}>Clear filters <Icon name="close"/></button>}</div>
          <div className="results-meta" aria-live="polite"><span>{loading ? 'Finding opportunities…' : jobsError ? 'Opportunities unavailable' : `${total} ${total === 1 ? 'opportunity' : 'opportunities'}${filtered ? ' match your filters' : ' to explore'}`}</span><span>Internships · Clear compensation</span></div>
          {loading ? <Loading/> : jobsError ? <ErrorState message={jobsError} retry={() => setReload(reload + 1)}/> : jobs.length === 0 ? <Empty icon="search" title="A different search might open a door." text="No internships match all your search terms and filters. Try a broader skill or adjust the work mode." action="Clear search & filters" click={() => { setQuery(''); setSearch(''); setWorkMode(''); setDepartment(''); }}/> : <div className="job-grid">{jobs.map(job => <JobCard key={job.id} job={job} saved={isSaved(job)} busy={saving.has(String(job.id))} select={() => setModal({ kind: 'detail', job })} save={() => toggleSave(job)}/>)}</div>}
        </section><section className="bottom-banner"><span className="banner-icon"><Icon name="bookmark"/></span><div><h2>Good opportunities deserve a shortlist.</h2><p>Save a few, take your time, and come back when you’re ready.</p></div><button className="button secondary" onClick={() => user ? navigate('saved') : authenticate()}>{user ? 'See your saved roles' : 'Start your shortlist'}<Icon name="arrow"/></button></section>
      </> : <section className="private-section"><div className="section-heading"><div><span className="eyebrow">YOUR NEXT CHAPTER</span><h1>{view === 'saved' ? 'Your possibilities, saved.' : 'Every step, in one place.'}</h1><p className="muted">{view === 'saved' ? 'A little space for the opportunities you want to revisit.' : (IS_PAGES_DEMO ? 'Practice applications saved in this browser’s demo workspace.' : 'Follow the applications you’ve submitted in this demo.')}</p></div><span className="section-illustration"><Icon name={view === 'saved' ? 'bookmark' : 'briefcase'}/></span></div>
        {!user ? <Empty icon={view === 'saved' ? 'bookmark' : 'briefcase'} title={view === 'saved' ? 'Your shortlist starts with you.' : 'Keep track of your next step.'} text={IS_PAGES_DEMO ? "Start Maya’s demo workspace to try saved roles and practice applications. Your changes stay in this browser." : "Sign in to your local account to view your saved roles and applications."} action={IS_PAGES_DEMO ? "Start demo" : "Sign in"} click={() => authenticate()}/> : privateBusy ? <Loading/> : privateError ? <ErrorState message={privateError} retry={() => setPrivateReload(privateReload + 1)}/> : view === 'saved' ? saved.length ? <><div className="results-meta"><span>{saved.length} saved {saved.length === 1 ? 'opportunity' : 'opportunities'}</span><button className="text-button" onClick={() => navigate('discover')}>Keep exploring <Icon name="arrow"/></button></div><div className="job-grid">{saved.map(job => <JobCard key={job.id} job={job} saved busy={saving.has(String(job.id))} select={() => setModal({ kind: 'detail', job })} save={() => toggleSave(job)}/>)}</div></> : <Empty icon="bookmark" title="A blank page, full of possibility." text="Save an internship from the opportunity board. It will be here when you’re ready to take another look." action="Explore internships" click={() => navigate('discover')}/> : applications.length ? <div className="application-list">{applications.map(application => <article className="application-card" key={application.id}><div className="application-heading"><span className={`company-mark tone-${application.job.department.toLowerCase()}`}>{application.job.companyInitials}</span><div><span className="company-name">{application.job.company}</span><h2><button onClick={() => setModal({ kind: 'detail', job: application.job })}>{application.job.title}</button></h2><span className="small-meta">{application.job.location} · {application.job.workMode}</span></div><span className={`status ${application.status.toLowerCase()}`}><span/>{application.status}</span></div><div className="application-body"><div><span className="eyebrow">YOUR INTRODUCTION</span><p>{application.motivation}</p></div><div className="timeline"><span className="eyebrow">APPLICATION HISTORY</span>{application.events.map((event, index) => <div key={index}><i/><span><strong>{event.status}</strong><time dateTime={event.at}>{displayDate(event.at)}</time></span></div>)}</div></div><div className="application-footer"><span>Demo application · No employer contacted</span>{application.status === 'Submitted' && (confirmWithdraw === String(application.id) ? <div className="withdraw-confirm"><span>Withdraw this application?</span><button className="text-button danger" disabled={Boolean(withdrawing)} onClick={() => withdraw(application)}>{withdrawing ? 'Withdrawing…' : 'Confirm withdrawal'}</button><button className="text-button" disabled={Boolean(withdrawing)} onClick={() => setConfirmWithdraw('')}>Keep application</button></div> : <button className="text-button" onClick={() => setConfirmWithdraw(String(application.id))}>Withdraw application</button>)}</div></article>)}</div> : <Empty icon="briefcase" title="Your first step is still ahead." text="When you submit a demo application, you’ll see the role, your introduction, and its status here." action="Find an internship" click={() => navigate('discover')}/>}</section>}
    </main>
    <footer className="site-footer"><div><strong>handshake <span>CAREER LAB</span></strong><p>An independent portfolio project by Gowtham Reddy.</p></div><p>Fictional companies. Synthetic opportunities.<br/>No affiliation with Handshake or any university.</p><a href="https://gowthamreddy-ch.github.io/" target="_blank" rel="noreferrer">View portfolio <Icon name="arrow"/></a></footer>
    {modal?.kind === 'auth' && <Modal title={IS_PAGES_DEMO ? 'Start demo workspace' : 'Account access'} busy={modalBusy} close={() => { setModal(null); pendingAction.current = null; }}>{IS_PAGES_DEMO ? <DemoStart authenticated={authenticated} busyChanged={setModalBusy}/> : <AuthForm session={session} authenticated={authenticated} busyChanged={setModalBusy}/>}</Modal>}
    {modal?.kind === 'apply' && user && <Modal key={`apply-${user.id}-${modal.job.id}`} title="Apply for internship" busy={modalBusy} close={() => setModal(null)}><ApplyForm job={modal.job} user={user} draft={applicationDrafts.current.get(user.id, modal.job.id)} recoverSession={() => recoverApplication(modal.job, user.id)} busyChanged={setModalBusy} applied={async result => { if (sessionRef.current?.user?.id !== user.id) return; setApplications(previous => [result, ...previous.filter(item => String(item.id) !== String(result.id))]); setModal(null); setView('applications'); setPrivateReload(value => value + 1); setNotice('Application submitted. You can review it or withdraw it here.'); }}/></Modal>}
    {modal?.kind === 'detail' && <Modal title={modal.job.title} wide close={() => setModal(null)}><div className="detail-header"><span className="eyebrow">A POSSIBILITY WORTH EXPLORING</span><div className="detail-company"><span className={`company-mark large tone-${modal.job.department.toLowerCase()}`}>{modal.job.companyInitials}</span><div><strong>{modal.job.company}</strong><span>Fictional company · {modal.job.department}</span></div></div><h2>{modal.job.title}</h2><div className="job-location"><Icon name="location"/>{modal.job.location}<span>·</span>{modal.job.workMode}</div><div className="detail-facts"><div><span>Compensation</span><strong>{pay(modal.job.salaryMin, modal.job.salaryMax, modal.job.currency)} / hour</strong></div><div><span>Opportunity</span><strong>{modal.job.employmentType}</strong></div><div><span>Apply by</span><strong>{displayDate(modal.job.closesAt)}</strong></div></div></div><div className="detail-body"><h3>Your opportunity</h3><p>{modal.job.description}</p><h3>What you’ll bring</h3><ul className="requirements">{modal.job.requirements.map(requirement => <li key={requirement}><Icon name="check"/>{requirement}</li>)}</ul><h3>Skills you can put to work</h3><div className="tags skills">{modal.job.skills.map(skill => <span key={skill}>{skill}</span>)}</div><p className="detail-date">Posted {displayDate(modal.job.postedAt)} · Synthetic demonstration role</p></div><div className="detail-actions"><button className={`button secondary ${isSaved(modal.job) ? 'saved' : ''}`} disabled={saving.has(String(modal.job.id))} onClick={() => toggleSave(modal.job)}><Icon name="bookmark"/>{isSaved(modal.job) ? 'Saved' : 'Save role'}</button>{hasApplication(modal.job) ? <button className="button primary" onClick={() => { setModal(null); navigate('applications'); }}>View application <Icon name="arrow"/></button> : <button className="button primary" onClick={() => apply(modal.job)}>Apply for internship <Icon name="arrow"/></button>}</div><div className="detail-disclaimer">{IS_PAGES_DEMO ? "Demo applications stay only in this browser. Use fictional information; no employer is contacted." : "Applications are stored locally. No employer receives your information."}</div></Modal>}
  </>;
}
function Loading() { return <div className="loading-state" role="status"><span className="spinner"/>Loading your next possibilities…</div>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="empty-state" role="alert"><span className="empty-icon"><Icon name="briefcase"/></span><h3>We couldn’t load this just yet.</h3><p>{message}</p><button className="button secondary" onClick={retry}>Try again <Icon name="arrow"/></button></div>; }
function Empty({ icon, title, text, action, click }: { icon: IconName; title: string; text: string; action: string; click: () => void }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon}/></span><h3>{title}</h3><p>{text}</p><button className="button secondary" onClick={click}>{action}<Icon name="arrow"/></button></div>; }
