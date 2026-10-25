# Contributing

Use Node.js 26.12.1 and `npm ci`. Development runs with `npm run dev` on
127.0.0.1:8321. The native management API defaults to 127.0.0.1:8317; set
`CLIPROXY_DEV_API` to use a disposable local proxy instead.

Before submitting a change, run:

```sh
npm run typecheck
npm test
npm run build
```

For API changes, use disposable local management API fixtures or a tested local
CLIProxyAPI instance with fake accounts. Never consume a real account's quota in CI.

Preserve explicit account selection, rejection of ambiguous routes, and the absence
of automatic account fallback. Keep provider credentials out of responses and logs.
The console management key remains in browser tab session storage, as described
in `SECURITY.md`; it and client-key previews must not appear in diagnostics or
screenshots. Read `SECURITY.md` before changing
local request validation, filesystem writes, or management endpoint forwarding.

Use the shadcn/ui layer for UI controls. Keep the borderless, shadow-free visual
style. Public defaults should be generic; customization belongs in local settings.
Document platform-specific behavior and avoid claiming provider capabilities based
only on model names or display labels.

Open pull requests against `main`. Explain the user-visible behavior, relevant
tradeoffs, and validation. Never commit runtime state, OAuth files, client or
management keys, chat history, local backups, or real-account fixtures.

The npm workspaces deliberately use `private: true` to prevent accidental npm
publication. This is independent of this source repository's public visibility.
