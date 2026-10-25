# Node upgrade review

Reviewed locally on 2026-10-26 against `origin/main` at `23f0ef9`.
The newer CI runner, timeout, concurrency, read permissions and action versions
are retained. No application or security behavior is changed.

## Tooling and verification

- The existing `.nvmrc`, root/workspace engines and CI use Node 26.12.1.
  The existing npm workspace and single lockfile are preserved.
- Standalone TypeScript 7.0.2 is retained, with an explicit compiler invocation
  from the web workspace. No TypeScript 6 compiler API consumer exists here.
- Updates: cn 0.4.0 to 0.5.0, lucide-react 1.55.0 to 1.61.0 and Node typings
  24.19.2 to 26.6.5. Private package versions remain 0.1.0.
- Clean `npm ci`, TypeScript check, all three API tests and the Vite production
  build pass under exact Node 26.12.1. No configured lint task exists.
- Full and production audits report zero vulnerabilities. `npm outdated`
  reports no direct updates.
- A real browser loaded the built `/console/` assets against a disposable
  loopback HTTP management API fixture. Invalid-key rejection, authenticated
  native route calls, subscriptions empty state, request-history navigation,
  explicit locking and expired-key rejection pass. The key is cleared on lock
  and 401. There were 20 GET requests, zero writes and zero page errors.
- External requests were blocked. No real CLIProxyAPI instance, provider,
  account, credential file or user data was accessed. The fixture was not the
  development proxy, which could otherwise forward to a live local service.

## Release boundary and limits

The artifact is `web/dist`, served by CLIProxyAPI. This repository intentionally
has no application server, database or Docker runtime contract. A new container
or fallback backend was not introduced. Real native-backend persistence, setup
writes, account management and provider inference remain separate integration
checks.

GitHub Actions runs checks on main pushes, pull requests and manual dispatch.
There is no release or deployment workflow here; both npm workspaces remain
private. No push, tag, publication, provider call or deployment was performed.

Node's existing TypeScript-stripping test helper emits an experimental warning.
Vite reports existing client-directive warnings from UI libraries. These were
not suppressed. Contributor instructions now describe the current native API,
configured scripts and session-storage authentication, consistent with
`SECURITY.md`, instead of the removed Node backend.

The demonstrated gains are explicit Node 26 support, matching Node typings and
current compatible helper/icon dependencies. Existing zero-advisory status is
preserved. No comparative benchmark was run, so no frontend or Go runtime
speedup is claimed.
