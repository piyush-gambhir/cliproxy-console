import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

/** Where the console keeps its own state. Never the proxy's auth dir or config. */
export const CONSOLE_DIR = expandHome(process.env['CLIPROXY_DATA_DIR'] || path.join(HOME, '.cliproxy-console'));
export const CONFIG_FILE = path.join(CONSOLE_DIR, 'config.json');
export const SETTINGS_DB = expandHome(process.env['CLIPROXY_SETTINGS_DB'] || path.join(CONSOLE_DIR, 'settings.sqlite'));
export const PROFILES_FILE = path.join(CONSOLE_DIR, 'profiles.json');
export const RECENTS_FILE = path.join(CONSOLE_DIR, 'recent-paths.json');
export const USAGE_FILE = path.join(CONSOLE_DIR, 'subscription-usage.json');
export const CLAUDE_CONFIG_DIR = expandHome(process.env['CLAUDE_CONFIG_DIR'] || path.join(HOME, '.claude'));
export const DESKTOP_CONFIG_DIR = expandHome(process.env['CLIPROXY_DESKTOP_CONFIG_DIR'] || path.join(HOME, 'Library/Application Support/Claude-3p/configLibrary'));

/** Directories the console must never touch, even though they live under $HOME. */
export const FORBIDDEN_PREFIXES = [
  path.join(HOME, '.cli-proxy-api'),
  expandHome(process.env['CLIPROXY_AUTH_DIR'] || path.join(HOME, '.cli-proxy-api')),
  CONSOLE_DIR,
  SETTINGS_DB,
  ...(process.env['CLIPROXY_CONFIG'] ? [expandHome(process.env['CLIPROXY_CONFIG'])] : []),
  '/opt/homebrew/etc/cliproxyapi.conf',
  '/usr/local/etc/cliproxyapi.conf',
];

export class PathError extends Error {}

/** Expand a leading `~`, then make the path absolute and normalised. */
export function expandHome(input: string): string {
  const raw = input.trim();
  if (raw === '~') return HOME;
  if (raw.startsWith('~/')) return path.join(HOME, raw.slice(2));
  return path.resolve(raw);
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a user-supplied directory and refuse anything outside $HOME, anything
 * holding proxy credentials, and anything that is not a plain path.
 */
export function resolveUserDir(input: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new PathError('path is required');
  }
  if (input.includes('\0')) throw new PathError('path contains a null byte');
  const resolved = expandHome(input);
  if (!isInside(HOME, resolved)) {
    throw new PathError(`path must be inside ${HOME}`);
  }
  for (const forbidden of FORBIDDEN_PREFIXES) {
    if (isInside(forbidden, resolved)) {
      throw new PathError(`${resolved} holds proxy credentials and is off limits`);
    }
  }
  return resolved;
}

/** Collapse an absolute path back to `~/…` for display. */
export function tildify(abs: string): string {
  if (abs === HOME) return '~';
  return isInside(HOME, abs) ? `~/${path.relative(HOME, abs)}` : abs;
}
