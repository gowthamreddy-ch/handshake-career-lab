// The public Pages build is deliberately separate from the server-backed app.
// Node's import.meta has no env object, so ordinary unit tests stay in server mode.
export const IS_PAGES_DEMO = import.meta.env?.VITE_DEMO_MODE === 'pages';
