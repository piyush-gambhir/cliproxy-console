import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUsage, fetchSubscriptionUsage, applyClaudePlan} from '../src/subscriptions.ts';
import {ProfileStore} from '../src/profiles.ts';
import {MgmtClient} from '../src/mgmt.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Codex windows preserve independent resets and zero remaining', () => {
  const r = normalizeUsage('codex', {plan_type: 'plus', rate_limit: {
    primary_window: {used_percent: 100, limit_window_seconds: 18000, reset_at: 1800000000},
    secondary_window: {used_percent: 27, limit_window_seconds: 604800, reset_at: 1800300000},
  }});
  assert.equal(r.plan, 'plus');
  assert.deepEqual(r.windows.map(w => [w.label, w.remainingPercent, w.resetsAt]), [
    ['5-hour limit', 0, new Date(1800000000 * 1000).toISOString()],
    ['Weekly limit', 73, new Date(1800300000 * 1000).toISOString()],
  ]);
});

test('missing quota data is unknown, not a full allowance or an inferred reset', () => {
  const r = normalizeUsage('codex', {rate_limit: {primary_window: {used_percent: null, reset_after_seconds: 60}}});
  assert.equal(r.windows[0]?.remainingPercent, null);
  assert.equal(r.windows[0]?.resetsAt, null);
  assert.equal(normalizeUsage('codex', {}).windows.length, 0);
});

test('Claude weekly and rolling windows remain separate; null limits are omitted', () => {
  const r = normalizeUsage('claude', {five_hour: {utilization: 15, resets_at: '2026-09-20T00:00:00Z'}, seven_day: {utilization: 50, resets_at: '2026-09-24T00:00:00Z'}, seven_day_opus: null});
  assert.equal(r.windows.length, 2);
  assert.equal(r.windows[0]?.remainingPercent, 85);
  assert.equal(r.windows[1]?.resetsAt, '2026-09-24T00:00:00.000Z');
});

test('normalized provider quotas handle zero and absent values separately', () => {
  const r = normalizeUsage('plugin', {subscription: {plan: 'Pro'}, groups: [{displayName: 'Usage', buckets: [{window: 'weekly', remainingFraction: 0, resetTime: '2026-09-24T00:00:00Z'}, {window: 'unknown'}]}]});
  assert.equal(r.windows[0]?.remainingPercent, 0);
  assert.equal(r.windows[1]?.remainingPercent, null);
});

test('usage requests target the selected credential and only the fixed read-only endpoint', async () => {
  const calls: unknown[][] = [];
  const mgmt = {async json(...args: unknown[]) {
    calls.push(args);
    if (args[1] === 'auth-files') return {files: [{name: 'selected.json', provider: 'codex', auth_index: 'chosen', id_token: {chatgpt_account_id: 'account-id'}}]};
    return {status_code: 200, body: JSON.stringify({plan_type: 'plus', rate_limit: {}})};
  }} as unknown as MgmtClient;
  await fetchSubscriptionUsage(mgmt, 'selected.json');
  assert.deepEqual(calls[1], ['POST', 'api-call', '', {auth_index: 'chosen', method: 'GET', url: 'https://chatgpt.com/backend-api/wham/usage', header: {Authorization: 'Bearer $TOKEN$', 'Content-Type': 'application/json', 'User-Agent': 'codex-tui/0.149.1', 'Chatgpt-Account-Id': 'account-id'}}]);
  await assert.rejects(fetchSubscriptionUsage(mgmt, 'other.json'), /missing/);
});

test('provider failures never leak raw upstream content', async () => {
  const mgmt = {async json(_method: string, route: string) {return route === 'auth-files' ? {files: [{name: 'a', provider: 'codex', auth_index: 'idx'}]} : {status_code: 401, body: 'secret upstream text'};}} as unknown as MgmtClient;
  await assert.rejects(fetchSubscriptionUsage(mgmt, 'a'), err => err instanceof Error && err.message.includes('401') && !err.message.includes('secret'));
});

test('manual reset dates and subscription notes persist without changing account mapping', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subscription-test-'));
  try {
    const store = new ProfileStore(path.join(dir, 'profiles.json'));
    const p = await store.create({name: 'Work', authFile: 'work.json'});
    await store.update(p.id, {resetAt: '2026-09-24T10:00:00+05:30', subscriptionNote: 'Weekly allowance'});
    const r = await store.get(p.id);
    assert.equal(r.resetAt, '2026-09-24T04:30:00.000Z');
    assert.equal(r.authFile, 'work.json');
    await assert.rejects(store.update(p.id, {resetAt: 'invalid'}), /valid date/);
    await store.update(p.id, {resetAt: null});
    assert.equal((await store.get(p.id)).resetAt, undefined);
  } finally {await fs.rm(dir, {recursive: true, force: true});}
});


test('Claude current limits include scoped windows, omit legacy duplicates and separate usage breakdown', () => {
  const usage = normalizeUsage('claude', {
    five_hour: {utilization: 41, resets_at: '2026-09-19T13:20:00.109873+00:00'},
    seven_day: {utilization: 59, resets_at: '2026-09-23T04:00:00.109898+00:00'},
    seven_day_breakdown: {as_of: '2026-09-19T13:17:19Z', rows: [{key: 'claude_code', display_name: 'Claude Code', percent: 93}, {key: 'chat', display_name: 'Chats', percent: 7}]},
    limits: [
      {kind: 'session', group: 'session', percent: 41, resets_at: '2026-09-19T13:20:00.109873+00:00', is_active: false},
      {kind: 'weekly_all', group: 'weekly', percent: 59, resets_at: '2026-09-23T04:00:00.109898+00:00', is_active: false},
      {kind: 'weekly_scoped', group: 'weekly', percent: 89, resets_at: '2026-09-23T04:00:00.110116+00:00', scope: {model: {display_name: 'Fable'}, surface: null}, severity: 'warning', is_active: true},
    ],
    spend: {enabled: false}, extra_usage: {is_enabled: false},
  });
  assert.deepEqual(usage.windows.map(w => [w.label, w.remainingPercent]), [['5-hour limit', 59], ['Weekly limit', 41], ['Weekly limit · Fable', 11]]);
  assert.equal(usage.windows[2]?.active, true);
  assert.equal(usage.windows[1]?.resetsAt, '2026-09-23T04:00:00.109Z');
  assert.deepEqual(usage.usageBreakdown, [{label: 'Claude Code', percent: 93}, {label: 'Chats', percent: 7}]);
  assert.equal(usage.extraUsageEnabled, false);
});

test('legacy Claude breakdown is not a quota window even without the modern array', () => {
  const usage = normalizeUsage('claude', {seven_day: {utilization: 10, resets_at: null}, seven_day_breakdown: {rows: [{display_name: 'Chats', percent: 100}]}, seven_day_opus: null});
  assert.equal(usage.windows.length, 1);
  assert.equal(usage.windows[0]?.remainingPercent, 90);
});

test('Claude plan normalization records Max tier but excludes personal profile details', () => {
  const usage = normalizeUsage('claude', {});
  applyClaudePlan(usage, {account: {has_claude_max: true, full_name: 'Private Name', email: 'private@example.com'}, organization: {rate_limit_tier: 'default_claude_max_20x', subscription_status: 'active', uuid: 'private-id'}});
  assert.equal(usage.plan, 'Claude Max (20×)');
  assert.equal(usage.subscriptionStatus, 'active');
  assert.equal(JSON.stringify(usage).includes('private'), false);
});

test('a failed Claude plan check does not discard successful usage', async () => {
  const mgmt = {async json(_method: string, route: string, _query?: string, payload?: {url: string}) {
    if (route === 'auth-files') return {files: [{name: 'claude', provider: 'claude', auth_index: 'idx'}]};
    return payload?.url.endsWith('/profile') ? {status_code: 503, body: 'private upstream error'} : {status_code: 200, body: JSON.stringify({five_hour: {utilization: 25, resets_at: null}})};
  }} as unknown as MgmtClient;
  const result = await fetchSubscriptionUsage(mgmt, 'claude');
  assert.equal(result.windows[0]?.remainingPercent, 75);
  assert.equal(result.planCheckUnavailable, true);
});
