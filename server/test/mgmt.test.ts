import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { SettingsStore } from '../src/settings.ts';
import { ProfileStore } from '../src/profiles.ts';
import { MgmtClient } from '../src/mgmt.ts';

/** One request as the fake proxy saw it. */
interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
  body: string;
}

const MGMT_KEY = 'test-management-key';

let proxy: http.Server;
let proxyUrl: string;
let seen: Seen[] = [];
/** Flip to make the fake proxy behave like one with no secret-key configured. */
let managementEnabled = true;
let accountFiles = [{ id: 'a.json', name: 'a.json', provider: 'claude', status: 'active', disabled: false }];
let registeredModels: Record<string, string[]> = {};
let failRouting = '';
let usageStatus = 200;


let console_: http.Server;
let consoleUrl: string;
let tmp: string;

function fakeProxy(): http.Server {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const url = req.url ?? '/';
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method ?? 'GET', url, auth: req.headers.authorization, body });

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'X-CPA-VERSION': '7.3.0' });
        res.end(JSON.stringify(payload));
      };

      if (url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return void res.end(JSON.stringify({ status: 'ok' }));
      }
      if (url.startsWith('/v1/models')) {
        if (req.headers.authorization !== 'Bearer client-key-1') {
          return void json(401, { error: 'bad key' });
        }
        return void json(200, { object: 'list', data: [{ id: 'claude-opus-5' }] });
      }
      if (!url.startsWith('/v0/management/')) {
        res.writeHead(404);
        return void res.end();
      }
      // Management routes are unregistered entirely when secret-key is unset:
      // internal/api/server_management.go:196-215 -> 404 with a zero-length body.
      if (!managementEnabled) {
        res.writeHead(404);
        return void res.end();
      }
      if (req.headers.authorization !== `Bearer ${MGMT_KEY}`) {
        return void json(401, { error: 'wrong management key' });
      }
      const route = url.slice('/v0/management/'.length);
      if (route === 'api-call') return void json(200, {status_code: usageStatus, body: JSON.stringify({plan_type: 'pro', rate_limit: {secondary_window: {used_percent: 25, limit_window_seconds: 604800, reset_at: 1800300000}}})});
      if (route.startsWith('auth-files/models')) {
        const name = new URL(url, 'http://local').searchParams.get('name') ?? '';
        return void json(200, { models: (registeredModels[name] ?? ['claude-opus-5', 'work/claude-opus-5']).map(id => ({id})) });
      }
      if (route.startsWith('auth-files/fields')) {
        return void json(200, { status: 'ok' });
      }
      if (route.startsWith('auth-files')) {
        return void json(200, {
          observed_at: '2026-01-01T00:00:00Z',
          files: accountFiles,
        });
      }
      if (route.startsWith('api-keys')) {
        return void json(200, { 'api-keys': ['client-key-1', 'client-key-2'] });
      }
      if (req.method === 'PUT') return void json(route === failRouting ? 500 : 200, {status: 'ok'});
      if (route.startsWith('config')) {
        return void json(200, {
          'remote-management': { 'secret-key': 'SUPER-SECRET' },
          'api-keys': ['client-key-1'],
          routing: { strategy: 'fill-first', 'session-affinity': true, 'session-affinity-ttl': '2h' },
        });
      }
      return void json(404, { error: 'not found' });
    });
  });
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

before(async () => {
  proxy = fakeProxy();
  proxyUrl = await listen(proxy);
});

after(async () => {
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
});

beforeEach(async () => {
  seen = [];
  managementEnabled = true;
  accountFiles = [{id: 'a.json', name: 'a.json', provider: 'claude', status: 'active', disabled: false}];
  registeredModels = {}; failRouting = ''; usageStatus = 200;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cliproxy-app-'));
  const settings = new SettingsStore(path.join(tmp, 'settings.sqlite'), {env: {}});
  await settings.update({ proxyUrl, managementKey: MGMT_KEY });
  const app = createApp({
    settings,
    profiles: new ProfileStore(path.join(tmp, 'profiles.json')),
    mgmt: new MgmtClient(settings),
    webDist: null,
    recentsFile: path.join(tmp, 'recents.json'),
  });
  console_ = http.createServer((req, res) => void app(req, res));
  consoleUrl = await listen(console_);
});

afterEach(async () => {
  await new Promise<void>((resolve) => console_.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

const get = (p: string) => fetch(`${consoleUrl}${p}`);

/** fetch().json() is typed `unknown` under @types/node; tests assert on the shape directly. */
const jsonOf = (res: Response): Promise<any> => res.json() as Promise<any>;

describe('localhost-only guard', () => {
  test('rejects a cross-site simple POST by Origin', async () => {
    const res = await fetch(`${consoleUrl}/api/profiles`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'x', authFile: 'y' }),
    });
    assert.equal(res.status, 403);
  });

  test('rejects a DNS-rebound Host header', async () => {
    // fetch() silently drops a user-set Host header, so go through node:http.
    const { port } = console_.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/settings', method: 'GET', headers: { Host: 'attacker.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });

  test('accepts a localhost Origin such as the Vite dev server', async () => {
    const res = await fetch(`${consoleUrl}/api/settings`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(res.status, 200);
  });

  test('accepts a same-origin request with no Origin header', async () => {
    const res = await get('/api/settings');
    assert.equal(res.status, 200);
  });
});

describe('GET /api/settings', () => {
  test('reports the proxy url and that a key is held, but never the key', async () => {
    const res = await get('/api/settings');
    const body = await jsonOf(res);
    assert.equal(res.status, 200);
    assert.equal(body.proxyUrl, proxyUrl);
    assert.equal(body.hasManagementKey, true);
    assert.equal(body.keySource, 'sqlite');
    assert.equal(JSON.stringify(body).includes(MGMT_KEY), false);
  });
});

test('configured client key is write-only in settings and used for model discovery without reading proxy keys', async () => {
  const response = await fetch(`${consoleUrl}/api/settings`, {method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({clientApiKey:'client-key-1'})});
  const view = await jsonOf(response);
  assert.equal(view.clientKeySource, 'sqlite');
  assert.equal(JSON.stringify(view).includes('client-key-1'), false);
  seen = [];
  assert.equal((await get('/api/proxy/models')).status, 200);
  assert.deepEqual(seen.map(s => s.url), ['/v1/models']);
  assert.equal(seen[0]?.auth, 'Bearer client-key-1');
});

describe('ANY /api/mgmt/*', () => {
  test('forwards to /v0/management/* with the bearer header added', async () => {
    const res = await get('/api/mgmt/auth-files');
    const body = await jsonOf(res);
    assert.equal(res.status, 200);
    assert.equal(body.files[0].name, 'a.json');
    assert.deepEqual(
      seen.map((s) => [s.method, s.url, s.auth]),
      [['GET', '/v0/management/auth-files', `Bearer ${MGMT_KEY}`]],
    );
  });

  test('passes the query string through', async () => {
    await get('/api/mgmt/auth-files/models?name=a.json');
    assert.equal(seen[0]?.url, '/v0/management/auth-files/models?name=a.json');
  });

  test('forwards method and body for a PATCH', async () => {
    const res = await fetch(`${consoleUrl}/api/mgmt/auth-files/fields`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a.json', prefix: 'work' }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await jsonOf(res), { status: 'ok' });
    assert.equal(seen[0]?.method, 'PATCH');
    assert.equal(seen[0]?.body, '{"name":"a.json","prefix":"work"}');
  });

  test('turns the disabled-management 404 into a 503 the UI can explain', async () => {
    managementEnabled = false;
    const res = await get('/api/mgmt/auth-files');
    const body = await jsonOf(res);
    assert.equal(res.status, 503);
    assert.equal(body.code, 'management_disabled');
    assert.equal(body.upstreamStatus, 404);
    assert.match(body.error, /secret-key/);
  });

  test('turns a rejected key into a 503 with a different code', async () => {
    const settings = new SettingsStore(path.join(tmp, 'other.sqlite'), {env: {}});
    await settings.update({ proxyUrl, managementKey: 'wrong' });
    const app = createApp({
      settings,
      profiles: new ProfileStore(path.join(tmp, 'p2.json')),
      mgmt: new MgmtClient(settings),
      webDist: null,
      recentsFile: path.join(tmp, 'r2.json'),
    });
    const server = http.createServer((req, res) => void app(req, res));
    const base = await listen(server);
    const res = await fetch(`${base}/api/mgmt/auth-files`);
    const body = await jsonOf(res);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(res.status, 503);
    assert.equal(body.code, 'management_unauthorized');
  });

  test('blocks the routes that would leak credentials to the browser', async () => {
    for (const route of ['config', 'config.yaml', 'auth-files/download?name=a.json']) {
      const res = await get(`/api/mgmt/${route}`);
      assert.equal(res.status, 403, route);
      assert.match((await jsonOf(res)).error, /blocked by the console/);
    }
    assert.deepEqual(seen, []);
  });
});

describe('GET /api/routing', () => {
  test('returns only the routing block, never the secret key', async () => {
    const res = await get('/api/routing');
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(text.includes('SUPER-SECRET'), false);
    assert.deepEqual(JSON.parse(text), {
      forceModelPrefix: false, requestRetry: 3, maxRetryInterval: 30, switchProject: false, switchPreviewModel: false,
      strategy: 'fill-first',
      sessionAffinity: true,
      sessionAffinityTtl: '2h',
      sessionAffinitySubagents: true,
    });
  });
});

describe('GET /api/proxy/models', () => {
  test('uses the first client key from /api-keys against /v1/models', async () => {
    const res = await get('/api/proxy/models');
    assert.equal(res.status, 200);
    assert.deepEqual((await jsonOf(res)).data, [{ id: 'claude-opus-5' }]);
    assert.deepEqual(
      seen.map((s) => s.url),
      ['/v0/management/api-keys', '/v1/models'],
    );
    assert.equal(seen[1]?.auth, 'Bearer client-key-1');
  });
});

describe('GET /api/health', () => {
  test('reports the proxy as up and surfaces the version seen on management calls', async () => {
    await get('/api/mgmt/auth-files'); // learns X-CPA-VERSION
    const res = await get('/api/health');
    const body = await jsonOf(res);
    assert.equal(body.ok, true);
    assert.equal(body.proxyVersion, '7.3.0');
    assert.equal(body.hasManagementKey, true);
  });
});

describe('/api/profiles', () => {
  test('round-trips create, list, update and delete', async () => {
    const created = await fetch(`${consoleUrl}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Work', authFile: 'a.json' }),
    });
    assert.equal(created.status, 201);
    const profile = await jsonOf(created);

    assert.deepEqual((await jsonOf(await get('/api/profiles'))).profiles, [profile]);

    const updated = await fetch(`${consoleUrl}/api/profiles/${profile.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Day job' }),
    });
    assert.equal((await jsonOf(updated)).name, 'Day job');

    const removed = await fetch(`${consoleUrl}/api/profiles/${profile.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.deepEqual((await jsonOf(await get('/api/profiles'))).profiles, []);
  });

  test('surfaces validation errors as 400 and duplicates as 409', async () => {
    const bad = await fetch(`${consoleUrl}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authFile: 'a.json' }),
    });
    assert.equal(bad.status, 400);

    const post = (body: unknown) =>
      fetch(`${consoleUrl}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    await post({ name: 'A', authFile: 'a.json' });
    assert.equal((await post({ name: 'B', authFile: 'a.json' })).status, 409);
  });
});

describe('/api/wire', () => {
  test('previews without writing and then writes', async () => {
    const dir = await fs.mkdtemp(path.join(os.homedir(), '.cliproxy-console-wiretest-'));
    try {
      const profile = await createTestProfile();
      const payload = {
        profile: profile.id,
        routingMode: 'manual',
        target: 'project',
        path: dir,
        model: 'claude-opus-5',
        prefix: 'work',
        apiKey: 'client-key-1',
      };
      const preview = await fetch(`${consoleUrl}/api/wire/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const plan = await jsonOf(preview);
      assert.equal(plan.env.ANTHROPIC_MODEL, 'work/claude-opus-5');
      assert.equal(plan.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'work/claude-opus-5');
      assert.equal(plan.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'work/claude-opus-5');
      assert.equal(plan.env.ANTHROPIC_BASE_URL, proxyUrl);
      await assert.rejects(fs.stat(plan.file));

      await fetch(`${consoleUrl}/api/settings`, {method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({clientApiKey: 'client-key-1'})});
      const written = await fetch(`${consoleUrl}/api/wire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({...payload, apiKey: ''}),
      });
      const result = await jsonOf(written);
      assert.equal(written.status, 200);
      const onDisk = JSON.parse(await fs.readFile(result.file, 'utf8'));
      assert.deepEqual(onDisk.env, plan.env);
      assert.equal((await fs.stat(result.file)).mode & 0o777, 0o600);

      const targets = await jsonOf(await get('/api/targets'));
      assert.equal(targets.recents[0].path, dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('refuses a path outside $HOME with a 400', async () => {
    const res = await fetch(`${consoleUrl}/api/wire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: (await createTestProfile()).id, target: 'project', path: '/tmp/nope', model: 'claude-opus-5', apiKey: 'k' }),
    });
    assert.equal(res.status, 400);
    assert.match((await jsonOf(res)).error, /must be inside/);
  });

  test('requires an account for manual setup even when a prefix is supplied', async () => {
    const res = await fetch(`${consoleUrl}/api/wire/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'project', path: '~', model: 'm', prefix: 'a/b', apiKey: 'k' }),
    });
    assert.equal(res.status, 400);
    assert.match((await jsonOf(res)).error, /Choose an account/);
  });
});

describe('GET /api/wire/snippet', () => {
  test('names the function after the profile', async () => {
    const created = await fetch(`${consoleUrl}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Day job', authFile: 'a.json', prefix: 'work' }),
    });
    const profile = await jsonOf(created);
    const res = await get(
      `/api/wire/snippet?profile=${profile.id}&model=claude-opus-5&prefix=work`,
    );
    const { snippet } = await jsonOf(res);
    assert.match(snippet, /^Day-job\(\) \{$/m);
    assert.match(snippet, /ANTHROPIC_MODEL='work\/claude-opus-5'/);
  });
});

describe('unknown routes', () => {
  test('/api/* 404s as JSON', async () => {
    const res = await get('/api/nope');
    assert.equal(res.status, 404);
    assert.match((await jsonOf(res)).error, /no route/);
  });

  test('anything else falls through to the web app placeholder', async () => {
    const res = await get('/profiles');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  });
});

async function createTestProfile() {
  const r = await fetch(`${consoleUrl}/api/profiles`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 'Work', authFile: 'a.json', prefix: 'work'})});
  return jsonOf(r);
}
const putJson = (route: string, body: unknown) => fetch(`${consoleUrl}${route}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});

describe('routing controls', () => {
  test('manual is the default and preference survives a new store', async () => {
    assert.equal((await jsonOf(await get('/api/settings'))).routingMode, 'manual');
    assert.equal((await putJson('/api/settings', {routingMode: 'automatic'})).status, 400);
    assert.equal((await new SettingsStore(path.join(tmp, 'settings.sqlite')).publicView()).routingMode, 'manual');
    assert.equal((await putJson('/api/settings', {routingMode: 'anything'})).status, 400);
  });
  test('validates the entire patch before mutating and rejects unknown settings', async () => {
    for (const patch of [{strategy: 'fill-first', requestRetry: -1}, {forceModelPrefix: 'true'}, {secret: 'oops'}, {strategy: 'random'}]) {
      assert.equal((await putJson('/api/routing', patch)).status, 400);
    }
    assert.equal(seen.length, 0);
  });
  test('uses dedicated endpoints with the expected value shape', async () => {
    assert.equal((await putJson('/api/routing', {strategy: 'fill-first', switchProject: false})).status, 200);
    assert.deepEqual(seen.filter(s => s.method === 'PUT').map(s => [s.url, JSON.parse(s.body)]), [
      ['/v0/management/routing/strategy', {value: 'fill-first'}],
      ['/v0/management/quota-exceeded/switch-project', {value: false}],
    ]);
  });
  test('reports partial saves instead of claiming success', async () => {
    failRouting = 'request-retry';
    const r = await putJson('/api/routing', {strategy: 'fill-first', requestRetry: 2, switchProject: false});
    assert.equal(r.status, 502);
    assert.match((await jsonOf(r)).error, /Already saved: strategy/);
    assert.equal(seen.some(s => s.url.includes('switch-project')), false);
  });
});

describe('explicit account selection', () => {
  const preview = (body: unknown) => fetch(`${consoleUrl}/api/wire/preview`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  test('uses the live prefixed model once, ignoring an injected prefix', async () => {
    const p = await createTestProfile();
    const r = await preview({profile: p.id, model: 'work/claude-opus-5', prefix: 'other', target: 'project', path: '~', apiKey: 'k'});
    assert.equal(r.status, 200);
    assert.equal((await jsonOf(r)).env.ANTHROPIC_MODEL, 'work/claude-opus-5');
  });
  test('rejects missing registrations, disabled accounts and ambiguous routes including unassigned accounts', async () => {
    const p = await createTestProfile();
    const body = {profile: p.id, model: 'claude-opus-5', target: 'project', path: '~', apiKey: 'k'};
    registeredModels['a.json'] = ['claude-opus-5'];
    assert.equal((await preview(body)).status, 409);
    registeredModels['a.json'] = ['work/claude-opus-5'];
    accountFiles[0]!.disabled = true;
    assert.equal((await preview(body)).status, 409);
    accountFiles[0]!.disabled = false;
    accountFiles.push({id: 'b.json', name: 'b.json', provider: 'claude', status: 'active', disabled: false});
    registeredModels['b.json'] = ['work/claude-opus-5'];
    const shared = await preview(body);
    assert.equal(shared.status, 409);
    assert.match((await jsonOf(shared)).error, /shared/);
    const snippet = await get(`/api/wire/snippet?profile=${p.id}&model=claude-opus-5`);
    assert.equal(snippet.status, 409);
  });
  test('automatic selection is rejected even if explicitly requested', async () => {
    const r = await preview({routingMode: 'automatic', model: 'claude-opus-5', prefix: 'work', target: 'project', path: '~', apiKey: 'k'});
    assert.equal(r.status, 400);
    assert.match((await jsonOf(r)).error, /automatic account selection is disabled/);
  });
  test('saves prefixes on the proxy and records them locally; rejects collisions', async () => {
    const p = await createTestProfile();
    const saved = await putJson(`/api/profiles/${p.id}/prefix`, {prefix: 'personal'});
    assert.equal(saved.status, 200);
    assert.equal((await jsonOf(saved)).lastKnownPrefix, 'personal');
    assert.ok(seen.some(s => s.method === 'PATCH' && JSON.parse(s.body).prefix === 'personal'));
    accountFiles.push({id: 'b.json', name: 'b.json', provider: 'claude', status: 'active', disabled: false});
    registeredModels['b.json'] = ['taken/claude-opus-5'];
    assert.equal((await putJson(`/api/profiles/${p.id}/prefix`, {prefix: 'taken'})).status, 409);
    assert.equal((await putJson(`/api/profiles/${p.id}/prefix`, {prefix: 'bad/prefix'})).status, 400);
  });
});


describe('subscription usage snapshots', () => {
  test('caches normalized resets, preserves them on provider failure and serves them without another probe', async () => {
    const p = await createTestProfile();
    Object.assign(accountFiles[0]!, {provider: 'codex', auth_index: 'selected'});
    const route = `/api/profiles/${p.id}/usage`;
    assert.equal((await jsonOf(await get(route))).usage, null);
    const refreshed = await fetch(`${consoleUrl}${route}`, {method: 'POST'});
    assert.equal(refreshed.status, 200);
    const snapshot = (await jsonOf(refreshed)).usage;
    assert.equal(snapshot.windows[0].remainingPercent, 75);
    usageStatus = 401;
    assert.equal((await fetch(`${consoleUrl}${route}`, {method: 'POST'})).status, 502);
    seen = [];
    assert.deepEqual((await jsonOf(await get(route))).usage, snapshot);
    assert.equal(seen.length, 0);
  });
});
