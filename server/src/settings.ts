import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CONFIG_FILE, SETTINGS_DB, DESKTOP_CONFIG_DIR, CLAUDE_CONFIG_DIR, expandHome, resolveUserDir} from './paths.ts';
import {DEFAULT_CLAUDE_MODELS, validateClaudeModels, EFFORTS, type ClaudeModelOption, type Effort} from './model-config.ts';
import {consoleOrigin} from './runtime.ts';

export interface ConsoleConfig {
  displayName: string;
  proxyUrl: string;
  managementKey: string;
  clientApiKey: string;
  routingMode: 'manual';
  claudeModels: ClaudeModelOption[];
  cliEffort: Effort;
  claudeConfigDir: string;
  desktopConfigDir: string;
  consoleUrl: string;
}

export const DEFAULT_PROXY_URL = 'http://127.0.0.1:8317';
const DEFAULTS: ConsoleConfig = {
  displayName: 'CLIProxy Console', proxyUrl: DEFAULT_PROXY_URL,
  managementKey: '', clientApiKey: '', routingMode: 'manual',
  claudeModels: DEFAULT_CLAUDE_MODELS, cliEffort: 'high',
  claudeConfigDir: CLAUDE_CONFIG_DIR, desktopConfigDir: DESKTOP_CONFIG_DIR, consoleUrl: '',
};
const ENV = {
  displayName: 'CLIPROXY_DISPLAY_NAME', proxyUrl: 'CLIPROXY_URL',
  managementKey: 'CLIPROXY_MGMT_KEY', clientApiKey: 'CLIPROXY_API_KEY',
  claudeModels: 'CLIPROXY_CLAUDE_MODELS', cliEffort: 'CLIPROXY_CLI_EFFORT',
  claudeConfigDir: 'CLAUDE_CONFIG_DIR', desktopConfigDir: 'CLIPROXY_DESKTOP_CONFIG_DIR', consoleUrl: 'CLIPROXY_CONSOLE_URL',
} as const;
type Source = 'env' | 'sqlite' | 'default';
type Patch = Partial<Record<keyof ConsoleConfig, unknown>>;

/** Secrets are write-only in settings. Client setup previews may explicitly include a client key. */
export interface PublicSettings {
  displayName: string;
  proxyUrl: string;
  consoleUrl: string;
  hasManagementKey: boolean;
  hasStoredManagementKey: boolean;
  keySource: 'env' | 'sqlite' | 'none';
  hasClientApiKey: boolean;
  hasStoredClientApiKey: boolean;
  clientKeySource: 'env' | 'sqlite' | 'none';
  sources: Record<keyof typeof ENV, Source>;
  claudeModels: ClaudeModelOption[];
  cliEffort: Effort;
  claudeConfigDir: string;
  desktopConfigDir: string;
  configFile: string;
  routingMode: 'manual';
}

function invalid(message: string): never { throw Object.assign(new Error(message), {status: 400}); }

function validate(patch: Patch): Partial<ConsoleConfig> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) invalid('Settings must be an object');
  const out: Partial<ConsoleConfig> = {};
  if (patch.displayName !== undefined) {
    if (typeof patch.displayName !== 'string' || !patch.displayName.trim() || patch.displayName.trim().length > 80) invalid('Console name must contain 1–80 characters');
    out.displayName = patch.displayName.trim();
  }
  if (patch.proxyUrl !== undefined) {
    if (typeof patch.proxyUrl !== 'string') invalid('proxyUrl must be an HTTP(S) URL');
    const value = patch.proxyUrl.trim().replace(/\/+$/, '') || DEFAULT_PROXY_URL;
    let url: URL;
    try { url = new URL(value); } catch { invalid('proxyUrl must be an HTTP(S) URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) invalid('proxyUrl must be an HTTP(S) URL without credentials, query or fragment');
    out.proxyUrl = value;
  }
  for (const key of ['managementKey', 'clientApiKey'] as const) {
    if (patch[key] === undefined) continue;
    if (typeof patch[key] !== 'string' || /[\r\n\0]/.test(patch[key])) invalid(`${key} must be a single-line string`);
    out[key] = patch[key].trim();
  }
  if (patch.routingMode !== undefined && patch.routingMode !== 'manual') invalid('Invalid routing mode');
  if (patch.routingMode !== undefined) out.routingMode = 'manual';
  if (patch.claudeModels !== undefined) out.claudeModels = validateClaudeModels(patch.claudeModels);
  if (patch.cliEffort !== undefined) {
    if (!EFFORTS.includes(patch.cliEffort as Effort)) invalid('Invalid CLI effort');
    out.cliEffort = patch.cliEffort as Effort;
  }
  for (const key of ['claudeConfigDir', 'desktopConfigDir'] as const) {
    if (patch[key] === undefined) continue;
    if (typeof patch[key] !== 'string' || !patch[key].trim()) invalid(`${key} must be a directory`);
    out[key] = resolveUserDir(expandHome(patch[key] as string));
  }
  if (patch.consoleUrl !== undefined) {
    if (typeof patch.consoleUrl !== 'string') invalid('Console URL must be a string');
    try { out.consoleUrl = patch.consoleUrl.trim() ? consoleOrigin({CLIPROXY_CONSOLE_URL: patch.consoleUrl}) : ''; }
    catch { invalid('Console URL must be a loopback HTTP(S) origin without credentials or a path'); }
  }
  return out;
}

export class SettingsStore {
  readonly #file: string;
  readonly #legacyFile: string | undefined;
  readonly #env: NodeJS.ProcessEnv;

  constructor(file = SETTINGS_DB, options: {legacyFile?: string; env?: NodeJS.ProcessEnv} = {}) {
    this.#file = file;
    this.#legacyFile = options.legacyFile ?? (file === SETTINGS_DB ? CONFIG_FILE : undefined);
    this.#env = options.env ?? process.env;
  }

  get file(): string { return this.#file; }
  get consoleUrl(): string { return this.#resolve(this.#database(db => this.#read(db))).consoleUrl; }

  /** Short-lived connections avoid lingering locks; each read/update/migration is one transaction. */
  #database<T>(run: (db: DatabaseSync) => T): T {
    fs.mkdirSync(path.dirname(this.#file), {recursive: true, mode: 0o700});
    // Create with private permissions before SQLite can write a secret to it.
    fs.closeSync(fs.openSync(this.#file, 'a', 0o600));
    fs.chmodSync(this.#file, 0o600);
    const db = new DatabaseSync(this.#file);
    try {
      db.exec('PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON; BEGIN IMMEDIATE');
      const version = db.prepare('PRAGMA user_version').get()?.user_version;
      if (Number(version) > 1) throw new Error('Settings database is newer than this console; upgrade before opening it');
      db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)');
      const migrated = db.prepare('SELECT name FROM migrations WHERE name = ?').get('legacy-json');
      if (!migrated) {
        if (this.#legacyFile && fs.existsSync(this.#legacyFile)) {
          const legacy = JSON.parse(fs.readFileSync(this.#legacyFile, 'utf8'));
          if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('Legacy settings must be a JSON object');
          // Runtime environment values are deliberately absent from migration and persistence.
          const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
          for (const [key, value] of Object.entries(validate(legacy))) insert.run(key, JSON.stringify(value));
        }
        db.prepare('INSERT INTO migrations (name) VALUES (?)').run('legacy-json');
      }
      if (Number(version) !== 1) db.exec('PRAGMA user_version = 1');
      const result = run(db);
      db.exec('COMMIT');
      // A crash after COMMIT is harmless: the marker prevents importing stale values again.
      if (this.#legacyFile && fs.existsSync(this.#legacyFile)) {
        fs.chmodSync(this.#legacyFile, 0o600);
        const backup = `${this.#legacyFile}.migrated`;
        if (fs.existsSync(backup)) throw new Error('Legacy settings backup already exists; move the old JSON file aside before continuing');
        fs.renameSync(this.#legacyFile, backup);
      }
      return result;
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw err;
    } finally { db.close(); }
  }

  #read(db: DatabaseSync): Partial<ConsoleConfig> {
    return validate(Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [String(row.key), JSON.parse(String(row.value))])));
  }

  #resolve(stored: Partial<ConsoleConfig>): ConsoleConfig {
    const overrides: Patch = {};
    for (const [key, name] of Object.entries(ENV)) {
      const value = this.#env[name]?.trim();
      if (value) {
        try { overrides[key as keyof typeof ENV] = key === 'claudeModels' ? JSON.parse(value) : value; }
        catch { invalid('CLIPROXY_CLAUDE_MODELS must be a JSON model array'); }
      }
    }
    const cfg: ConsoleConfig = {...DEFAULTS, ...stored, ...validate(overrides), routingMode: 'manual'};
    cfg.consoleUrl ||= consoleOrigin(this.#env);
    if (EFFORTS.indexOf(cfg.cliEffort) > EFFORTS.indexOf(cfg.claudeModels[0]!.maxEffort)) invalid('Default CLI effort exceeds the first model’s effort cap');
    return cfg;
  }

  async load(): Promise<ConsoleConfig> {
    return this.#resolve(this.#database(db => this.#read(db)));
  }

  async publicView(): Promise<PublicSettings> {
    const stored = this.#database(db => this.#read(db));
    const cfg = this.#resolve(stored);
    const source = (key: keyof typeof ENV): Source => this.#env[ENV[key]]?.trim() ? 'env' : stored[key] ? 'sqlite' : 'default';
    return {
      displayName: cfg.displayName, proxyUrl: cfg.proxyUrl, consoleUrl: cfg.consoleUrl,
      claudeModels: cfg.claudeModels, cliEffort: cfg.cliEffort, claudeConfigDir: cfg.claudeConfigDir, desktopConfigDir: cfg.desktopConfigDir,
      routingMode: 'manual', configFile: this.#file,
      hasManagementKey: !!cfg.managementKey, hasStoredManagementKey: !!stored.managementKey,
      keySource: cfg.managementKey ? source('managementKey') as 'env' | 'sqlite' : 'none',
      hasClientApiKey: !!cfg.clientApiKey, hasStoredClientApiKey: !!stored.clientApiKey,
      clientKeySource: cfg.clientApiKey ? source('clientApiKey') as 'env' | 'sqlite' : 'none',
      sources: Object.fromEntries(Object.keys(ENV).map(key => [key, source(key as keyof typeof ENV)])) as PublicSettings['sources'],
    };
  }

  /** Only explicitly supplied fields are written. Empty keys clear saved values; env overrides remain. */
  async update(patch: Patch): Promise<PublicSettings> {
    const values = validate(patch);
    this.#database(db => {
      this.#resolve({...this.#read(db),...values});
      const write = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      for (const [key, value] of Object.entries(values)) write.run(key, JSON.stringify(value));
    });
    return this.publicView();
  }
}
