# API integration checks

Recommended: run `node scripts/test-api.mjs` from the repository root. It builds the API, creates a new isolated database on port 4192, runs these HTTP tests, verifies a process restart, and stops its own API. See the root README for portable SDK environment variables. The low-level invocation below is useful only when managing a disposable API yourself.

Requires Node.js 22 or later and an **externally started disposable API/database** on `http://127.0.0.1:4192`.

```powershell
$env:HANDSHAKE_TEST_URL = 'http://127.0.0.1:4192'
node --test tests/*.test.mjs
```

No npm packages are required. The test client uses Node's built-in test runner, `fetch`, and a separate in-memory cookie jar for each simulated browser.

The test refuses non-loopback URLs, HTTPS, and every port except 4192. In particular, it cannot write to the interactive demo on port 4191. Start the API with a separate disposable database; changing the HTTP port alone does not isolate storage.

The suite creates three uniquely named synthetic users and leaves their records in that disposable database. It does not reset storage, delete other users, send email, or call external APIs. Repeated runs use new accounts. Provision the regular synthetic catalog with at least three opportunities. Run one copy of the suite at a time so registration/login rate limits do not mask functional failures.

Coverage includes anonymous access, CSRF token binding, input validation, generic login errors, search/filter behavior, saved-opportunity isolation, application idempotency, concurrent writes, withdrawal history, and logout. It checks persistence across sessions in the same server lifetime. It does **not** establish durability across a process restart, production deployment safety, load capacity, email delivery, or browser accessibility.

An application state assertion checks the API's observable outcome. These HTTP tests do not inspect implementation details or the database directly.
