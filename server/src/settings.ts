import { CONFIG_FILE } from './paths.ts';
import { readJsonFile, writeJsonFile } from './json-store.ts';

export interface ConsoleConfig {
  displayName: string;
  proxyUrl: string;
  managementKey: string;
  routingMode: 'manual';
}

export const DEFAULT_PROXY_URL = 'http://127.0.0.1:8317';

const DEFAULTS: ConsoleConfig = { displayName: 'CLIProxy Console', proxyUrl: DEFAULT_PROXY_URL, managementKey: '', routingMode: 'manual' };

/** What the browser is allowed to know. The key itself never leaves this process. */
export interface PublicSettings {
  displayName: string;
  proxyUrl: string;
  hasManagementKey: boolean;
  keySource: 'env' | 'file' | 'none';
  configFile: string;
  routingMode: 'manual';
}

function normaliseDisplayName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    throw Object.assign(new Error('Console name must contain 1–80 characters'), {status: 400});
  }
  return value.trim();
}

function normaliseProxyUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_PROXY_URL;
  const trimmed = value.trim().replace(/\/+$/, '');
  const url = new URL(trimmed); // throws on garbage, which the caller turns into a 400
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('proxyUrl must be http or https');
  }
  return trimmed;
}

export class SettingsStore {
  #cached: ConsoleConfig | null = null;
  readonly #file: string;

  constructor(file: string = CONFIG_FILE) {
    this.#file = file;
  }

  get file(): string {
    return this.#file;
  }

  async load(): Promise<ConsoleConfig> {
    if (this.#cached) return this.#cached;
    const onDisk = await readJsonFile<Partial<ConsoleConfig>>(this.#file, {});
    const envKey = (process.env['CLIPROXY_MGMT_KEY'] ?? '').trim();
    const envUrl = (process.env['CLIPROXY_URL'] ?? '').trim();
    this.#cached = {
      displayName: typeof onDisk.displayName === 'string' && onDisk.displayName.trim() ? onDisk.displayName.trim() : DEFAULTS.displayName,
      routingMode: 'manual',
      proxyUrl: envUrl || (typeof onDisk.proxyUrl === 'string' && onDisk.proxyUrl ? onDisk.proxyUrl : DEFAULTS.proxyUrl),
      managementKey: envKey || (typeof onDisk.managementKey === 'string' ? onDisk.managementKey : ''),
    };
    return this.#cached;
  }

  async publicView(): Promise<PublicSettings> {
    const cfg = await this.load();
    const fromEnv = (process.env['CLIPROXY_MGMT_KEY'] ?? '').trim() !== '';
    return {
      displayName: cfg.displayName,
      proxyUrl: cfg.proxyUrl,
      routingMode: cfg.routingMode,
      hasManagementKey: cfg.managementKey !== '',
      keySource: cfg.managementKey === '' ? 'none' : fromEnv ? 'env' : 'file',
      configFile: this.#file,
    };
  }

  /**
   * Update settings. `managementKey` is write-only: omitting it keeps the stored key,
   * passing an empty string clears it. The env var always wins for the live value.
   */
  async update(patch: { displayName?: unknown; proxyUrl?: unknown; managementKey?: unknown; routingMode?: unknown }): Promise<PublicSettings> {
    const current = await this.load();
    const next: ConsoleConfig = { ...current };
    if (patch.displayName !== undefined) next.displayName = normaliseDisplayName(patch.displayName);
    if (patch.proxyUrl !== undefined) next.proxyUrl = normaliseProxyUrl(patch.proxyUrl);
    if (patch.managementKey !== undefined) {
      if (typeof patch.managementKey !== 'string') throw new Error('managementKey must be a string');
      next.managementKey = patch.managementKey.trim();
    }
    if (patch.routingMode !== undefined) {
      if (patch.routingMode !== 'manual') throw Object.assign(new Error('Invalid routing mode'), {status: 400});
      next.routingMode = patch.routingMode;
    }
    await writeJsonFile(this.#file, next);
    this.#cached = null;
    return this.publicView();
  }
}
