import type {
  SubscriptionUsage,
  AccountStatus,
  AuthFile,
  AuthFileList,
  Health,
  ModelEntry,
  Profile,
  Routing,
  Settings,
  Targets,
  WirePlan,
} from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  /** 'management_disabled' when the proxy has no secret-key, 'management_unauthorized' for a bad key. */
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  get isManagementDisabled(): boolean {
    return this.code === 'management_disabled' || this.code === 'management_unauthorized';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers,
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!res.ok) {
    const payload = (parsed ?? {}) as { error?: string; code?: string };
    throw new ApiError(payload.error ?? text ?? `request failed (${res.status})`, res.status, payload.code);
  }
  return parsed as T;
}

const body = (value: unknown) => JSON.stringify(value);

export const api = {
  requestHistory: (profile='') => request<import('./types').RequestHistory>(`/api/requests?profile=${encodeURIComponent(profile)}`),
  syncGateway: () => request<import('./types').GatewayStatus>('/api/gateway/sync', {method:'POST'}),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (patch: { displayName?: string; proxyUrl?: string; managementKey?: string; clientApiKey?: string; routingMode?: 'manual'; claudeModels?: import('./types').ClaudeModelOption[]; claudeBackgroundModel?:string; claudeSubagentModel?:string; receiptRetentionDays?:number; cliProfile?:string; cliEffort?: string; claudeConfigDir?: string; desktopConfigDir?: string; consoleUrl?: string }) =>
    request<Settings>('/api/settings', { method: 'PUT', body: body(patch) }),

  health: () => request<Health>('/api/health'),
  routing: () => request<Routing>('/api/routing'),
  saveRouting: (patch: Record<string, unknown>) => request<Routing>('/api/routing', {method: 'PUT', body: body(patch)}),
  savePrefix: (id: string, prefix: string) => request<Profile>(`/api/profiles/${encodeURIComponent(id)}/prefix`, {method: 'PUT', body: body({prefix})}),

  authFiles: () => request<AuthFileList>('/api/mgmt/auth-files'),
  authFileModels: (name: string) =>
    request<{ models: ModelEntry[] }>(`/api/mgmt/auth-files/models?name=${encodeURIComponent(name)}`),
  setAuthFileDisabled: (name: string, disabled: boolean) =>
    request<{ status: string; disabled: boolean }>('/api/mgmt/auth-files/status', {
      method: 'PATCH',
      body: body({ name, disabled }),
    }),
  patchAuthFileFields: (name: string, fields: Record<string, unknown>) =>
    request<{ status: string }>('/api/mgmt/auth-files/fields', {
      method: 'PATCH',
      body: body({ name, ...fields }),
    }),
  deleteAuthFile: (name: string) =>
    request<{ status: string }>(`/api/mgmt/auth-files?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),

  apiKeys: () => request<{ 'api-keys': string[] | null }>('/api/mgmt/api-keys'),
  proxyModels: () => request<{ data: Array<{ id: string }> }>('/api/proxy/models'),

  authUrl: (endpoint: string) =>
    request<{ status: string; url: string; state: string; flow?: string }>(
      `/api/mgmt/${endpoint.replace('/v0/management/', '')}?is_webui=1`,
    ),
  authStatus: (state: string) =>
    request<{ status: 'ok' | 'wait' | 'error'; error?: string }>(
      `/api/mgmt/get-auth-status?state=${encodeURIComponent(state)}`,
    ),
  cancelAuthSession: (state: string) =>
    request<{ status: string; cancelled: boolean }>(
      `/api/mgmt/oauth-session?state=${encodeURIComponent(state)}`,
      { method: 'DELETE' },
    ),
  postOAuthCallback: (payload: { provider?: string; redirect_url?: string; state?: string; code?: string }) =>
    request<{ status: string }>('/api/mgmt/oauth-callback', { method: 'POST', body: body(payload) }),

  subscriptionUsage: (id: string, refresh = false) => request<{usage: SubscriptionUsage | null}>(`/api/profiles/${encodeURIComponent(id)}/usage`, {method: refresh ? 'POST' : 'GET'}),
  profiles: () => request<{ profiles: Profile[] }>('/api/profiles'),
  createProfile: (input: { name: string; authFile: string; color?: string; prefix?: string }) =>
    request<Profile>('/api/profiles', { method: 'POST', body: body(input) }),
  updateProfile: (id: string, patch: Record<string, unknown>) =>
    request<Profile>(`/api/profiles/${encodeURIComponent(id)}`, { method: 'PUT', body: body(patch) }),
  deleteProfile: (id: string) =>
    request<Profile>(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  targets: () => request<Targets>('/api/targets'),
  checkTarget: (path: string) =>
    request<{ path: string; display: string; exists: boolean }>(
      `/api/targets/check?path=${encodeURIComponent(path)}`,
    ),

  wirePreview: (payload: Record<string, unknown>) =>
    request<WirePlan>('/api/wire/preview', { method: 'POST', body: body(payload) }),
  wire: (payload: Record<string, unknown>) =>
    request<WirePlan>('/api/wire', { method: 'POST', body: body(payload) }),
  snippet: (params: Record<string, string>) =>
    request<{ snippet: string }>(`/api/wire/snippet?${new URLSearchParams(params).toString()}`),
};

/**
 * Derive one status chip from the auth-file entry. Status strings come from
 * sdk/cliproxy/auth/status.go:8-18; next_retry_after and status_message come from
 * buildAuthFileEntryLocked (auth_files.go:409-415, :346-348).
 */
export function accountStatus(file: AuthFile, now = Date.now()): AccountStatus {
  if (file.disabled || file.status === 'disabled') {
    return { state: 'disabled', label: 'disabled', tone: 'off', detail: file.status_message };
  }
  const retry = file.next_retry_after ? Date.parse(file.next_retry_after) : NaN;
  if (!Number.isNaN(retry) && retry > now) {
    const secs = Math.round((retry - now) / 1000);
    const human = secs >= 60 ? `${Math.round(secs / 60)}m` : `${secs}s`;
    return { state: 'cooling', label: `cooling ${human}`, tone: 'warn', detail: file.status_message };
  }
  const message = (file.status_message ?? '').toLowerCase();
  if (message.includes('token expired') || message.includes('invalid_grant')) {
    return { state: 'expired', label: 'token expired', tone: 'err', detail: file.status_message };
  }
  if (file.status === 'error' || file.unavailable) {
    return { state: 'error', label: 'error', tone: 'err', detail: file.status_message || 'unavailable' };
  }
  if (file.status === 'refreshing') return { state: 'unknown', label: 'refreshing', tone: 'plain' };
  if (file.status === 'pending') return { state: 'unknown', label: 'pending', tone: 'plain' };
  if (file.status === 'active') return { state: 'healthy', label: 'healthy', tone: 'ok' };
  return { state: 'unknown', label: file.status || 'unknown', tone: 'plain' };
}

/** `<prefix>/<model>` — the addressable id a client sends (conductor_models.go:692-705). */
export function addressable(model: string, prefix?: string): string {
  const p = (prefix ?? '').trim();
  return p === '' ? model : `${p}/${model}`;
}
