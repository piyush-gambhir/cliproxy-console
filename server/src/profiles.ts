import { randomUUID } from 'node:crypto';
import { PROFILES_FILE } from './paths.ts';
import { readJsonFile, writeJsonFile } from './json-store.ts';

/**
 * A profile is only a display-name mapping. Everything the proxy owns about an account
 * (prefix, priority, weight, note, disabled) lives in the proxy and is edited through
 * PATCH /auth-files/fields — with one exception: `lastKnownPrefix`, a cache of the prefix
 * this console last wrote, because the Management API never reads a prefix back.
 * See mgmt-contract.ts -> ENDPOINTS.listAuthFiles.notes.
 */
export interface Profile {
  id: string;
  name: string;
  authFile: string;
  color: string;
  createdAt: string;
  lastKnownPrefix?: string;
  resetAt?: string;
  subscriptionNote?: string;
}

export const PROFILE_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#a855f7', '#14b8a6', '#f43f5e',
] as const;

export class ProfileError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProfileError(`${field} is required`);
  }
  return value.trim();
}

function normaliseColor(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    throw new ProfileError('color must be a #rrggbb hex string');
  }
  return value.trim().toLowerCase();
}

export class ProfileStore {
  readonly #file: string;

  constructor(file: string = PROFILES_FILE) {
    this.#file = file;
  }

  async list(): Promise<Profile[]> {
    const data = await readJsonFile<{ profiles?: Profile[] }>(this.#file, {});
    return Array.isArray(data.profiles) ? data.profiles : [];
  }

  async get(id: string): Promise<Profile> {
    const found = (await this.list()).find((p) => p.id === id);
    if (!found) throw new ProfileError(`profile ${id} not found`, 404);
    return found;
  }

  async #save(profiles: Profile[]): Promise<void> {
    await writeJsonFile(this.#file, { profiles });
  }

  async create(input: { name?: unknown; authFile?: unknown; color?: unknown; prefix?: unknown }): Promise<Profile> {
    const profiles = await this.list();
    const name = nonEmptyString(input.name, 'name');
    const authFile = nonEmptyString(input.authFile, 'authFile');
    if (profiles.some((p) => p.authFile === authFile)) {
      throw new ProfileError(`auth file ${authFile} already has a profile`, 409);
    }
    if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new ProfileError(`a profile named ${name} already exists`, 409);
    }
    const fallbackColor = PROFILE_COLORS[profiles.length % PROFILE_COLORS.length] as string;
    const profile: Profile = {
      id: randomUUID(),
      name,
      authFile,
      color: normaliseColor(input.color, fallbackColor),
      createdAt: new Date().toISOString(),
    };
    if (typeof input.prefix === 'string' && input.prefix.trim() !== '') {
      profile.lastKnownPrefix = input.prefix.trim();
    }
    await this.#save([...profiles, profile]);
    return profile;
  }

  async update(
    id: string,
    patch: { name?: unknown; color?: unknown; authFile?: unknown; lastKnownPrefix?: unknown; resetAt?: unknown; subscriptionNote?: unknown },
  ): Promise<Profile> {
    const profiles = await this.list();
    const index = profiles.findIndex((p) => p.id === id);
    if (index < 0) throw new ProfileError(`profile ${id} not found`, 404);
    const current = profiles[index] as Profile;
    const next: Profile = { ...current };
    if (patch.name !== undefined) {
      const name = nonEmptyString(patch.name, 'name');
      if (profiles.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
        throw new ProfileError(`a profile named ${name} already exists`, 409);
      }
      next.name = name;
    }
    if (patch.color !== undefined) next.color = normaliseColor(patch.color, current.color);
    if (patch.authFile !== undefined) {
      const authFile = nonEmptyString(patch.authFile, 'authFile');
      if (profiles.some((p) => p.id !== id && p.authFile === authFile)) {
        throw new ProfileError(`auth file ${authFile} already has a profile`, 409);
      }
      next.authFile = authFile;
    }
    if (patch.lastKnownPrefix !== undefined) {
      if (patch.lastKnownPrefix === null || patch.lastKnownPrefix === '') {
        delete next.lastKnownPrefix;
      } else if (typeof patch.lastKnownPrefix === 'string') {
        next.lastKnownPrefix = patch.lastKnownPrefix.trim();
      } else {
        throw new ProfileError('lastKnownPrefix must be a string or null');
      }
    }
    if (patch.resetAt !== undefined) {
      if (patch.resetAt === '' || patch.resetAt === null) delete next.resetAt;
      else if (typeof patch.resetAt !== 'string' || !Number.isFinite(Date.parse(patch.resetAt))) throw new ProfileError('Reset date must be a valid date');
      else next.resetAt = new Date(patch.resetAt).toISOString();
    }
    if (patch.subscriptionNote !== undefined) {
      if (typeof patch.subscriptionNote !== 'string' || patch.subscriptionNote.length > 500) throw new ProfileError('Subscription note must be at most 500 characters');
      next.subscriptionNote = patch.subscriptionNote.trim();
    }
    profiles[index] = next;
    await this.#save(profiles);
    return next;
  }

  async remove(id: string): Promise<Profile> {
    const profiles = await this.list();
    const index = profiles.findIndex((p) => p.id === id);
    if (index < 0) throw new ProfileError(`profile ${id} not found`, 404);
    const [removed] = profiles.splice(index, 1);
    await this.#save(profiles);
    return removed as Profile;
  }
}
