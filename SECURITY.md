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

The console stores its proxy management key under `~/.cliproxy-console/` with
restricted file permissions and does not return that key to the browser. Some
Advanced connections previews intentionally expose proxy client keys to configure
clients. Treat those previews as sensitive. Provider credentials stay in the
proxy's auth store. Backups of local configuration may contain secrets.

The console blocks raw proxy configuration and credential-download endpoints.
Subscription-scoped inference validates a unique account route and rejects
automatic retry/fallback settings. Changes to upstream account prefixes outside
this console can affect future routing and should be revalidated.

This project does not establish provider eligibility or override provider rules,
quotas, billing, or organization policy. Public source code does not make a local
installation, its configuration, or its accounts public.
