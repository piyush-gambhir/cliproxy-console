import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProfileStore, type ProfileError } from '../src/profiles.ts';

let dir: string;
let store: ProfileStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cliproxy-profiles-'));
  store = new ProfileStore(path.join(dir, 'profiles.json'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('ProfileStore', () => {
  test('starts empty when the file does not exist', async () => {
    assert.deepEqual(await store.list(), []);
  });

  test('creates a profile with an id, colour and timestamp', async () => {
    const p = await store.create({ name: 'Work', authFile: 'claude-work.json' });
    assert.equal(p.name, 'Work');
    assert.equal(p.authFile, 'claude-work.json');
    assert.match(p.id, /^[0-9a-f-]{36}$/);
    assert.match(p.color, /^#[0-9a-f]{6}$/);
    assert.equal(Number.isNaN(Date.parse(p.createdAt)), false);
    assert.deepEqual(await store.list(), [p]);
  });

  test('persists across store instances', async () => {
    const p = await store.create({ name: 'Work', authFile: 'a.json' });
    const reopened = new ProfileStore(path.join(dir, 'profiles.json'));
    assert.deepEqual(await reopened.list(), [p]);
  });

  test('requires name and authFile', async () => {
    await assert.rejects(store.create({ authFile: 'a.json' }), /name is required/);
    await assert.rejects(store.create({ name: 'x' }), /authFile is required/);
  });

  test('refuses a duplicate auth file or name', async () => {
    await store.create({ name: 'Work', authFile: 'a.json' });
    await assert.rejects(store.create({ name: 'Other', authFile: 'a.json' }), /already has a profile/);
    await assert.rejects(store.create({ name: 'work', authFile: 'b.json' }), /already exists/);
  });

  test('validates colour', async () => {
    await assert.rejects(store.create({ name: 'x', authFile: 'a.json', color: 'red' }), /#rrggbb/);
    const p = await store.create({ name: 'x', authFile: 'a.json', color: '#AABBCC' });
    assert.equal(p.color, '#aabbcc');
  });

  test('stores the prefix the console last wrote', async () => {
    const p = await store.create({ name: 'x', authFile: 'a.json', prefix: 'work' });
    assert.equal(p.lastKnownPrefix, 'work');
    const cleared = await store.update(p.id, { lastKnownPrefix: '' });
    assert.equal(cleared.lastKnownPrefix, undefined);
  });

  test('updates name and colour without disturbing the mapping', async () => {
    const p = await store.create({ name: 'Work', authFile: 'a.json' });
    const updated = await store.update(p.id, { name: 'Day job', color: '#123456' });
    assert.equal(updated.name, 'Day job');
    assert.equal(updated.color, '#123456');
    assert.equal(updated.authFile, 'a.json');
    assert.equal(updated.id, p.id);
    assert.equal(updated.createdAt, p.createdAt);
  });

  test('refuses to rename onto another profile name', async () => {
    await store.create({ name: 'Work', authFile: 'a.json' });
    const other = await store.create({ name: 'Play', authFile: 'b.json' });
    await assert.rejects(store.update(other.id, { name: 'work' }), /already exists/);
  });

  test('404s on unknown ids', async () => {
    const is404 = (err: unknown) => (err as ProfileError).status === 404;
    await assert.rejects(store.get('nope'), is404);
    await assert.rejects(store.update('nope', { name: 'x' }), is404);
    await assert.rejects(store.remove('nope'), is404);
  });

  test('removes only the named profile', async () => {
    const a = await store.create({ name: 'A', authFile: 'a.json' });
    const b = await store.create({ name: 'B', authFile: 'b.json' });
    const removed = await store.remove(a.id);
    assert.equal(removed.id, a.id);
    assert.deepEqual(await store.list(), [b]);
  });
});
