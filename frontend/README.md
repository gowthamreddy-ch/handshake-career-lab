# Career Lab frontend

React 19.3, TypeScript 7.0.2 and Vite 8.3.4. See the [root README](../README.md) for the live demo, architecture and full setup.

```sh
npm ci --ignore-scripts
npm test
npm run build          # Full-stack mode: requires the API
npm run build:pages    # Explicit browser-only demonstration
```

`npm run dev` serves on 4190 and proxies `/api` to the local API on 4191. The full-stack mode never falls back to synthetic browser responses during a service failure.

The Pages build has the `/handshake-career-lab/` base path. It uses the synthetic catalog and a single fictional profile with namespaced localStorage. It has no password or registration UI and sends no application to an employer. Demo data can be reset from the interface. The full-stack build uses the real Identity/CSRF API; browser-demo behavior does not establish server authorization or concurrency guarantees.

Source includes discovery/search/filtering, job details, saved opportunities, applications and history, withdrawal, account-scoped in-memory drafts and bounded request recovery. State-only navigation resets to Discover on a full page reload. Responsive CSS/native dialogs are implemented; browser rendering, keyboard, and mobile behavior remain unverified because browser tools could not initialize.

The synthetic catalog and all icon/illustration markup are included locally; no remote fonts, images or analytics are used. GitHub Pages still has its own static-host access logging. No real user or hiring outcome evidence is claimed.
