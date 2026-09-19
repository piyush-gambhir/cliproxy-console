import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveUserDir, tildify } from './paths.ts';
import {writeJsonFile} from './json-store.ts';

export type WireTarget = 'project' | 'profile-global';

export const MODEL_DEFAULT_KEYS = ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL'] as const;

export interface WireEnv {
  [key: string]: string;
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_MODEL: string;
}

export interface WirePlan {
  /** Absolute path of the settings.json that would be written. */
  file: string;
  /** Same path, shortened with `~` for display. */
  displayFile: string;
  /** The env block the console contributes. */
  env: WireEnv;
  /** The whole settings.json after merging — what gets written, and what the UI shows. */
  merged: Record<string, unknown>;
  /** True when the file already exists and will be backed up. */
  fileExists: boolean;
  /** Keys inside `env` that already had a different value and would be overwritten. */
  overwrites: string[];
}

export interface WireInput {
  target: WireTarget;
  /** Repo directory (project) or Claude config directory (profile-global). */
  path: string;
  model: string;
  /** The credential prefix, if the profile's auth file has one. */
  prefix?: string;
  proxyUrl: string;
  apiKey: string;
  pinModelDefaults?: boolean;
  backgroundModel?: string;
  subagentModel?: string;
}

export class WireError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** `<prefix>/<model>` when the credential has a prefix, else the bare model id. */
export function addressableModel(model: string, prefix?: string): string {
  const m = model.trim();
  const p = (prefix ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (m === '') throw new WireError('model is required');
  return p === '' ? m : `${p}/${m}`;
}

/**
 * A prefix is one path segment: the file loaders drop any prefix containing a slash
 * (sdk/auth/filestore.go:323-329), even though PATCH /auth-files/fields would accept it.
 */
export function assertValidPrefix(prefix: string): void {
  const value = prefix.trim();
  if (value === '') return;
  if (value.includes('/')) {
    throw new WireError('prefix cannot contain "/" — the proxy drops such a prefix on restart');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new WireError('prefix may only contain letters, digits, dot, dash and underscore');
  }
}

/** Where the settings.json for a target lives. */
export function settingsFileFor(target: WireTarget, dir: string): string {
  const base = resolveUserDir(dir);
  if (target === 'project') return path.join(base, '.claude', 'settings.json');
  if (target === 'profile-global') return path.join(base, 'settings.json');
  throw new WireError(`unknown target ${String(target)}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildEnv(input: WireInput): WireEnv {
  if (!input.apiKey || input.apiKey.trim() === '') throw new WireError('apiKey is required');
  if (!input.proxyUrl || input.proxyUrl.trim() === '') throw new WireError('proxyUrl is required');
  if (input.prefix) assertValidPrefix(input.prefix);
  return {
    ANTHROPIC_BASE_URL: input.proxyUrl.trim().replace(/\/+$/, ''),
    ANTHROPIC_AUTH_TOKEN: input.apiKey.trim(),
    ANTHROPIC_MODEL: addressableModel(input.model, input.prefix),
    ...(input.model.endsWith('[1m]') ? {CLAUDE_CODE_DISABLE_1M_CONTEXT:'0'} : {}),
    ...(input.pinModelDefaults ? Object.fromEntries(MODEL_DEFAULT_KEYS.map(key => [key, addressableModel(roleModel(key,input), input.prefix)])) : {}),
  };
}

/** Merge the env block into an existing settings object without clobbering anything else. */
export function mergeSettings(
  existing: Record<string, unknown>,
  env: WireEnv,
): { merged: Record<string, unknown>; overwrites: string[] } {
  const currentEnv = isPlainObject(existing['env']) ? (existing['env'] as Record<string, unknown>) : {};
  const overwrites: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    const prev = currentEnv[key];
    if (prev !== undefined && prev !== value) overwrites.push(key);
  }
  return {
    merged: { ...existing, env: { ...currentEnv, ...env } },
    overwrites,
  };
}

async function readExistingSettings(file: string): Promise<{ data: Record<string, unknown>; exists: boolean }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { data: {}, exists: false };
    throw err;
  }
  if (raw.trim() === '') return { data: {}, exists: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WireError(`${file} is not valid JSON — fix or move it before wiring`, 409);
  }
  if (!isPlainObject(parsed)) {
    throw new WireError(`${file} does not contain a JSON object`, 409);
  }
  return { data: parsed, exists: true };
}

/** Work out exactly what a write would do, without touching the disk. */
export async function planWire(input: WireInput): Promise<WirePlan> {
  const file = settingsFileFor(input.target, input.path);
  const env = buildEnv(input);
  const { data, exists } = await readExistingSettings(file);
  const { merged, overwrites } = mergeSettings(data, env);
  return { file, displayFile: tildify(file), env, merged, fileExists: exists, overwrites };
}

export interface WireResult extends WirePlan {
  backupFile: string | null;
  displayBackupFile: string | null;
}

/** Back up (if present) and write. Returns the final JSON for display. */
export async function applyWire(input: WireInput, now: Date = new Date()): Promise<WireResult> {
  const plan = await planWire(input);
  let backupFile: string | null = null;
  if (plan.fileExists) {
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    backupFile = `${plan.file}.bak-${stamp}`;
    await fs.copyFile(plan.file, backupFile);
    await fs.chmod(backupFile, 0o600);
  }
  await writeJsonFile(plan.file, plan.merged);
  return {
    ...plan,
    backupFile,
    displayBackupFile: backupFile ? tildify(backupFile) : null,
  };
}

/** A zsh function the user can paste into their own rc file. Nothing is executed here. */
export function zshSnippet(opts: {
  functionName: string;
  proxyUrl: string;
  model: string;
  prefix?: string;
  pinModelDefaults?: boolean;
  backgroundModel?: string;
  subagentModel?: string;
}): string {
  const model = addressableModel(opts.model, opts.prefix);
  const name = opts.functionName.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'cliproxy';
  const fn = /^[A-Za-z_]/.test(name) ? name : `cliproxy-${name}`;
  const base = opts.proxyUrl.replace(/\/+$/, '');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  // Env vars are scoped to the single `claude` invocation on purpose: exporting them
  // would make every later plain `claude` in the same shell go through the proxy too.
  return [
    `# cliproxy-console: run Claude Code with profile ${fn}`,
    `# Proxy vars apply only to this call; plain \`claude\` stays direct.`,
    `${fn}() {`,
    `  ANTHROPIC_BASE_URL=${quote(base)} \\`,
    '  ANTHROPIC_AUTH_TOKEN="${CLIPROXY_API_KEY:?Set CLIPROXY_API_KEY to a proxy client key first}" \\',
    `  ANTHROPIC_MODEL=${quote(model)} \\`,
    ...(model.endsWith('[1m]') ? ['  CLAUDE_CODE_DISABLE_1M_CONTEXT=0 \\'] : []),
    ...(opts.pinModelDefaults ? MODEL_DEFAULT_KEYS.map(key => `  ${key}=${quote(addressableModel(roleModel(key,opts),opts.prefix))} \\`) : []),
    `  claude "$@"`,
    `}`,
  ].join('\n');
}

function roleModel(key: string, input: {model:string;backgroundModel?:string;subagentModel?:string}):string {
  if(key==='CLAUDE_CODE_SUBAGENT_MODEL') return input.subagentModel || input.model;
  if(key==='ANTHROPIC_DEFAULT_HAIKU_MODEL'||key==='ANTHROPIC_SMALL_FAST_MODEL') return input.backgroundModel || input.model;
  return input.model;
}
