# Security

This repository is a frontend. CLIProxyAPI is the security and persistence boundary.

- Every administration request uses CLIProxyAPI management authentication.
- Local client-file operations additionally require an actual loopback peer and a
  localhost Host/Origin. Forwarded IP headers do not grant local file access.
- The management key is kept in browser tab session storage and sent only to the
  same-origin Management API. Lock the console to clear it. Do not use untrusted
  extensions or scripts in this administrative browser context.
- Provider OAuth tokens remain in the proxy auth store. Public settings never return
  keys. Explicit client setup previews and the API-key management endpoint can show
  client keys to the authenticated administrator.
- The proxy owns private SQLite storage, credential files, atomic writes, backups,
  path restrictions, request metadata retention, and routing enforcement.
- Request history excludes prompts and response text. Token counts do not establish
  subscription quota or billing eligibility.

No secrets or runtime data should be committed to this frontend repository. Report
vulnerabilities privately to the repository owner; do not include credentials or
conversation content in public issues. Backend reports belong to the maintained
CLIProxyAPI fork.
