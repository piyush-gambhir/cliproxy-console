import {relayInference, subscriptionUrl} from './inference.ts';
import {readDesktop, desktopCatalog, applyDesktop} from './desktop.ts';
import { fetchSubscriptionUsage, type SubscriptionUsage } from './subscriptions.ts';
import { readRouting, updateRouting, resolveSelection, setProfilePrefix } from './routing.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {ServiceSettingsStore} from './service-settings.ts';
import type {StartupStore} from './startup.ts';
import { SettingsStore } from './settings.ts';
import { ProfileStore, ProfileError } from './profiles.ts';
import { MgmtClient, MgmtDisabledError } from './mgmt.ts';
import { readBody, readJsonBody, sendError, sendJson, serveStatic } from './http.ts';
import { PathError, RECENTS_FILE, resolveUserDir, tildify } from './paths.ts';
import { readJsonFile, writeJsonFile } from './json-store.ts';
import {
  WireError,
  applyWire,
  assertValidPrefix,
  planWire,
  zshSnippet,
  type WireInput,
  type WireTarget,
} from './wire.ts';

export interface AppDeps {
  settings: SettingsStore;
  profiles: ProfileStore;
  mgmt: MgmtClient;
  /** Directory holding the built web app, or null in dev (Vite serves it). */
  webDist: string | null;
  /** Where the "recent project folders" list lives. */
  recentsFile?: string;
  usageFile?: string;
  startup?: StartupStore;
  serviceSettings?: ServiceSettingsStore;
}

async function loadRecents(file: string): Promise<string[]> {
  const data = await readJsonFile<{ paths?: string[] }>(file, {});
  return Array.isArray(data.paths) ? data.paths : [];
}

async function rememberRecent(file: string, dir: string): Promise<void> {
  const current = await loadRecents(file);
  const next = [dir, ...current.filter((p) => p !== dir)].slice(0, 8);
  await writeJsonFile(file, { paths: next });
}

function errorStatus(err: unknown): number {
  if (err instanceof ProfileError || err instanceof WireError) return err.status;
  if (err instanceof MgmtDisabledError) return 503;
  if (err instanceof PathError) return 400;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
}

function errorPayload(err: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = { error: (err as Error).message ?? 'unknown error' };
  if (err instanceof MgmtDisabledError) {
    payload['code'] = err.status === 404 ? 'management_disabled' : 'management_unauthorized';
  }
  return payload;
}

function wireInputFrom(body: Record<string, unknown>, proxyUrl: string): WireInput {
  const target = body['target'];
  if (target !== 'project' && target !== 'profile-global') {
    throw new WireError('target must be "project" or "profile-global"');
  }
  const dir = body['path'];
  if (typeof dir !== 'string' || dir.trim() === '') throw new WireError('path is required');
  const model = body['model'];
  if (typeof model !== 'string' || model.trim() === '') throw new WireError('model is required');
  const apiKey = body['apiKey'];
  if (typeof apiKey !== 'string' || apiKey.trim() === '') throw new WireError('apiKey is required');
  const prefix = typeof body['prefix'] === 'string' ? (body['prefix'] as string).trim() : '';
  if (prefix) assertValidPrefix(prefix);
  return {
    pinModelDefaults: true,
    target: target as WireTarget,
    path: dir,
    model: model.trim(),
    prefix,
    proxyUrl,
    apiKey: apiKey.trim(),
  };
}

/**
 * The console binds to 127.0.0.1 and has no auth, so the browser's same-origin policy is the
 * only thing standing between a random web page and `POST /api/wire`. Simple requests
 * (form posts, text/plain fetches) skip CORS preflight and would reach us, so refuse any
 * request whose Origin or Host is not local. DNS rebinding is covered by the Host check.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostnameOf(value: string): string | null {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

export function isLocalRequest(headers: { origin?: string; host?: string }): boolean {
  const host = hostnameOf(headers.host ?? '');
  if (!host || !LOCAL_HOSTS.has(host.startsWith('[') ? host : host.replace(/^\[|\]$/g, ''))) return false;
  if (headers.origin === undefined || headers.origin === 'null') return true;
  const origin = hostnameOf(headers.origin);
  return origin !== null && LOCAL_HOSTS.has(origin);
}

export function createApp(deps: AppDeps) {
  const recentsFile = deps.recentsFile ?? RECENTS_FILE;
  let usageWrites: Promise<void> = Promise.resolve();

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const rawUrl = req.url ?? '/';
    if (rawUrl.startsWith('/api/') || rawUrl.startsWith('/inference/')) {
      const originHeader = req.headers.origin;
      const hostHeader = req.headers.host;
      const local = isLocalRequest({
        origin: Array.isArray(originHeader) ? originHeader[0] : originHeader,
        host: Array.isArray(hostHeader) ? hostHeader[0] : hostHeader,
      });
      if (!local) {
        sendJson(res, 403, { error: 'cliproxy-console only accepts requests from localhost' });
        return;
      }
    }
    const qIndex = rawUrl.indexOf('?');
    const pathname = qIndex < 0 ? rawUrl : rawUrl.slice(0, qIndex);
    const search = qIndex < 0 ? '' : rawUrl.slice(qIndex);
    const query = new URLSearchParams(search);

    try {
      if (pathname.startsWith('/inference/')) {
        const match = /^\/inference\/([^/]+)(\/v1\/(?:models|messages(?:\/count_tokens)?))$/.exec(pathname);
        if (!match || [...query.keys()].some(key => key !== 'beta') || (query.has('beta') && query.get('beta') !== 'true')) throw new WireError('Unsupported inference endpoint', 404);
        const {proxyUrl, claudeModels} = await deps.settings.load();
        return await relayInference(req,res,decodeURIComponent(match[1]!),match[2]!,proxyUrl,deps.mgmt,deps.profiles,claudeModels);
      }
      if (pathname === '/api/desktop' && method === 'GET') {
        const cfg = await deps.settings.load();
        let desktop;
        try { desktop = await readDesktop(cfg.desktopConfigDir); }
        catch (err) { if (!(err instanceof WireError) || err.status !== 409) throw err; desktop = {profile:'',autoMode:false,models:[],defaultEffort:'',alwaysDefault:true,gatewayUrl:'',setupRequired:true}; }
        return sendJson(res, 200, {...desktop, consoleUrl:cfg.consoleUrl, claudeConfigDir:cfg.claudeConfigDir, allowedModels:cfg.claudeModels, cliEffort:cfg.cliEffort, catalog: await desktopCatalog(deps.mgmt, deps.profiles)});
      }
      if (pathname === '/api/desktop' && method === 'PUT') {
        const cfg = await deps.settings.load();
        return sendJson(res, 200, await applyDesktop(deps.mgmt, deps.profiles, cfg.proxyUrl, await readJsonBody<Record<string, unknown>>(req), cfg.desktopConfigDir, cfg.consoleUrl, cfg.claudeModels));
      }
      if (pathname === '/api/service-settings' && deps.serviceSettings) {
        if (method === 'GET') return sendJson(res,200,await deps.serviceSettings.view());
        if (method === 'PUT') return sendJson(res,200,await deps.serviceSettings.update(await readJsonBody(req)));
      }
      if (pathname === '/api/startup' && deps.startup) {
        if (method === 'GET') return sendJson(res,200,deps.startup.view());
        if (method === 'PUT') return sendJson(res,200,deps.startup.update(await readJsonBody(req)));
      }
      // ---------- settings ----------
      if (pathname === '/api/settings' && method === 'GET') {
        return sendJson(res, 200, await deps.settings.publicView());
      }
      if (pathname === '/api/settings' && method === 'PUT') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        return sendJson(res, 200, await deps.settings.update(body));
      }

      // ---------- proxy health ----------
      if (pathname === '/api/health' && method === 'GET') {
        const settings = await deps.settings.publicView();
        const health = await deps.mgmt.health();
        return sendJson(res, 200, {
          ...health,
          proxyUrl: settings.proxyUrl,
          proxyVersion: deps.mgmt.lastProxyVersion,
          hasManagementKey: settings.hasManagementKey,
        });
      }

      // ---------- routing chips (whitelisted slice of GET /config) ----------
      if (pathname === '/api/routing' && method === 'GET') {
        return sendJson(res, 200, await readRouting(deps.mgmt));
      }
      if (pathname === '/api/routing' && method === 'PUT') {
        return sendJson(res, 200, await updateRouting(deps.mgmt, await readJsonBody<Record<string, unknown>>(req)));
      }
      if (pathname.match(/^\/api\/profiles\/[^/]+\/prefix$/) && method === 'PUT') {
        const id = decodeURIComponent(pathname.split('/')[3]!);
        const body = await readJsonBody<Record<string, unknown>>(req);
        return sendJson(res, 200, await setProfilePrefix(deps.mgmt, deps.profiles, id, body.prefix));
      }

      if (pathname.match(/^\/api\/profiles\/[^/]+\/usage$/) && (method === 'GET' || method === 'POST')) {
        const profile = await deps.profiles.get(decodeURIComponent(pathname.split('/')[3]!));
        const { proxyUrl } = await deps.settings.load();
        const key = `${proxyUrl}|${profile.authFile}`;
        const file = deps.usageFile ?? path.join(path.dirname(deps.settings.file), 'subscription-usage.json');
        const snapshots = await readJsonFile<Record<string, SubscriptionUsage>>(file, {});
        if (method === 'GET') return sendJson(res, 200, { usage: snapshots[key] ?? null });
        const usage = await fetchSubscriptionUsage(deps.mgmt, profile.authFile);
        // Re-read so simultaneous checks of different subscriptions do not overwrite older snapshots.
        const write = usageWrites.then(async () => {
          const latest = await readJsonFile<Record<string, SubscriptionUsage>>(file, {});
          await writeJsonFile(file, {...latest, [key]: usage});
        });
        usageWrites = write.catch(() => {});
        await write;
        return sendJson(res, 200, { usage });
      }

      // ---------- management API passthrough ----------
      if (pathname.startsWith('/api/mgmt/')) {
        const sub = pathname.slice('/api/mgmt/'.length);
        if (MgmtClient.isBlocked(sub)) {
          return sendError(res, 403, `/${sub} is blocked by the console: it returns credentials`);
        }
        const body = method === 'GET' || method === 'HEAD' ? null : await readBody(req);
        const out = await deps.mgmt.forward(method, sub, search, body, req.headers['content-type'] ?? null);
        if (out.status === 404 || out.status === 401 || out.status === 403) {
          const err = new MgmtDisabledError(out.status);
          return sendJson(res, 503, { ...errorPayload(err), upstreamStatus: out.status });
        }
        res.writeHead(out.status, { 'Content-Type': out.contentType, 'Cache-Control': 'no-store' });
        return void res.end(out.body);
      }

      // ---------- client models ----------
      if (pathname === '/api/proxy/models' && method === 'GET') {
        return sendJson(res, 200, await deps.mgmt.proxyModels());
      }

      // ---------- profiles ----------
      if (pathname === '/api/profiles' && method === 'GET') {
        return sendJson(res, 200, { profiles: await deps.profiles.list() });
      }
      if (pathname === '/api/profiles' && method === 'POST') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        return sendJson(res, 201, await deps.profiles.create(body));
      }
      if (pathname.startsWith('/api/profiles/')) {
        const id = decodeURIComponent(pathname.slice('/api/profiles/'.length));
        if (method === 'GET') return sendJson(res, 200, await deps.profiles.get(id));
        if (method === 'PUT' || method === 'PATCH') {
          const body = await readJsonBody<Record<string, unknown>>(req);
          return sendJson(res, 200, await deps.profiles.update(id, body));
        }
        if (method === 'DELETE') {
          return sendJson(res, 200, await deps.profiles.remove(id));
        }
      }

      // ---------- wiring ----------
      if ((pathname === '/api/wire' || pathname === '/api/wire/preview') && method === 'POST') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const configured = await deps.settings.load();
        let { proxyUrl } = configured;
        const selection = await resolveSelection(deps.mgmt, deps.profiles, body);
        const profile = await deps.profiles.get(String(body.profile));
        if (profile.authFile.startsWith('claude-')) {
          const canonical = selection.model.slice(profile.lastKnownPrefix!.length + 1);
          if (!configured.claudeModels.some(option => option.id === canonical)) throw new WireError('Choose an allowed official Anthropic model');
          selection.model = `${canonical}[1m]`; proxyUrl = subscriptionUrl(profile.id, deps.settings.consoleUrl);
        }
        const input = wireInputFrom({ ...body, ...selection, apiKey: body.apiKey || configured.clientApiKey }, proxyUrl);
        if (pathname === '/api/wire/preview') {
          return sendJson(res, 200, await planWire(input));
        }
        const result = await applyWire(input);
        if (input.target === 'project') {
          await rememberRecent(recentsFile, resolveUserDir(input.path));
        }
        return sendJson(res, 200, result);
      }
      if (pathname === '/api/wire/snippet' && method === 'GET') {
        const configured = await deps.settings.load();
        let { proxyUrl } = configured;
        const profileId = query.get('profile') ?? '';
        const selection = await resolveSelection(deps.mgmt, deps.profiles, Object.fromEntries(query));
        const profile = await deps.profiles.get(profileId);
        if (profile.authFile.startsWith('claude-')) {
          const canonical = selection.model.slice(profile.lastKnownPrefix!.length + 1);
          if (!configured.claudeModels.some(option => option.id === canonical)) throw new WireError('Choose an allowed official Anthropic model');
          selection.model = `${canonical}[1m]`; proxyUrl = subscriptionUrl(profileId, deps.settings.consoleUrl);
        }
        const { model, prefix } = selection;
        let functionName = query.get('name') ?? 'cliproxy';
        if (profileId) functionName = (await deps.profiles.get(profileId)).name;
        if (prefix) assertValidPrefix(prefix);
        return sendJson(res, 200, {
          snippet: zshSnippet({ functionName, proxyUrl, model, prefix, pinModelDefaults: true }),
        });
      }

      // ---------- target directories ----------
      if (pathname === '/api/targets' && method === 'GET') {
        const globals = await Promise.all(
          [(await deps.settings.load()).claudeConfigDir].map(async (dir) => ({
            path: dir,
            display: tildify(dir),
            exists: await fs
              .stat(dir)
              .then((s) => s.isDirectory())
              .catch(() => false),
          })),
        );
        const recents = await loadRecents(recentsFile);
        return sendJson(res, 200, {
          globals,
          recents: recents.map((p) => ({ path: p, display: tildify(p) })),
        });
      }
      if (pathname === '/api/targets/check' && method === 'GET') {
        const dir = query.get('path') ?? '';
        const resolved = resolveUserDir(dir);
        const exists = await fs
          .stat(resolved)
          .then((s) => s.isDirectory())
          .catch(() => false);
        return sendJson(res, 200, { path: resolved, display: tildify(resolved), exists });
      }

      if (pathname.startsWith('/api/')) {
        return sendError(res, 404, `no route for ${method} ${pathname}`);
      }

      // ---------- static web app ----------
      if (deps.webDist) {
        if (await serveStatic(res, deps.webDist, pathname)) return;
        if (await serveStatic(res, deps.webDist, '/index.html')) return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return void res.end(
        '<!doctype html><meta charset="utf-8"><title>cliproxy-console</title>' +
          '<body style="font:14px ui-sans-serif,system-ui;padding:40px;color:#1c1c1f">' +
          '<h1 style="font-size:18px">cliproxy-console server is up</h1>' +
          '<p>The web app has not been built yet. Run <code>npm run build</code> for the bundled UI, ' +
          'or <code>npm run dev</code> and open the Vite dev server.</p></body>',
      );
    } catch (err) {
      return sendJson(res, errorStatus(err), errorPayload(err));
    }
  };
}
