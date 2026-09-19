/**
 * mgmt-contract.ts — the CLIProxyAPI Management API surface this console depends on.
 *
 * Every shape below was read out of the CLIProxyAPI v7.3.0 Go source. The `verifiedAt`
 * field on each entry is the source file and line that proves the shape. Paths are
 * relative to the CLIProxyAPI checkout that was inspected:
 *   <scratchpad>/CLIProxyAPI
 *
 * Nothing here is inferred from documentation or from live traffic: at the time of
 * writing the proxy on this machine has no `remote-management.secret-key` configured,
 * so every /v0/management/* route answers 404 with an empty body
 * (internal/api/server_management.go:196-215, confirmed by curl).
 *
 * This module is intentionally data-only: it is the single place to update when the
 * proxy changes, and the server imports the endpoint paths from it so the docs and the
 * code cannot drift apart.
 */

export interface EndpointDoc {
  /** HTTP method. */
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path below `${proxyUrl}`. */
  readonly path: string;
  /** Query parameters honoured by the handler. */
  readonly query?: string;
  /** Request body shape, as TypeScript-ish pseudo-syntax. */
  readonly request?: string;
  /** Success response shape. */
  readonly response: string;
  /** Non-2xx responses worth handling. */
  readonly errors?: string;
  /** Source file:line that proves the above. */
  readonly verifiedAt: string;
  /** Anything the caller must know that the shape alone does not say. */
  readonly notes?: string;
}

/** Auth: every /v0/management/* route accepts `Authorization: Bearer <key>` or `X-Management-Key: <key>`. */
export const AUTH_HEADER_DOC =
  'internal/api/handlers/management/handler.go:276-288 — Authorization: Bearer <key>, ' +
  'or the raw header value if it is not a "Bearer " pair, or X-Management-Key.';

/**
 * When `remote-management.secret-key` is unset the whole group is *unregistered*, not
 * merely unauthorized: the router answers 404 with a zero-length body. A 401 means the
 * key is set but ours is wrong. The console treats both as "management disabled".
 */
export const DISABLED_STATE_DOC =
  'internal/api/server_management.go:196-215 (managementAvailable -> c.AbortWithStatus(404)); ' +
  'internal/api/handlers/management/handler.go:290-294 (bad key -> AbortWithStatusJSON(401|403, {error}))';

export const ENDPOINTS = {
  health: {
    method: 'GET',
    path: '/healthz',
    response: '{ status: "ok" }',
    verifiedAt: 'internal/api/server_routes.go:43-52',
    notes: 'Public, no auth, and carries no version header — X-CPA-VERSION is only set by the management middleware.',
  },

  listAuthFiles: {
    method: 'GET',
    path: '/v0/management/auth-files',
    query: 'name? (exact id or filename), auth_index?',
    response: `{
      observed_at: string /* RFC3339 */,
      files: Array<{
        id: string, auth_index: string, name: string,
        type: string, provider: string,   // same value, twice
        label: string,
        status: "unknown"|"active"|"pending"|"refreshing"|"error"|"disabled",
        status_message: string,
        disabled: boolean, unavailable: boolean, runtime_only: boolean,
        source: "file"|"memory", size: number,
        success: number, failed: number,
        recent_requests: unknown,
        quota: { observed_at?: string, signals: Record<string,string> },
        model_quotas?: Record<string, unknown>,
        cooldowns: unknown | null,
        supports_quota?: true, quota_provider?: string, quota_probe?: unknown,
        email?: string, project_id?: string,
        account_type?: string, account?: string,
        created_at?: string, modtime?: string, updated_at?: string,
        last_refresh?: string, next_retry_after?: string,
        path?: string, id_token?: unknown,
        priority?: number, note?: string, weight?: number,
        websockets?: boolean, request_retry?: number
      }>
    }`,
    verifiedAt: 'internal/api/handlers/management/auth_files.go:90-126 (envelope), :326-470 (buildAuthFileEntryLocked)',
    notes:
      'DEVIATION from the build spec: the entry does NOT contain `prefix`. The spec assumed the ' +
      'console could read a credential\'s model prefix back from this list; it cannot. `prefix` is ' +
      'written to the auth file and lifted onto auth.Prefix at load time ' +
      '(sdk/auth/filestore.go:295-296, internal/watcher/synthesizer/file.go:135-136, :170-178) but is ' +
      'never serialised into a management response. The only endpoint that would expose it, ' +
      'GET /auth-files/download (internal/api/handlers/management/auth_files_crud.go:26-48), returns ' +
      'the raw credential file including refresh tokens, so this console never calls it. The console ' +
      'therefore remembers the prefix it last wrote in its own profile store and labels it as such.',
  },

  authFileModels: {
    method: 'GET',
    path: '/v0/management/auth-files/models',
    query: 'name (required; matched against auth.FileName or auth.ID)',
    response: '{ models: Array<{ id: string, display_name?: string, type?: string, owned_by?: string }> }',
    errors: '400 { error: "name is required" }',
    verifiedAt: 'internal/api/handlers/management/auth_files.go:182-219',
    notes:
      'v7.3.0 returns live registry IDs, including prefixed IDs (service_models.go:applyModelPrefixes). ' +
      'Do not blindly prepend a cached prefix. The console checks exact registered IDs across all accounts ' +
      'before generating a manual setup. Unknown names can return an empty models list.',
  },

  patchAuthFileStatus: {
    method: 'PATCH',
    path: '/v0/management/auth-files/status',
    request: '{ name: string, auth_index?: string, disabled: boolean /* required, not optional */ }',
    response: '{ status: "ok", disabled: boolean }',
    errors:
      '400 {error:"name is required"|"disabled is required"|"invalid request body"}, ' +
      '404 {error:"auth file not found"}, 409 {error:"plugin virtual auth …"}, ' +
      '503 {error:"core auth manager unavailable"}',
    verifiedAt: 'internal/api/handlers/management/auth_files_fields.go:28-146',
    notes:
      'Config-backed API-key credentials answer with two extra fields, ' +
      '{via:"config:excluded-models", excluded_pattern:string} (auth_files_fields.go:119-125).',
  },

  patchAuthFileFields: {
    method: 'PATCH',
    path: '/v0/management/auth-files/fields',
    request:
      '{ name: string, [field: string]: JSONValue }  // dotted paths allowed, e.g. "headers.X-Foo"',
    response: '{ status: "ok" }',
    errors:
      '400 {error:"name is required"|"no fields to update"|"weight must be an integer"|…}, ' +
      '404 {error:"auth file not found"}, 409 plugin-virtual, 500 update/hook failure, 503 no auth manager',
    verifiedAt: 'internal/api/handlers/management/auth_files_fields.go:258-417',
    notes:
      'DEVIATION from the build spec: there is no whitelist of accepted keys. The body is decoded as ' +
      'map[string]json.RawMessage and every key other than `name` is written straight into the ' +
      'credential\'s metadata (auth_files_fields.go:264-272, :331-372). `normalizeAuthFilePatchFields` ' +
      '(:433-462) only canonicalises key aliases and rejects two keys that canonicalise to the same ' +
      'field — it accepts nothing and rejects nothing else. The keys that additionally get mirrored ' +
      'onto runtime state are prefix, proxy_url, headers, priority, weight, note, websockets, disabled, ' +
      'plan_type and id_token (syncAuthFileMetadataFields, :603-639); anything else is inert metadata. ' +
      'The console only ever sends prefix, priority, weight, note and disabled.\n' +
      'Second deviation: `weight` must be a JSON number or null — a string 400s (:345-352). `priority` ' +
      'accepts a number or a numeric string (syncAuthFilePriorityAttribute, :688-706).\n' +
      'Third deviation: on this path `prefix` is only TrimSpace\'d (:607-611), whereas the file loaders ' +
      'also strip "/" and reject any prefix containing "/" (sdk/auth/filestore.go:323-329). A prefix ' +
      'with a slash therefore works until the proxy restarts and then silently disappears, so the ' +
      'console rejects it up front.\n' +
      'Setting a field to JSON null deletes it for weight (:334-336) and request_retry (:379-383); for ' +
      'every other field null is stored as a null metadata value.',
  },

  deleteAuthFile: {
    method: 'DELETE',
    path: '/v0/management/auth-files',
    query: 'name (repeatable) or all=true|1|*',
    request: '{ name?: string, names?: string[] } | string[]  // only read when ?name= is absent',
    response:
      'single name: { status: "ok" } · many: { status: "ok", deleted: number, files: string[] } · ' +
      'partial (207): { status: "partial", deleted: number, files: string[], failed: Array<{name,error}> }',
    errors: '400 {error:"invalid name"}, 404 {error:"auth file not found"}, 503 no auth manager',
    verifiedAt: 'internal/api/handlers/management/auth_files_crud.go:132-210, :286-330',
  },

  apiKeys: {
    method: 'GET',
    path: '/v0/management/api-keys',
    response: '{ "api-keys": string[] | null }',
    verifiedAt:
      'internal/api/handlers/management/config_lists.go:146 (returns cfg.APIKeys verbatim); ' +
      'internal/config/sdk_config.go:55 (APIKeys []string `json:"api-keys"`)',
    notes: 'null when unset — the console normalises to []. These are the client keys for /v1/*.',
  },

  config: {
    method: 'GET',
    path: '/v0/management/config',
    response: 'the entire config object, including routing: { strategy?, "session-affinity"?, "session-affinity-ttl"?, "session-affinity-subagents"? }',
    verifiedAt:
      'internal/api/handlers/management/config_basic.go:26-31 (c.JSON(200, new(*h.cfg)) — the whole struct); ' +
      'internal/config/config_types.go:343-365 (RoutingConfig json tags); config.example.yaml:235-257 (strategy values)',
    notes:
      'SECURITY: this response also carries remote-management.secret-key, every provider API key and ' +
      'every access credential in the config. The console\'s server never forwards it to the browser: ' +
      '/api/mgmt/config is blocked and /api/routing returns only the routing block. ' +
      'strategy ∈ round-robin (default) | weighted-round-robin | fill-first.',
  },

  anthropicAuthUrl: {
    method: 'GET',
    path: '/v0/management/anthropic-auth-url',
    query: 'is_webui? ("1"|"true"|"yes"|"on" — anything else is false)',
    response: '{ status: "ok", url: string, state: string }',
    errors: '500 { error: "failed to generate authorization url" | "callback server unavailable" | … }',
    verifiedAt:
      'internal/api/handlers/management/auth_files_provider_oauth.go:36-194; ' +
      'is_webui parsing at internal/api/handlers/management/auth_files_oauth_callback.go:28-38',
    notes:
      'is_webui=1 makes the proxy stand up a local forwarder on port 54545 (anthropic) / 1455 (codex) ' +
      'that bounces the provider callback back into the Management API ' +
      '(auth_files_oauth_callback.go:17-20, :40-96). The console sends is_webui=1 so the browser round ' +
      'trip completes on its own, and still offers the manual paste fallback.',
  },
  codexAuthUrl: {
    method: 'GET',
    path: '/v0/management/codex-auth-url',
    query: 'is_webui?',
    response: '{ status: "ok", url: string, state: string }',
    verifiedAt: 'internal/api/handlers/management/auth_files_provider_oauth.go:197-342',
  },
  antigravityAuthUrl: {
    method: 'GET',
    path: '/v0/management/antigravity-auth-url',
    query: 'is_webui?',
    response: '{ status: "ok", url: string, state: string }',
    verifiedAt: 'internal/api/handlers/management/auth_files_provider_oauth.go:345-509',
  },
  xaiAuthUrl: {
    method: 'GET',
    path: '/v0/management/xai-auth-url',
    response: '{ status: "ok", url: string, state: string, flow: "device", …device fields }',
    verifiedAt: 'internal/api/handlers/management/auth_files_provider_oauth.go:512-622',
    notes: 'DEVIATION: xAI and Kimi are device flows and add `flow:"device"`; they ignore is_webui.',
  },
  kimiAuthUrl: {
    method: 'GET',
    path: '/v0/management/kimi-auth-url',
    response: '{ status: "ok", url: string, state: string, flow: "device", …device fields }',
    verifiedAt: 'internal/api/handlers/management/auth_files_provider_oauth.go:625-718',
  },

  authStatus: {
    method: 'GET',
    path: '/v0/management/get-auth-status',
    query: 'state (required in practice)',
    response: '{ status: "ok" } | { status: "wait" } | { status: "error", error: string }',
    errors: '400 { status: "error", error: "invalid state" } for a malformed state',
    verifiedAt: 'internal/api/handlers/management/auth_files_provider_oauth.go:758-832',
    notes:
      'Always HTTP 200 for a well-formed state — the outcome is in the body, not the status code. ' +
      'An empty state also answers {status:"ok"} (:759-762), so the console never polls without one. ' +
      'An expired or unknown state answers {status:"error", error:"unknown or expired state"} (:771).',
  },

  oauthCallback: {
    method: 'POST',
    path: '/v0/management/oauth-callback',
    request: '{ provider?: string, redirect_url?: string, code?: string, state?: string, error?: string }',
    response: '{ status: "ok" }',
    errors:
      '400 {status:"error",error:"state is required"|"invalid state"|"code or error is required"|' +
      '"invalid redirect_url"|"unsupported provider"|"provider does not match state"}, ' +
      '404 unknown/expired state, 409 already completed / not pending',
    verifiedAt: 'internal/api/handlers/management/oauth_callback.go:13-136',
    notes:
      'state and code may be embedded in redirect_url instead of passed separately (:56-73) — that is ' +
      'exactly the paste-the-callback-URL fallback. Provider aliases: anthropic|claude -> anthropic, ' +
      'codex|openai -> codex, antigravity|anti-gravity, xai|x-ai|x.ai|grok -> xai, devin|cognition; ' +
      'anything else matching /^[a-z0-9-]+$/ is treated as a plugin provider, which is how "kimi" ' +
      'resolves (oauth_sessions.go:363-402). Sending no provider reuses the one bound to the state ' +
      '(oauth_callback.go:96-99).',
  },

  cancelOAuthSession: {
    method: 'DELETE',
    path: '/v0/management/oauth-session',
    query: 'state (required)',
    response: '{ status: "ok", cancelled: boolean }',
    errors: '400 { status: "error", error: "missing state" | "invalid state" }',
    verifiedAt: 'internal/api/handlers/management/auth_files_provider_oauth.go:744-756',
  },

  logs: {
    method: 'GET',
    path: '/v0/management/logs',
    query: 'cursor?, after?',
    response: 'cursor-paged log lines',
    errors: '400 { error: "logging to file disabled" } when file logging is off',
    verifiedAt: 'internal/api/handlers/management/logs.go:38-70',
    notes: 'Reachable through /api/mgmt/* but no console screen uses it yet.',
  },
  requestErrorLogs: {
    method: 'GET',
    path: '/v0/management/request-error-logs',
    response: '{ files: Array<unknown> }  // {files:[]} when disabled or missing',
    verifiedAt: 'internal/api/handlers/management/logs.go:195-225',
  },
} as const satisfies Record<string, EndpointDoc>;

/** Client-visible model IDs, including prefixed registrations, for automatic setup. */
export const PROXY_MODELS_DOC =
  'GET ${proxyUrl}/v1/models with `Authorization: Bearer <client api key>` -> ' +
  '{ object: "list", data: Array<{ id, object, created?, owned_by? }> }. Includes registered prefixed IDs: ' +
  'sdk/cliproxy/service_models.go:applyModelPrefixes.';

/** Providers the console offers in the "Add account" picker, with their auth-url endpoint. */
export const OAUTH_PROVIDERS = [
  { id: 'anthropic', label: 'Claude', endpoint: '/v0/management/anthropic-auth-url', flow: 'redirect' },
  { id: 'codex', label: 'Codex', endpoint: '/v0/management/codex-auth-url', flow: 'redirect' },
  { id: 'antigravity', label: 'Antigravity', endpoint: '/v0/management/antigravity-auth-url', flow: 'redirect' },
  { id: 'kimi', label: 'Kimi', endpoint: '/v0/management/kimi-auth-url', flow: 'device' },
  { id: 'xai', label: 'xAI', endpoint: '/v0/management/xai-auth-url', flow: 'device' },
] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]['id'];

/** Routing UI contract verified against the v7.3.0 tag:
 * internal/api/server_management.go registers PUT routing/strategy, force-model-prefix,
 * request-retry, max-retry-interval, quota-exceeded/switch-project and switch-preview-model.
 * config_basic.go setters take {value: string|boolean|integer}; each persists its field.
 * Multi-field saves are sequential, not atomic, and failures report fields already applied.
 * No dedicated session-affinity setter exists in this version.
 */

/** Subscription usage reads: CPAMC src/utils/quota/constants.ts identifies Codex
 * GET https://chatgpt.com/backend-api/wham/usage and Claude
 * GET https://api.anthropic.com/api/oauth/usage (anthropic-beta: oauth-2025-04-20).
 * The proxy's api_tools.go accepts POST api-call with auth_index, method, url,
 * header and replaces $TOKEN$ itself; its response wraps status_code and body.
 * Other supported providers: POST quota/fetch {auth_index}, returning subscription
 * and groups[].buckets[] {window, remainingFraction, resetTime} (sdk/pluginapi/types.go).
 * Never call reset-quota, quota/reset or reset-credit consumption for usage refresh.
 */
