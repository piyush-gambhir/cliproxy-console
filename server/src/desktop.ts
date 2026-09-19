import {CLAUDE_MODELS, subscriptionUrl} from './inference.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DESKTOP_CONFIG_DIR} from './paths.ts';
import {consoleOrigin} from './runtime.ts';
import { readJsonFile, writeJsonFile } from './json-store.ts';
import { WireError } from './wire.ts';
import { accountModels, resolveSelection } from './routing.ts';
import type { MgmtClient } from './mgmt.ts';
import type { ProfileStore } from './profiles.ts';

export const desktopDirectory = DESKTOP_CONFIG_DIR;
export interface DesktopModel { name: string; labelOverride: string; maxEffort?: string; supports1m?: boolean; prefer1m?: boolean }
export function validateModels(value: unknown): DesktopModel[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new WireError('Select between 1 and 100 models');
  const names = new Set<string>();
  return value.map(entry => {
    if (!entry || typeof entry.name !== 'string' || !entry.name || names.has(entry.name)) throw new WireError('Model routes must be nonempty and unique');
    names.add(entry.name);
    if (typeof entry.labelOverride !== 'string' || !entry.labelOverride.trim() || entry.labelOverride.length > 200) throw new WireError('Each model needs a label (up to 200 characters)');
    if (entry.maxEffort && !['low','medium','high','xhigh','max'].includes(entry.maxEffort)) throw new WireError('Invalid effort cap');
    if (entry.supports1m !== undefined && typeof entry.supports1m !== 'boolean' || entry.prefer1m !== undefined && typeof entry.prefer1m !== 'boolean') throw new WireError('Invalid context options');
    return {...(entry.supports1m !== undefined ? {supports1m:entry.supports1m,prefer1m:entry.supports1m && entry.prefer1m === true} : {}), name: entry.name, labelOverride: entry.labelOverride.trim(), ...(entry.maxEffort ? {maxEffort: entry.maxEffort} : {})};
  });
}
export async function desktopFile(directory = desktopDirectory) {
  const meta = await readJsonFile<{appliedId?: string}>(path.join(directory, '_meta.json'), {});
  if (!meta.appliedId || !/^[a-zA-Z0-9-]+$/.test(meta.appliedId)) throw new WireError('Configure a local Gateway connection in Claude Desktop first', 409);
  return path.join(directory, `${meta.appliedId}.json`);
}
export async function desktopCatalog(mgmt: MgmtClient, profiles: ProfileStore) {
  return Promise.all((await profiles.list()).map(async profile => ({profile, models: await accountModels(mgmt, profile.authFile)})));
}
export async function readDesktop(directory = desktopDirectory) {
  const file = await desktopFile(directory);
  const cfg = await readJsonFile<Record<string, unknown>>(file, {});
  return {file, profile: /\/inference\/([^/]+)$/.exec(String(cfg.inferenceGatewayBaseUrl))?.[1] ?? '', autoMode: cfg.autoModeEnabled === true, models: cfg.inferenceModels ?? [], defaultEffort: cfg.defaultModelEffort ?? '', alwaysDefault: cfg.alwaysStartWithDefaultModel === true, gatewayUrl: cfg.inferenceGatewayBaseUrl ?? ''};
}
export async function applyDesktop(mgmt: MgmtClient, profiles: ProfileStore, proxyUrl: string, body: Record<string, unknown>, directory = desktopDirectory, origin = consoleOrigin()) {
  const models = validateModels(body.models);
  if (typeof body.alwaysDefault !== 'boolean') throw new WireError('alwaysDefault must be a boolean');
  if (typeof body.defaultEffort !== 'string' || !['','low','medium','high','xhigh','max'].includes(body.defaultEffort)) throw new WireError('Invalid default effort');
  if (typeof body.profile !== 'string' || !body.profile) throw new WireError('Choose a subscription');
  if (typeof body.autoMode !== 'boolean') throw new WireError('autoMode must be a boolean');
  const profile = await profiles.get(body.profile);
  if (!profile.authFile.startsWith('claude-')) throw new WireError('Choose a Claude subscription');
  for (const model of models) {
    if (!CLAUDE_MODELS.includes(model.name as typeof CLAUDE_MODELS[number])) throw new WireError('Use an official allowed Anthropic model ID');
    await resolveSelection(mgmt, profiles, {profile: profile.id, model: model.name});
  }
  const file = await desktopFile(directory);
  const cfg = await readJsonFile<Record<string, unknown>>(file, {});
  if (cfg.inferenceProvider !== 'gateway' || (String(cfg.inferenceGatewayBaseUrl).replace(/\/$/, '') !== proxyUrl.replace(/\/$/, '') && !isConsoleRoute(String(cfg.inferenceGatewayBaseUrl), origin))) throw new WireError('Desktop must use this console’s proxy URL before applying models', 409);
  const next: Record<string, unknown> = {...cfg, inferenceGatewayBaseUrl: subscriptionUrl(profile.id, origin), autoModeEnabled: body.autoMode, inferenceModels: models, alwaysStartWithDefaultModel: body.alwaysDefault};
  if (body.defaultEffort) next.defaultModelEffort = body.defaultEffort;
  else delete next.defaultModelEffort;
  const backup = `${file}.backup-${Date.now()}`;
  await fs.copyFile(file, backup, fs.constants.COPYFILE_EXCL);
  await fs.chmod(backup, 0o600);
  await writeJsonFile(file, next);
  return { ...await readDesktop(directory), backup, restartRequired: true };
}

function isConsoleRoute(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password && !url.search && !url.hash
      && /^\/inference\/[a-zA-Z0-9-]+$/.test(url.pathname);
  } catch { return false; }
}
