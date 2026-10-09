# Career Lab API

ASP.NET Core 10 / Identity / EF Core 10.0.12 / SQLite. This is the **full-stack application**, separate from the public browser simulation. See the [root README](../README.md) for setup and [decisions](../docs/DECISIONS.md) for engineering rationale.

The SDK is pinned in `global.json`. Start commands must run from this directory. No API keys or external database service are needed.

```powershell
dotnet restore --locked-mode
# First run npm ci and npm run build in ../frontend.
./scripts/Start-Demo.ps1
# Portable SDK: add -DotnetExecutable 'C:/path/to/dotnet.exe'
```

The launcher serves built UI and API together at http://127.0.0.1:4191/ and applies committed migrations. Stop with `./scripts/Stop-Demo.ps1`; saved data remains in ignored `.runtime/`. The old `index.js` is historical context only, not the active entry point.

For foreground execution on Bash: `ASPNETCORE_ENVIRONMENT=Development dotnet run -- --urls http://127.0.0.1:4191 --Demo:Enabled true --Frontend:Path ../frontend/dist`. In PowerShell set `$env:ASPNETCORE_ENVIRONMENT='Development'` first, then run the dotnet command. Never point full-stack serving at a `build:pages` output.

The deliberately public local demo login is `maya@demo.handshake.test` / `HandshakeDemo2026!`. The seeder only creates that identity in demo mode, which is loopback-only. Disabling demo mode does not delete an existing account, so a public API must use a fresh database and separate deployment controls.

## API

| Route | Behavior |
| --- | --- |
| `GET /api/session` | Current user, CSRF token and optional local demo hint |
| `POST /api/auth/register`, `/login`, `/logout` | Identity cookie authentication |
| `GET /api/jobs?q=&workMode=&department=` | Literal AND search with exact filters |
| `GET /api/jobs/{id}` | Job detail |
| `GET /api/saved` | Current student's shortlist |
| `PUT`, `DELETE /api/saved/{id}` | Idempotent save/remove |
| `GET /api/applications` | Owned applications and events |
| `POST /api/applications` | Job ID and 50–2,000-character motivation; UUID Idempotency-Key |
| `POST /api/applications/{id}/withdraw` | Owner-only Submitted → Withdrawn transition |

Every API mutation requires `X-CSRF-TOKEN` with the session cookie. Refresh the token after authentication changes. Ownership is derived from authenticated claims. Indexes enforce unique user/job and user/key pairs. Request fingerprints reject a reused key with changed content. Application and event writes commit together; UTC DateTime materialization stabilizes replay responses.

## Tests and migrations

`node scripts/test-api.mjs` builds the API, starts a disposable database/service on 4192, runs authentication/CSRF/ownership/idempotency/race checks, then verifies persistence after a process restart. It refuses an occupied HTTP origin. The interactive 4191 demo is untouched. Portable SDK users set `HANDSHAKE_DOTNET` and `DOTNET_ROOT` first. Test databases/logs remain ignored in `.runtime/suite-*`.

`dotnet tool restore` installs the pinned migration tool. Use `dotnet ef migrations list` and `dotnet ef migrations has-pending-model-changes` to inspect migration state. Startup migration is suitable for this local slice, not a multi-instance deployment migration strategy.

The catalog is seeded only when empty and closes roles 31–42 days after initial seed. Select a new `--Database:Path` for a fresh synthetic scenario while preserving existing records. No employer workflow, verified email/recovery, uploads, real applications, production traffic, or public API hosting is claimed.
