# Optional macOS proxy service helper

You can run the console with any compatible local CLIProxyAPI installation. This
helper is optional and requires macOS, Python 3.9+, Homebrew, and a currently
running proxy service. It does not install Homebrew or sign in to providers.

The helper changes a proxy LaunchAgent. It first saves the configuration and
service definition, then checks proxy health, account inventory, routing settings,
and the selected Desktop account. An activation failure restores the prior service.
Concurrent deployments are locked. Existing release names cannot be overwritten.

## Configuration

Local options live in `~/.cliproxy-console/proxy-service/service-settings.json`.
Start with [the example](../examples/service-settings.example.json), then adjust it
to your installation. Do not commit the local copy.

| JSON field | Environment override | Default |
| --- | --- | --- |
| `label` | `CLIPROXY_SERVICE_LABEL` | `local.cliproxyapi` |
| `brewLabel` | `CLIPROXY_BREW_LABEL` | `homebrew.mxcl.cliproxyapi` |
| `brewBinary` | `CLIPROXY_BREW` | `brew` discovered on PATH; Apple Silicon Homebrew fallback |
| `brewPrefix` | `CLIPROXY_BREW_PREFIX` | Parent of the Homebrew bin directory |
| `config` | `CLIPROXY_CONFIG` | `<brewPrefix>/etc/cliproxyapi.conf` |
| `repository` | `CLIPROXY_RELEASE_REPOSITORY` | `https://github.com/router-for-me/CLIProxyAPI` |
| `consoleUrl` | `CLIPROXY_CONSOLE_URL` | `http://127.0.0.1:8320` |

`CLIPROXY_SERVICE_DIR` overrides the service directory, including the location of
that JSON file. The console URL must be local. Environment overrides apply to the
current invocation; store persistent choices in the JSON file.

Homebrew service labels vary by installation. Inspect your existing LaunchAgent
and set `brewLabel` to its actual label. For an already-managed installation,
retain its existing label, directory, and configuration path. Do not rename a live
service by changing this setting: migrate it separately to avoid duplicate agents.
The helper refuses to deploy unless exactly one known proxy service is loaded.

## Release format

Build and test committed proxy source separately. Provide a release directory with
an executable named `cliproxyapi` and `manifest.json` in this shape:

```json
{
  "version": "local-2026.09.20.1",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "repository": "https://github.com/router-for-me/CLIProxyAPI"
}
```

Use the actual repository and full 40-character commit. The binary's reported
version and commit must match the manifest; set `main.Version`, `main.Commit`,
and `main.BuildDate` when building CLIProxyAPI. The manifest's repository must
match your configured repository. This identity check is not signature verification;
only install binaries you built or independently trust.

From the console checkout:

```sh
CLIPROXY_BIN=/absolute/path/to/release/cliproxyapi npm run test:routing-integration
python3 scripts/proxy-service.py install --release-dir /absolute/path/to/release
python3 scripts/proxy-service.py status
python3 scripts/proxy-service.py rollback
```

Releases, a `current` symlink, configuration backups, and `state.json` live in the
service directory. The first migration preserves a copy of the current Homebrew
binary. Homebrew's service is stopped, and the dedicated LaunchAgent runs the
selected release with the explicit configuration path. Later Homebrew upgrades
do not replace that managed binary. Rollback activates the previously recorded
release; older artifacts remain on disk.

The optional `scripts/cliproxyapi` launcher reads the same service settings and
executes the current release. To use it in your shell, install it in a directory
on PATH after checking that it will not overwrite an existing command. It does
not modify your shell startup files.

The console must be running with a working management key, and a local Claude
Desktop Gateway configuration must exist for the installer’s Desktop-state check.
The helper never uploads configuration backups or credentials to GitHub.
