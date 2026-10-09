# Provenance and decisions

This repository consolidates new work from Gowtham Reddy's historical `handshake-frontend` and `handshake-backend` projects. The old repositories and their history remain intact.

- Original frontend baseline: `5b28e12`, a Create React App login shell with a placeholder API.
- Original backend baseline: `da761b5`, a Node hello-world server.
- Local rehabilitation snapshots before consolidation: frontend `a657ac4`, backend `a0e5458`.
- The broader historical `Lab1-handshake-frontend` informed the student workflow; its authentication implementation and university branding were not reused.

The new backend is substantial new engineering, not a claim that a functioning production Node service was migrated. ASP.NET Core/Identity fits the author's .NET experience. React and TypeScript provide a small client; Vite replaces deprecated CRA. SQLite keeps the local demonstration reproducible without a database service.

GitHub Pages is a static host. A separately selected browser adapter supports a useful recruiter demo without pretending to host the API. It has a single fictional persona and no real sign-in. Its state is browser-local and not a security boundary. A service outage in full-stack mode produces an error; it never switches to the demo adapter automatically.

Database uniqueness, rather than button disabling, enforces the application invariant. Both the duplicate precheck and unique-constraint catch re-read the idempotency key because another request may commit between reads. Application and event writes commit together; conditional withdrawal prevents repeated events.

An early integration run exposed SQLite's loss of DateTime.Kind: a newly submitted response included UTC suffixes but a loaded response did not. The materialization converter and replay/UTC assertions now cover this regression. Other reviewed issues fixed before publication include web-root startup configuration and client recovery after uncertain auth writes.

Potential interview claims should describe the implemented browse/save/apply workflow, API ownership boundaries, retry handling, and the reproducible tests. Do not claim production traffic, measured hiring impact, AI ranking quality, or real employer integrations.

Current version guidance was checked against the official [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core), [CRA deprecation notice](https://react.dev/blog/2025/02/14/sunsetting-create-react-app), and [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages). Lockfiles record exact dependencies.
