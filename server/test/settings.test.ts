import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SettingsStore} from '../src/settings.ts';

test('branding is local, persists across reloads, and does not reveal or replace the management key', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'console-settings-'));
  try {
    const file = path.join(dir, 'config.json');
    const store = new SettingsStore(file);
    assert.equal((await store.publicView()).displayName, 'CLIProxy Console');
    await store.update({managementKey: 'test-management-key'});
    const view = await store.update({displayName: ' My Gateway '});
    assert.equal(view.displayName, 'My Gateway');
    assert.equal('managementKey' in view, false);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).managementKey, 'test-management-key');
    assert.equal((await new SettingsStore(file).publicView()).displayName, 'My Gateway');
    await assert.rejects(() => store.update({displayName: ' '}));
    await assert.rejects(() => store.update({displayName: 'x'.repeat(81)}));
  } finally { await rm(dir, {recursive: true, force: true}); }
});
