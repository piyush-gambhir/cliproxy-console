# CLIProxy Console

[![Checks](https://github.com/piyush-gambhir/cliproxy-console/actions/workflows/ci.yml/badge.svg)](https://github.com/piyush-gambhir/cliproxy-console/actions/workflows/ci.yml)

A React and shadcn/ui **frontend** for [CLIProxyAPI](https://github.com/piyush-gambhir/CLIProxyAPI/tree/piyush).

CLIProxyAPI owns authentication, subscriptions, model policy, routing, usage checks,
request history, client setup, storage, and the Claude launcher. This repository has
no application server, database, management proxy, or background synchronization.
The proxy serves the built frontend from `/console/`.

## Run

Build the frontend with Node 24 or newer:

```sh
npm ci
npm run build
```

Use the fork's native console backend and configure `<proxy-config>.console.json`:

```json
{
  "dataDir": "/absolute/path/to/private/proxy-administration-data",
  "webDir": "/absolute/path/to/cliproxy-console/web/dist",
  "compatibilityPort": 0
}
```

Start CLIProxyAPI, then open [the console](http://127.0.0.1:8317/console/).
Connect using the proxy's existing management key. It is kept in browser tab session
storage; **Lock console** clears it. The frontend sends authenticated requests directly
to `/v0/management/console/*` and the proxy's existing `/v0/management/*` endpoints.

Unmodified upstream does not contain these native console endpoints. There is no
fallback Node backend. See the fork's [native console documentation](https://github.com/piyush-gambhir/CLIProxyAPI/blob/piyush/docs/native-console.md)
for installation, migration, storage, CLI launch, and rollback.

## Features

- Select subscriptions manually for Desktop or CLI. No automatic account fallback.
- Configure official model IDs, the allowed 1M model list, effort, and helper/subagent roles.
- Inspect actual account selection, requested and returned model, effort, tokens,
  cache use, errors, and observed long-context use.
- Refresh provider usage and reset dates on demand; snapshots retain their timestamps.
- Preview and save client configuration with backups. Existing conversation history stays in the client.
- Configure proxy-owned storage, frontend deployment, and optional service helpers.

All validation and persistence run in CLIProxyAPI. UI previews are produced by its
management API, including shell commands and client settings.

“1M configured” is a requested capability. “Above 200K observed” records a completed
request with reported input plus cache tokens above 200K; it does not prove the full
1M maximum or remaining quota. Claude Desktop owns its model picker and can still
show an internally generated standard-context row. Model access and client features
remain subject to the selected account and installed client.

## Development

```sh
npm run dev
npm run typecheck
npm test
npm run build
```

Vite serves `/console/` on port 8321. Its development proxy forwards management
requests to `http://127.0.0.1:8317`; override with `CLIPROXY_DEV_API`. Vite handles
static development assets only and contains no account or inference logic.
`npm start` previews the static build; use CLIProxyAPI to serve the production app.

No private names, account mappings, keys, or user machine paths are bundled.
Provider OAuth credentials remain in CLIProxyAPI's existing auth directory.
This independent community project does not grant model access or additional quota.

MIT licensed; see [LICENSE](LICENSE) and [SECURITY.md](SECURITY.md).
