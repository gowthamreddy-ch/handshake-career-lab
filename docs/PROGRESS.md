# Publication progress

## October 8, 2026

- User authorized a new GitHub repository and GitHub Pages deployment.
- Consolidated tracked frontend/backend source into a new repository; omitted local databases, session keys, dependency folders, raw machine-path test logs and unrelated repository-audit notes.
- Preserved the original frontend/backend repositories and their local rehabilitation commits.
- Preparing an explicitly labeled passwordless browser demo for Pages, alongside the full API source.
- Prepared root workflows for frontend/backend verification and Pages artifact deployment.
- Pre-consolidation evidence: ten frontend checks, ten backend scenarios (11 Node entries including the parent), release builds, migration consistency and restart persistence passed locally. These are not yet verification of the new Pages adapter or consolidated CI.
- Browser visual/mobile/keyboard checks remain unverified after browser tool initialization failed; no screenshots are claimed.

### Consolidated verification before push

- 22 frontend checks passed: 10 existing client/domain checks and 12 new browser-demo scenarios, including reset isolation, persistence, replay conflicts and denied/corrupt storage.
- The Pages build passed. Its five generated files use the correct project prefix; three linked assets resolve locally. Static checks found zero localhost links; a separate source/bundle audit found no credential patterns, private audit notes, runtime data or machine-specific paths. The Pages bundle excludes server API transport and source maps.
- The consolidated backend Release build passed with zero warnings/errors. All ten API scenarios passed (11 Node entries including the parent), and saved roles, applications, UTC responses and the authenticated session survived an API restart.
- Browser initialization was retried and failed with a Windows sandbox-helper error. These checks do not claim visual/mobile/keyboard or browser end-to-end verification.

Remote CI, Pages deployment and live HTTP results will be recorded after publication.
