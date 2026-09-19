# Security

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/piyush-gambhir/cliproxy-console/security/advisories/new)
when it is enabled in the repository's Security tab. If it is unavailable, open an
issue requesting a private contact method, without including vulnerability details.
Do not post credentials, full configuration files, OAuth JSON, or private account
information in public issues. Include a minimal reproduction using fake credentials
and the affected commit. The current `main` branch is the maintained version;
there is no guaranteed response or support timeline.

## Deployment boundary

This is a local, single-user administration tool. It binds to `127.0.0.1` and has
no console login. Other software running as the same local user can access its
management features. Host/Origin validation reduces cross-site and DNS-rebinding
exposure; it is not a substitute for authentication on an internet-facing service.
Do not publish the running console through a tunnel, reverse proxy, or shared host.

The console accepts management/client keys from environment variables or its local
`~/.cliproxy-console/settings.sqlite` database. SQLite and migration backups use
owner-only permissions, but are not encrypted. Environment overrides are not
persisted by saves. Settings never returns either key, and the management key
stays server-side. Some
Advanced connections previews intentionally expose proxy client keys to configure
clients. Treat those previews as sensitive. Provider credentials stay in the
proxy's auth store. Backups of local configuration may contain secrets.

The console blocks raw proxy configuration and credential-download endpoints.
The native gateway pins inference to a specific enabled Claude credential in the proxy, independently of the console. Native route management and receipt reads require the management key; inference requires a proxy client key. The compatibility relay on unmodified upstream validates unique prefixes and rejects automatic retry/fallback settings.

The request-history database and bounded proxy receipt journal store model, account-route, session/agent IDs, token counts and error types. They do not store prompts, responses or keys. These metadata are still private and should not be committed or shared. Console retention does not control separate proxy request logs.

This project does not establish provider eligibility or override provider rules,
quotas, billing, or organization policy. Public source code does not make a local
installation, its configuration, or its accounts public.
