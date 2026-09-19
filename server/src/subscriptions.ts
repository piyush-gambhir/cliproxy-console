import type { MgmtClient } from './mgmt.ts';
import { WireError } from './wire.ts';

export interface UsageWindow { label: string; remainingPercent: number | null; resetsAt: string | null; active?: boolean; severity?: string }
export interface SubscriptionUsage {
  checkedAt: string; plan: string | null; windows: UsageWindow[];
  planTier?: string | null;
  subscriptionStatus?: string | null;
  planCheckUnavailable?: boolean;
  extraUsageEnabled?: boolean | null;
  usageBreakdown?: Array<{label: string; percent: number}>;
  breakdownCheckedAt?: string | null;
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
function date(v: unknown): string | null {
  const time = typeof v === 'number' ? v * 1000 : typeof v === 'string' && v.trim() ? Date.parse(v) : NaN;
  return Number.isFinite(time) && time > 0 && Number.isFinite(new Date(time).getTime()) ? new Date(time).toISOString() : null;
}
function remaining(used: unknown) { const n = number(used); return n === null ? null : Math.max(0, Math.min(100, 100 - n)); }
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.slice(0, 160) : null;

export function normalizeUsage(provider: string, data: unknown, now = new Date()): SubscriptionUsage {
  const raw = record(data);
  const result: SubscriptionUsage = {checkedAt: now.toISOString(), plan: text(raw.plan_type), windows: []};
  if (provider === 'codex') {
    const limits = record(raw.rate_limit);
    for (const [key, fallback] of [['primary_window', 'Primary limit'], ['secondary_window', 'Secondary limit']]) {
      const window = record(limits[key!]);
      if (Object.keys(window).length === 0) continue;
      const seconds = number(window.limit_window_seconds);
      const label = seconds === 18000 ? '5-hour limit' : seconds === 604800 ? 'Weekly limit' : seconds ? `${seconds / 3600}-hour limit` : fallback!;
      result.windows.push({label, remainingPercent: remaining(window.used_percent), resetsAt: date(window.reset_at)});
    }
  } else if (provider === 'claude' || provider === 'anthropic') {
    // Claude's current limits array includes model-specific windows that no longer
    // appear in legacy fields (e.g. weekly_scoped Fable). Do not filter is_active:
    // it identifies the current limiting window, not whether a limit exists.
    const limits = Array.isArray(raw.limits) ? raw.limits.map(record) : [];
    for (const limit of limits) {
      if (!text(limit.kind) || (number(limit.percent) === null && !date(limit.resets_at))) continue;
      const scope = record(limit.scope);
      const model = record(scope.model);
      const surface = record(scope.surface);
      const group = limit.kind === 'session' ? '5-hour limit' : limit.group === 'weekly' ? 'Weekly limit' : text(limit.kind)!.replaceAll('_', ' ');
      const label = [group, text(model.display_name) ?? text(model.id), text(surface.display_name) ?? text(surface.id) ?? text(scope.surface)].filter(Boolean).join(' · ');
      result.windows.push({label, remainingPercent: remaining(limit.percent), resetsAt: date(limit.resets_at), active: limit.is_active === true, severity: text(limit.severity) ?? undefined});
    }
    // Legacy fallback only for actual quota objects, never seven_day_breakdown.
    if (result.windows.length === 0) {
      for (const [key, value] of Object.entries(raw)) {
        if (!key.startsWith('five_hour') && !key.startsWith('seven_day') && key !== 'iguana_necktie') continue;
        const w = record(value);
        if (!Object.hasOwn(w, 'utilization') && !Object.hasOwn(w, 'resets_at')) continue;
        const label = key === 'iguana_necktie' ? 'Weekly · Fable' : key.replace('five_hour', '5-hour').replace('seven_day', 'Weekly').replaceAll('_', ' ');
        result.windows.push({label, remainingPercent: remaining(w.utilization), resetsAt: date(w.resets_at)});
      }
    }
    const extra = record(raw.extra_usage);
    const spend = record(raw.spend);
    result.extraUsageEnabled = typeof spend.enabled === 'boolean' ? spend.enabled : typeof extra.is_enabled === 'boolean' ? extra.is_enabled : null;
    const breakdown = record(raw.seven_day_breakdown);
    result.breakdownCheckedAt = date(breakdown.as_of);
    result.usageBreakdown = (Array.isArray(breakdown.rows) ? breakdown.rows : []).map(record)
      .filter(row => text(row.display_name) && number(row.percent) !== null)
      .map(row => ({label: text(row.display_name)!, percent: number(row.percent)!}));
  } else {
    const subscription = record(raw.subscription);
    result.plan = text(subscription.plan) ?? text(subscription.tierName);
    for (const value of Array.isArray(raw.groups) ? raw.groups : []) {
      const group = record(value);
      for (const item of Array.isArray(group.buckets) ? group.buckets : []) {
        const w = record(item);
        const fraction = number(w.remainingFraction);
        result.windows.push({label: [text(group.displayName), text(w.window)].filter(Boolean).join(' · ') || 'Usage limit', remainingPercent: fraction === null ? null : Math.max(0, Math.min(100, fraction * 100)), resetsAt: date(w.resetTime)});
      }
    }
  }
  return result;
}

/** Read-only provider usage calls, following CPAMC's quota constants.
 * Credentials are substituted by CLIProxyAPI using $TOKEN$ and never returned here.
 * No inference, reset-credit consumption, or provider quota-reset calls.
 */
export async function fetchSubscriptionUsage(mgmt: MgmtClient, authFile: string): Promise<SubscriptionUsage> {
  const {files} = await mgmt.json<{files: Array<{name: string; provider: string; auth_index?: string; supports_quota?: boolean; id_token?: {chatgpt_account_id?: string}}>}>('GET', 'auth-files');
  const file = files.find(f => f.name === authFile);
  if (!file?.auth_index) throw new WireError('Subscription account is missing on the proxy', 409);
  if (file.provider === 'codex' || file.provider === 'claude' || file.provider === 'anthropic') {
    const header: Record<string, string> = {Authorization: 'Bearer $TOKEN$', 'Content-Type': 'application/json'};
    if (file.provider === 'codex') {
      header['User-Agent'] = 'codex-tui/0.149.1';
      if (file.id_token?.chatgpt_account_id) header['Chatgpt-Account-Id'] = file.id_token.chatgpt_account_id;
    } else header['anthropic-beta'] = 'oauth-2025-04-20';
    const response = await mgmt.json<{status_code: number; body: string}>('POST', 'api-call', '', {
      auth_index: file.auth_index, method: 'GET', header,
      url: file.provider === 'codex' ? 'https://chatgpt.com/backend-api/wham/usage' : 'https://api.anthropic.com/api/oauth/usage',
    });
    if (response.status_code < 200 || response.status_code >= 300) throw new WireError(`Provider usage check returned ${response.status_code}. Your saved usage is unchanged.`, 502);
    let usage: SubscriptionUsage;
    try { usage = normalizeUsage(file.provider, JSON.parse(response.body)); }
    catch { throw new WireError('Provider returned an unreadable usage response', 502); }
    if (file.provider !== 'codex') {
      try {
        const profileResponse = await mgmt.json<{status_code: number; body: string}>('POST', 'api-call', '', {
          auth_index: file.auth_index, method: 'GET', header, url: 'https://api.anthropic.com/api/oauth/profile',
        });
        if (profileResponse.status_code !== 200) throw new Error('Plan unavailable');
        applyClaudePlan(usage, JSON.parse(profileResponse.body));
      } catch { usage.planCheckUnavailable = true; }
    }
    return usage;
  }
  if (!file.supports_quota) throw new WireError('Live usage is unavailable for this provider. You can record its reset date in Edit subscription.', 422);
  return normalizeUsage('plugin', await mgmt.json('POST', 'quota/fetch', '', {auth_index: file.auth_index}));
}

/** Keep personal details and IDs from the profile response out of the usage cache. */
export function applyClaudePlan(usage: SubscriptionUsage, profile: unknown): void {
  const raw = record(profile);
  const account = record(raw.account);
  const org = record(raw.organization);
  usage.plan = account.has_claude_max === true ? 'Claude Max' : account.has_claude_pro === true ? 'Claude Pro' : text(org.organization_type);
  const tier = text(org.rate_limit_tier);
  usage.planTier = tier === 'default_claude_max_20x' ? '20×' : tier === 'default_claude_max_5x' ? '5×' : tier;
  if (usage.plan === 'Claude Max' && (usage.planTier === '20×' || usage.planTier === '5×')) usage.plan += ` (${usage.planTier})`;
  usage.subscriptionStatus = text(org.subscription_status);
}
