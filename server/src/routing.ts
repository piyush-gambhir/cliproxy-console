import type { MgmtClient } from './mgmt.ts';
import type { ProfileStore } from './profiles.ts';
import { WireError, assertValidPrefix } from './wire.ts';

// CLIProxyAPI v7.3.0: server_management.go and config_basic.go.
// Dedicated setters accept {value}; full configuration never leaves the server.
export const ROUTING_FIELDS = {
  strategy: 'routing/strategy',
  forceModelPrefix: 'force-model-prefix',
  requestRetry: 'request-retry',
  maxRetryInterval: 'max-retry-interval',
  switchProject: 'quota-exceeded/switch-project',
  switchPreviewModel: 'quota-exceeded/switch-preview-model',
} as const;

export async function readRouting(mgmt: MgmtClient) {
  const cfg = await mgmt.json<{
    routing?: {strategy?: string; 'session-affinity'?: boolean; 'session-affinity-ttl'?: string; 'session-affinity-subagents'?: boolean};
    'force-model-prefix'?: boolean; 'request-retry'?: number; 'max-retry-interval'?: number;
    'quota-exceeded'?: {'switch-project'?: boolean; 'switch-preview-model'?: boolean};
  }>('GET', 'config');
  const routing = cfg.routing ?? {};
  return {
    strategy: routing.strategy ?? 'round-robin',
    sessionAffinity: routing['session-affinity'] === true,
    sessionAffinityTtl: routing['session-affinity-ttl'] ?? '1h',
    sessionAffinitySubagents: routing['session-affinity-subagents'] !== false,
    forceModelPrefix: cfg['force-model-prefix'] === true,
    requestRetry: cfg['request-retry'] ?? 3,
    maxRetryInterval: cfg['max-retry-interval'] ?? 30,
    switchProject: cfg['quota-exceeded']?.['switch-project'] === true,
    switchPreviewModel: cfg['quota-exceeded']?.['switch-preview-model'] === true,
  };
}

export async function updateRouting(mgmt: MgmtClient, patch: Record<string, unknown>) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new WireError('Routing settings must be an object');
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(ROUTING_FIELDS, key)) throw new WireError(`Unknown routing setting: ${key}`);
    if (key === 'strategy') {
      if (!['fill-first', 'round-robin', 'weighted-round-robin'].includes(String(value))) throw new WireError('Invalid routing strategy');
    } else if (key === 'requestRetry' || key === 'maxRetryInterval') {
      if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 3600) throw new WireError(`${key} must be an integer from 0 to 3600`);
    } else if (typeof value !== 'boolean') throw new WireError(`${key} must be a boolean`);
  }
  const applied: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    try {
      await mgmt.json('PUT', ROUTING_FIELDS[key as keyof typeof ROUTING_FIELDS], '', { value });
      applied.push(key);
    } catch {
      throw new WireError(`Could not save ${key}. Already saved: ${applied.join(', ') || 'none'}. Reload routing settings before retrying.`, 502);
    }
  }
  return readRouting(mgmt);
}

interface Account { name: string; disabled: boolean; status: string }
export async function accountModels(mgmt: MgmtClient, name: string): Promise<string[]> {
  const result = await mgmt.json<{ models: { id: string }[] }>('GET', 'auth-files/models', `?name=${encodeURIComponent(name)}`);
  return result.models.map(m => m.id);
}

export async function setProfilePrefix(mgmt: MgmtClient, profiles: ProfileStore, id: string, prefix: unknown) {
  if (typeof prefix !== 'string') throw new WireError('prefix must be a string');
  prefix = prefix.trim();
  assertValidPrefix(prefix as string);
  const profile = await profiles.get(id);
  const saved = await profiles.list();
  if (prefix && saved.some(p => p.id !== id && p.lastKnownPrefix === prefix)) throw new WireError('Another profile already uses this prefix', 409);
  const { files } = await mgmt.json<{ files: Account[] }>('GET', 'auth-files');
  if (!files.some(f => f.name === profile.authFile)) throw new WireError('Account is missing on the proxy', 409);
  if (prefix) {
    for (const file of files.filter(f => f.name !== profile.authFile)) {
      if ((await accountModels(mgmt, file.name)).some(m => m.startsWith(`${prefix}/`))) {
        throw new WireError('Another account already serves this prefix. Choose a unique prefix.', 409);
      }
    }
  }
  await mgmt.json('PATCH', 'auth-files/fields', '', { name: profile.authFile, prefix });
  return profiles.update(id, { lastKnownPrefix: prefix });
}

/** Verify against live per-account model registrations, including unassigned accounts.
 * service_models.go:applyModelPrefixes; conductor_selection.go:authSupportsModel.
 * A cached prefix alone does not establish account isolation.
 */
export async function resolveSelection(mgmt: MgmtClient, profiles: ProfileStore, body: Record<string, unknown>) {
  if (body.routingMode !== undefined && body.routingMode !== 'manual') throw new WireError('Choose a subscription; automatic account selection is disabled');
  if (typeof body.profile !== 'string' || !body.profile) throw new WireError('Choose an account first');
  const profile = await profiles.get(body.profile);
  const prefix = profile.lastKnownPrefix;
  if (!prefix) throw new WireError('Set a unique account prefix in Edit profile before using this account', 409);
  assertValidPrefix(prefix);
  if (typeof body.model !== 'string' || !body.model.trim()) throw new WireError('model is required');
  const model = body.model.trim().startsWith(`${prefix}/`) ? body.model.trim() : `${prefix}/${body.model.trim()}`;
  const { files } = await mgmt.json<{ files: Account[] }>('GET', 'auth-files');
  const selected = files.find(f => f.name === profile.authFile);
  if (!selected || selected.disabled || selected.status === 'disabled') throw new WireError('Selected account is missing or disabled', 409);
  const registrations = await Promise.all(files.map(async file => ({ file, models: await accountModels(mgmt, file.name) })));
  if (!registrations.find(r => r.file.name === profile.authFile)?.models.includes(model)) {
    throw new WireError('This account does not currently serve that prefixed model. Save its prefix or choose another model.', 409);
  }
  if (registrations.some(r => r.file.name !== profile.authFile && r.models.includes(model))) {
    throw new WireError('This model route is shared by another account. Choose a unique account prefix.', 409);
  }
  return { model, prefix: '' };
}
