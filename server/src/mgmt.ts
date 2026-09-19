import type { SettingsStore } from './settings.ts';

export interface MgmtResponse {
  status: number;
  /** Raw body, passed through verbatim. */
  body: Buffer;
  contentType: string;
  /** X-CPA-VERSION, set by the management middleware on every management response. */
  proxyVersion: string | null;
}

/** Management routes the browser may never reach through /api/mgmt/*. */
const BLOCKED = [
  // Returns the entire config including remote-management.secret-key and every provider key.
  // config_basic.go:26-31. The console exposes only the routing block, via /api/routing.
  /^config$/,
  /^config\.yaml$/,
  // Returns the raw credential file, refresh tokens and all. auth_files_crud.go:26-48.
  /^auth-files\/download$/,
];

export class MgmtDisabledError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(
      status === 404
        ? 'Management API disabled — set remote-management.secret-key in your CLIProxyAPI configuration and restart the proxy'
        : 'Management API rejected the key — check the management key in Settings',
    );
    this.status = status;
  }
}

export class MgmtClient {
  readonly #settings: SettingsStore;
  #lastVersion: string | null = null;

  constructor(settings: SettingsStore) {
    this.#settings = settings;
  }

  get lastProxyVersion(): string | null {
    return this.#lastVersion;
  }

  static isBlocked(subPath: string): boolean {
    const clean = subPath.replace(/^\/+/, '').split('?')[0] ?? '';
    return BLOCKED.some((re) => re.test(clean));
  }

  /** Forward a request to `${proxyUrl}/v0/management/<subPath>` with the bearer header added. */
  async forward(
    method: string,
    subPath: string,
    search: string,
    body: Buffer | null,
    contentType: string | null,
  ): Promise<MgmtResponse> {
    const { proxyUrl, managementKey } = await this.#settings.load();
    const clean = subPath.replace(/^\/+/, '');
    const url = `${proxyUrl}/v0/management/${clean}${search}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (managementKey) headers['Authorization'] = `Bearer ${managementKey}`;
    if (contentType) headers['Content-Type'] = contentType;

    const init: RequestInit = { method, headers };
    if (body && body.length > 0 && method !== 'GET' && method !== 'HEAD') {
      init.body = new Uint8Array(body);
    }
    const res = await fetch(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    const version = res.headers.get('x-cpa-version');
    if (version) this.#lastVersion = version;
    return {
      status: res.status,
      body: buf,
      contentType: res.headers.get('content-type') ?? 'application/json',
      proxyVersion: version,
    };
  }

  /** Forward and parse, turning 404/401/403 into MgmtDisabledError. For internal callers. */
  async json<T>(method: string, subPath: string, search = '', payload?: unknown): Promise<T> {
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const res = await this.forward(method, subPath, search, body, payload === undefined ? null : 'application/json');
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      throw new MgmtDisabledError(res.status);
    }
    const text = res.body.toString('utf8');
    if (res.status >= 400) {
      let message = text || `proxy returned ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        /* keep the raw text */
      }
      const err = new Error(message) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (text === '' ? {} : JSON.parse(text)) as T;
  }

  /** GET ${proxyUrl}/healthz — public, no key needed. */
  async health(): Promise<{ ok: boolean; error?: string }> {
    const { proxyUrl } = await this.#settings.load();
    try {
      const res = await fetch(`${proxyUrl}/healthz`, {
        signal: AbortSignal.timeout(4000),
      });
      const text = await res.text();
      return { ok: res.ok && text.includes('"ok"') };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Prefer the configured client key; otherwise discover one from the proxy. */
  async proxyModels(): Promise<{ data: Array<{ id: string }> }> {
    const { proxyUrl, clientApiKey } = await this.#settings.load();
    const first = clientApiKey || (await this.json<{ 'api-keys': string[] | null }>('GET', 'api-keys'))['api-keys']?.[0];
    if (!first) {
      const err = new Error('the proxy has no client API keys configured') as Error & { status?: number };
      err.status = 409;
      throw err;
    }
    const res = await fetch(`${proxyUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${first}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      const err = new Error(`GET /v1/models returned ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as { data: Array<{ id: string }> };
  }
}
