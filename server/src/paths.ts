import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

/** Where the console keeps its own state. Never the proxy's auth dir or config. */
export const CONSOLE_DIR = path.join(HOME, '.cliproxy-console');
export const CONFIG_FILE = path.join(CONSOLE_DIR, 'config.json');
export const PROFILES_FILE = path.join(CONSOLE_DIR, 'profiles.json');
export const RECENTS_FILE = path.join(CONSOLE_DIR, 'recent-paths.json');

/** Directories the console must never touch, even though they live under $HOME. */
export const FORBIDDEN_PREFIXES = [
  path.join(HOME, '.cli-proxy-api'),
  '/opt/homebrew/etc/cliproxyapi.conf',
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
