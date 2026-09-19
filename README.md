# CLIProxy Console

[![Checks](https://github.com/piyush-gambhir/cliproxy-console/actions/workflows/ci.yml/badge.svg)](https://github.com/piyush-gambhir/cliproxy-console/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A local web console for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).
Choose the subscription that handles a request, compare usage and reset dates,
and configure Claude clients from one interface.

- **Manual subscription selection.** Named accounts, unique routes, and validation
  that rejects missing, disabled, or shared account routes. No automatic account fallback.
- **Request history.** See the selected account, requested/returned model, effort, input/cache/output tokens, failures and context evidence. Prompts, responses and keys are excluded.
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
- For direct account routes and request history, use the [maintained fork](https://github.com/piyush-gambhir/CLIProxyAPI/tree/piyush) with `account-gateway` support. Unmodified upstream uses the older console relay without request receipts.
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
**8321**. Set `PORT` to choose a different API port; generated client routes and the
Vite API proxy follow it. Restart clients after changing their gateway URL.

## Choosing a subscription

Each profile has a unique proxy prefix. The console checks that the requested
model belongs to that account before saving client settings or forwarding a request.
The scoped Claude route is `/inference/<profile-id>`. Claude sees canonical model IDs;
the server selects the account-specific upstream route.

When the chosen account is unavailable or out of quota, the request must fail on
that account. Select another subscription yourself. Changing a Desktop configuration
requires restarting that client; existing sessions can retain their earlier settings.
Claude setup shows saved configuration. **Request history** shows observed, completed requests and confirms whether the proxy selected the intended credential. Requests still in flight and older requests made before this feature have no receipt.

### Direct routing and request history

With the fork, client requests go to `http://127.0.0.1:8317/inference/<profile-id>`.
The console synchronizes account routes through the Management API when settings
change and every 10 seconds. Inference does **not** call the Management API and
continues when the console is closed. The proxy pins the account in its auth manager;
an exhausted, disabled or missing account cannot fall back to another account.
Existing port-8320 connections are relayed to these native routes for compatibility.
Reapply client setup to make new sessions independent of the console.

The proxy saves routes and a bounded receipt journal beside its config at
`<config-file>.gateway/` (override with `CLIPROXY_ACCOUNT_GATEWAY_DIR` in the proxy
process). Management authentication protects configuration and receipt endpoints;
normal proxy client keys protect inference. The console imports the latest 5,000
receipts into `<data directory>/request-history.sqlite`. History retention is
configurable in Settings (1–365 days, default 30). If more than 5,000 requests finish
while the console is offline, older unimported receipts may be unavailable.

“1M configured” describes the requested capability. “Above 200K observed” means a
completed message response reported input plus cache-read/write usage above 200K.
Neither proves the full 1M maximum or remaining subscription quota. Missing provider
usage is shown as unknown, not zero. Count-token calls do not verify long-context
generation. Receipt retention is separate from the proxy's own request-log settings.

### Claude CLI

The CLI tab can save a default subscription for the optional local launcher below,
and generates a command for the standard `claude` binary. No private shell
wrapper or `--subscription` extension is required. Set `CLIPROXY_API_KEY` to a proxy
client key, then run the generated command from your project folder. Client keys are
available in **Advanced connections** or CLIProxyAPI's own management panel.

The command scopes connection settings to that invocation and pins default and
subagent model roles to the selected subscription. Background and subagent model choices are configurable independently in Settings. It does not embed a key in the
copied command. Advanced connections can also generate settings or a shell function. Shell functions
read the key from your shell environment. Settings previews and written client files
can contain the client key and should not be shared.

See the [Claude CLI reference](https://code.claude.com/docs/en/cli-reference) for
native flags and session controls. A request failing over to another subscription is
not enabled by changing Claude's permission or reasoning mode.

### Background and subagent models

Settings exposes the background helper model (`ANTHROPIC_DEFAULT_HAIKU_MODEL`) and
default subagent model (`CLAUDE_CODE_SUBAGENT_MODEL`). Both use the allowed 1M list.
Leaving a role on “selected main model at setup” resolves it when generating a CLI
command or applying Desktop setup; it does not dynamically follow later model changes.
Applying Desktop setup backs up and updates these two env values in the shared Claude
settings file. The deprecated small-fast override is removed. Other settings and
history are preserved. A subagent's explicit model declaration can override the default,
but the gateway allowlist and account pin still apply. See [Anthropic's model role
configuration](https://code.claude.com/docs/en/model-config#environment-variables).

### Optional plain `claude` launcher

To have plain `claude` use the saved CLI subscription while sharing your existing
history, add a function to your shell profile pointing to this checkout:

```sh
claude() { node /absolute/path/to/cliproxy-console/scripts/claude-proxy.ts "$@"; }
```

Keep the standard Claude binary on PATH. This launcher reads local SQLite/profile
settings and, if needed, the already configured Desktop client key. It does not call
the console or Management API to start a session. It only connects to a loopback proxy.
In **Claude setup → Claude CLI**, choose an account and **Save CLI subscription**.
Use `claude --subscription 'Account name' --model opus` for a single-session override,
or `claude --list-subscriptions` to list saved names. Model aliases resolve against
the frontend allowlist. The launcher rejects cloud/remote-control and automatic
fallback flags. Other clients and direct use of the underlying binary are separate.

### Models and client capabilities

The scoped Claude gateway defaults to `claude-opus-5` and `claude-fable-5-1`.
Edit **Settings → Allowed Claude models · 1M** to add/remove official model IDs,
change labels, reorder the CLI default, and set effort caps. The console accepts
only 1M model entries, advertises their 1M capability, and sends the 1M beta header
on inference requests. Canonical provider IDs stay unchanged on the wire. These are configured capabilities,
not live entitlement checks: model access, accepted context size, effort levels,
Auto mode, Ultracode, and Fast mode depend on the provider and installed client.
A model appearing in the picker does not prove that your account can run it.

Desktop, CLI commands, Advanced connections, model discovery, and the inference
allowlist all read the same saved model configuration. Account registration is
checked separately; adding a model here does not grant access to it.

Claude Desktop's supported configuration cannot hide its internally generated
standard-context row. It normalizes a `[1m]` entry into a base model plus a 1M
variant. Applying setup sets `supports1m`, `prefer1m`, `modelPrefer1mContext`, and
disables discovery so only your chosen model families appear. New sessions use
the configured default; existing sessions may require choosing the 1M row once.
The console does not patch the installed Claude app or claim the standard row is
hidden. See [Anthropic's context configuration](https://code.claude.com/docs/en/model-config#extended-context).
The console does not enable paid provider features or change billing settings.

## Configuration and local data

The app binds to **127.0.0.1** and has no console login. It is intended for a trusted
single-user computer. Do not expose port 8320 through a public host or tunnel.
See [SECURITY.md](SECURITY.md) for the trust boundary and private reporting.

| Setting or data | Location |
| --- | --- |
| Console connection, keys, models, effort defaults, client folder settings | `~/.cliproxy-console/settings.sqlite` |
| Startup port and storage-location plan | `~/.cliproxy-console/startup.json` (fixed bootstrap location) |
| Profile names, account mapping, prefix records, notes | `~/.cliproxy-console/profiles.json` |
| Request metadata and token history | `<data directory>/request-history.sqlite` |
| Normalized usage snapshots | `~/.cliproxy-console/subscription-usage.json` |
| Recent project paths | `~/.cliproxy-console/recent-paths.json` |
| Provider OAuth credentials | CLIProxyAPI's configured auth directory, commonly `~/.cli-proxy-api/` |
| Desktop gateway configuration | macOS `~/Library/Application Support/Claude-3p/configLibrary/` |

Open **Settings** to save your own name, proxy connection, and keys. No accounts,
keys, personal names, or machine paths are bundled. The default name is **CLIProxy
Console**; account labels are user-created profiles, separate from model IDs.

Configuration precedence is **nonempty environment variable → saved SQLite value →
generic default**. Settings shows which source is active. Environment values are
never copied to SQLite by a save. Empty key fields in the API clear saved keys;
clearing a saved key does not remove an environment override. The UI's **Clear
stored key** buttons make this distinction explicit.

| Environment variable | Purpose / default |
| --- | --- |
| `CLIPROXY_DISPLAY_NAME` | Console branding; default `CLIProxy Console` |
| `CLIPROXY_URL` | Proxy base URL; default `http://127.0.0.1:8317` |
| `CLIPROXY_MGMT_KEY` | Proxy management key; unset by default |
| `CLIPROXY_API_KEY` | Optional proxy client key for model discovery and client setup |
| `CLIPROXY_DATA_DIR` | Override the saved startup data directory; default `~/.cliproxy-console` |
| `CLIPROXY_SETTINGS_DB` | Override the saved SQLite path; default `<data directory>/settings.sqlite` |
| `PORT` | Override the saved startup API port; default `8320` |
| `CLIPROXY_STARTUP_FILE` | Bootstrap file location; default `~/.cliproxy-console/startup.json` |
| `CLIPROXY_CLAUDE_MODELS` | Override the frontend model list with a JSON array of `{id,label,contextWindow:1000000,maxEffort}` |
| `CLIPROXY_CLAUDE_BACKGROUND_MODEL`, `CLIPROXY_CLAUDE_SUBAGENT_MODEL` | Override saved model-role choices with allowed official model IDs |
| `CLIPROXY_CLI_PROFILE` | Optional saved profile ID for the local launcher; otherwise use the Desktop subscription |
| `CLIPROXY_CLI_EFFORT` | Override the saved default CLI effort |
| `CLIPROXY_CONSOLE_URL` | Client-facing loopback origin; default `http://127.0.0.1:<PORT>` |
| `CLIPROXY_DESKTOP_CONFIG_DIR` | Override the Desktop `configLibrary` directory |
| `CLAUDE_CONFIG_DIR` | Shared Claude CLI config directory; default `~/.claude` |
| `CLIPROXY_AUTH_DIR`, `CLIPROXY_CONFIG` | Additional proxy credential paths protected from client-setup writes |

**Frontend controls:** Settings includes connection/branding, write-only keys,
allowed 1M models, default CLI effort, client-facing console URL, and existing
Claude configuration folders. Subscription selection and Desktop behavior remain
in **Claude setup**; account notes and reset dates are in **Subscriptions & usage**;
manual routing is in **Request settings**.

Expand **Server, storage and service settings** for the local server port, data
directory, SQLite location, and optional macOS service-helper configuration. These
have explicit save buttons. Port/storage changes are staged until restart; the
running instance keeps its original addresses and files. On restart, a storage
relocation copies the data into a new directory, retains the original as a backup,
and refuses to overwrite an existing destination. Cancel pending changes before
restart from the same panel. Restart the console using your normal launcher or
service manager, then reapply client connections if the URL changed.

Service-helper changes apply at the next install/update, not to an already running
LaunchAgent. Environment overrides are displayed and locked in the frontend;
remove them from the process environment to let frontend values take precedence.
The bootstrap-file location itself is a launcher setting, since the server needs
to find it before it can read any saved configuration.

See [.env.example](.env.example) for a template. Set variables in the process
environment; `.env` files are **not loaded automatically**. The console process and
Claude CLI have separate environments: a key saved in Settings is not exported to
your terminal. Set `CLIPROXY_API_KEY` in the shell running a copied launch command.
A configured client key must already exist in CLIProxyAPI; saving it here does not
create or rotate upstream keys. Without it, model discovery uses the proxy's first
configured client key. Inference always authenticates the requesting client's key.
Provider OAuth credentials remain in CLIProxyAPI's auth store.

On first startup, the console migrates `<data directory>/config.json` into SQLite
transactionally and renames the JSON to `config.json.migrated` as a private backup.
Migration preserves the existing name, URL and management key. A migration marker
prevents stale JSON from overwriting later database changes. Invalid legacy data
stops startup rather than silently discarding settings. Keep the backup until you
have verified your setup, then remove it if no longer needed.

SQLite and migration backups use owner-only file permissions (`0600`). The database
is **not encrypted**; protect it like a password file. Exclude it and backups from
shared folders and public archives. Settings responses report key presence and
source only. Explicit client setup previews can return the client key, and written
client settings are private and backed up before replacement. Profiles, usage
snapshots, and recent paths remain local JSON files; changing the settings backend
does not change subscriptions, account IDs, routing, or conversation history.

None of these runtime directories belong in Git. See [.gitignore](.gitignore).

## Validation and development

```sh
npm run typecheck
npm test
npm run test:service
npm run build

# Optional: test a real proxy binary against two local fake providers.
CLIPROXY_BIN=/absolute/path/to/cliproxyapi npm run test:routing-integration
CLIPROXY_BIN=/absolute/path/to/cliproxyapi npm run test:gateway-integration
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
