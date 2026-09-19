# CLIProxy Console

[![Checks](https://github.com/piyush-gambhir/cliproxy-console/actions/workflows/ci.yml/badge.svg)](https://github.com/piyush-gambhir/cliproxy-console/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A local web console for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).
Choose the subscription that handles a request, compare usage and reset dates,
and configure Claude clients from one interface.

- **Manual subscription selection.** Named accounts, unique routes, and validation
  that rejects missing, disabled, or shared account routes. No automatic account fallback.
- **Usage and reset dates.** Refresh provider-reported limits on demand, see when a
  snapshot was captured, and keep manual notes separate from measured usage.
- **Claude setup.** Configure a local Desktop gateway or generate a standard CLI
  launch command. Choose allowed models, default effort, and supported client options.
- **Advanced connections.** Preview project settings, save with a backup, or copy
  a shell function for a selected account.
- **Local administration.** Manage accounts, inspect strict routing, and customize
  the console name. The React UI uses shadcn/ui components.

This is an independent community project. CLIProxyAPI and the provider clients
are separate projects; this console does not grant model access or additional quota.

## Requirements

- Node.js **24 or newer** and npm.
- A running CLIProxyAPI instance with its Management API enabled. Tested against
  upstream commit `61fdfc341b96178a8dcb53f2efc46cbc341d267c`; compatibility with future
  releases should be checked using the tests below.
- A proxy **management key** for the console. Claude requests use a separate
  **client API key** from CLIProxyAPI.
- Provider accounts added to CLIProxyAPI, with access to the models you intend to use.

Core console tests run on Linux and macOS. The Desktop configuration editor targets
macOS Claude Desktop's local gateway `configLibrary`. The optional LaunchAgent
installer requires macOS, Homebrew, and Python 3.9+. Windows is not validated.

## Quick start

```sh
git clone https://github.com/piyush-gambhir/cliproxy-console.git
cd cliproxy-console
npm ci
npm run build
npm start
```

Open [Subscriptions & usage](http://127.0.0.1:8320/#profiles).

1. In CLIProxyAPI, set `remote-management.secret-key` in its configuration and
   restart the proxy. Keep the proxy and Management API bound to localhost for a local setup.
2. Open **Settings** in the console. Enter the proxy URL (default
   `http://127.0.0.1:8317`) and the same management key. Optionally change the console name.
3. Add or import accounts, name them, and give each account a unique prefix.
4. Open **Request settings** to verify manual routing. Automatic project/model
   switching and retries must be disabled for the scoped Claude gateway.
5. Use **Advanced connections** for project wiring, or **Claude setup** after
   configuring a local Gateway connection in Claude Desktop.

An unset management secret can make CLIProxyAPI's management endpoints return
404. A client API key is not a substitute for the management key.

For development, run `npm run dev`: the API listens on port **8320**, and Vite on
**8321**. The generated Claude routes use port 8320; retain that port for client setup.

## Choosing a subscription

Each profile has a unique proxy prefix. The console checks that the requested
model belongs to that account before saving client settings or forwarding a request.
The scoped Claude route is `/inference/<profile-id>`. Claude sees canonical model IDs;
the server selects the account-specific upstream route.

When the chosen account is unavailable or out of quota, the request must fail on
that account. Select another subscription yourself. Changing a Desktop configuration
requires restarting that client; existing sessions can retain their earlier settings.
The console shows saved configuration, not live attribution for every running session.

### Claude CLI

The CLI tab generates a command for the standard `claude` binary. No private shell
wrapper or `--subscription` extension is required. Set `CLIPROXY_API_KEY` to a proxy
client key, then run the generated command from your project folder. Client keys are
available in **Advanced connections** or CLIProxyAPI's own management panel.

The command scopes connection settings to that invocation and pins default and
subagent model roles to the selected subscription. It does not embed a key in the
copied command. Advanced connections can also generate settings or a shell function;
those previews can contain the client key and should not be shared.

See the [Claude CLI reference](https://code.claude.com/docs/en/cli-reference) for
native flags and session controls. A request failing over to another subscription is
not enabled by changing Claude's permission or reasoning mode.

### Models and client capabilities

The scoped Claude gateway currently allows `claude-opus-5` and `claude-fable-5-1`.
Its catalog advertises a 1M context preference. These are configured capabilities,
not live entitlement checks: model access, accepted context size, effort levels,
Auto mode, Ultracode, and Fast mode depend on the provider and installed client.
A model appearing in the picker does not prove that your account can run it.

The general Advanced connections screen uses the selected account's registered
model list. To change the scoped Claude allowlist, update
`server/src/inference.ts` and `web/src/views/Desktop.tsx` together and run the tests.
The console does not enable paid provider features or change billing settings.

## Configuration and local data

The app binds to **127.0.0.1** and has no console login. It is intended for a trusted
single-user computer. Do not expose port 8320 through a public host or tunnel.
See [SECURITY.md](SECURITY.md) for the trust boundary and private reporting.

| Setting or data | Location |
| --- | --- |
| Console name, proxy URL, management key | `~/.cliproxy-console/config.json` |
| Profile names, account mapping, prefix records, notes | `~/.cliproxy-console/profiles.json` |
| Normalized usage snapshots | `~/.cliproxy-console/subscription-usage.json` |
| Recent project paths | `~/.cliproxy-console/recent-paths.json` |
| Provider OAuth credentials | CLIProxyAPI's configured auth directory, commonly `~/.cli-proxy-api/` |
| Desktop gateway configuration | macOS `~/Library/Application Support/Claude-3p/configLibrary/` |

`CLIPROXY_URL` and `CLIPROXY_MGMT_KEY` override saved proxy connection settings.
Set them in your process environment; `.env` files are not automatically loaded.
The management key stays on the server. Client keys can be returned to the browser
for explicit client setup. Configuration writes use restricted file permissions;
client settings are backed up before replacement.

None of these runtime directories belong in Git. See [.gitignore](.gitignore).

## Validation and development

```sh
npm run typecheck
npm test
npm run test:service
npm run build

# Optional: test a real proxy binary against two local fake providers.
CLIPROXY_BIN=/absolute/path/to/cliproxyapi npm run test:routing-integration
```

The routing integration test uses temporary fake credentials. It verifies explicit
A/B selection and that failure on A never calls B. It sends no inference requests
to real providers. Go source and proxy builds live in the separate CLIProxyAPI repo.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and
[the Management API contract](server/src/mgmt-contract.ts) for implementation notes.

## Optional proxy service management

The console works with an already-running proxy. The optional
[macOS service helper](docs/proxy-service.md) can install versioned proxy builds,
verify account/routing preservation, and retain a rollback binary. Its repository,
service labels, executable paths, and console URL are configurable locally.

## License and credits

[MIT](LICENSE). UI components include code from [shadcn/ui](https://github.com/shadcn-ui/ui);
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Runtime dependencies retain
their respective licenses. CLIProxyAPI, Claude, and their owners do not endorse this project.
