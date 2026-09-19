import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, stat, access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SettingsStore} from '../src/settings.ts';
import {consoleOrigin, consolePort} from '../src/runtime.ts';

async function fixture(run: (file: string, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'console-settings-'));
  try { await run(path.join(dir, 'settings.sqlite'), dir); }
  finally { await rm(dir, {recursive: true, force: true}); }
}

test('generic branding and both keys persist in private SQLite without appearing in public settings', async () => fixture(async file => {
  const store = new SettingsStore(file, {env: {}});
  assert.equal((await store.publicView()).displayName, 'CLIProxy Console');
  await store.update({managementKey: 'test-management-key', clientApiKey: 'test-client-key'});
  const view = await store.update({displayName: ' My Gateway '});
  assert.equal(view.displayName, 'My Gateway');
  assert.equal(view.keySource, 'sqlite');
  assert.equal(view.clientKeySource, 'sqlite');
  assert.equal(view.hasStoredClientApiKey, true);
  assert(!JSON.stringify(view).includes('test-management-key'));
  assert(!JSON.stringify(view).includes('test-client-key'));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const reloaded = await new SettingsStore(file, {env: {}}).load();
  assert.equal(reloaded.managementKey, 'test-management-key');
  assert.equal(reloaded.clientApiKey, 'test-client-key');
  assert.equal(reloaded.displayName, 'My Gateway');
}));

test('environment overrides never leak into SQLite on unrelated saves; clearing stored keys preserves overrides', async () => fixture(async file => {
  const env = {CLIPROXY_MGMT_KEY: 'environment-secret', CLIPROXY_API_KEY: 'environment-client', CLIPROXY_DISPLAY_NAME: 'Environment name', CLIPROXY_URL: 'http://localhost:9917'};
  const store = new SettingsStore(file, {env});
  await store.update({managementKey: 'saved-key', clientApiKey: 'saved-client', displayName: 'Saved name', proxyUrl: 'http://localhost:8817'});
  await store.update({routingMode: 'manual'});
  const view = await store.publicView();
  assert.equal(view.keySource, 'env');
  assert.equal(view.sources.displayName, 'env');
  assert.equal((await store.load()).clientApiKey, 'environment-client');
  const raw = (await readFile(file)).toString();
  for (const value of Object.values(env)) assert(!raw.includes(value));
  assert.equal((await new SettingsStore(file, {env: {}}).load()).managementKey, 'saved-key');
  await store.update({managementKey: '', clientApiKey: ''});
  assert.equal((await store.publicView()).hasStoredManagementKey, false);
  assert.equal((await store.load()).managementKey, 'environment-secret');
  const saved = await new SettingsStore(file, {env: {}}).load();
  assert.equal(saved.managementKey, ''); assert.equal(saved.clientApiKey, '');
  assert.equal(saved.displayName, 'Saved name'); assert.equal(saved.proxyUrl, 'http://localhost:8817');
  assert(!(await readFile(file)).includes(Buffer.from('saved-key')));
}));

test('legacy JSON migrates once with private backup, preserving names and keys without importing environment values', async () => fixture(async (file, dir) => {
  const legacyFile = path.join(dir, 'config.json');
  const legacy = {displayName: 'Existing gateway', proxyUrl: 'http://localhost:1234', managementKey: 'legacy-key', routingMode: 'manual'};
  await writeFile(legacyFile, JSON.stringify(legacy));
  const options = {legacyFile, env: {CLIPROXY_MGMT_KEY: 'override'}};
  const store = new SettingsStore(file, options);
  assert.equal((await store.load()).managementKey, 'override');
  await assert.rejects(access(legacyFile));
  assert.deepEqual(JSON.parse(await readFile(`${legacyFile}.migrated`, 'utf8')), legacy);
  assert.equal((await stat(`${legacyFile}.migrated`)).mode & 0o777, 0o600);
  assert.equal((await new SettingsStore(file, {legacyFile, env: {}}).load()).managementKey, 'legacy-key');
  await store.update({displayName: 'Updated gateway', managementKey: 'new-key'});
  assert.equal((await new SettingsStore(file, options).load()).displayName, 'Updated gateway');
  assert(!(await readFile(file)).includes(Buffer.from('override')));
}));

test('invalid migration is recoverable and never silently substitutes empty settings', async () => fixture(async (file, dir) => {
  const legacyFile = path.join(dir, 'config.json');
  await writeFile(legacyFile, '{ broken');
  const store = new SettingsStore(file, {legacyFile, env: {}});
  await assert.rejects(store.load());
  assert.equal(await readFile(legacyFile, 'utf8'), '{ broken');
  await writeFile(legacyFile, JSON.stringify({managementKey: 'recovered'}));
  assert.equal((await store.load()).managementKey, 'recovered');
}));

test('migration marker prevents stale JSON overwriting a committed database after interruption', async () => fixture(async (file, dir) => {
  const legacyFile = path.join(dir, 'config.json');
  await new SettingsStore(file, {env: {}}).update({managementKey: 'new-key'});
  await writeFile(legacyFile, JSON.stringify({managementKey: 'stale-key'}));
  const store = new SettingsStore(file, {legacyFile, env: {}});
  assert.equal((await store.load()).managementKey, 'new-key');
  assert.equal(JSON.parse(await readFile(`${legacyFile}.migrated`, 'utf8')).managementKey, 'stale-key');
}));

test('separate stores preserve unrelated updates and reject invalid patches atomically', async () => fixture(async file => {
  const a = new SettingsStore(file, {env: {}}), b = new SettingsStore(file, {env: {}});
  await a.update({displayName: 'First', managementKey: 'keep'});
  await b.load();
  await a.update({displayName: 'Second'});
  await b.update({proxyUrl: 'http://localhost:9000'});
  assert.equal((await a.load()).displayName, 'Second');
  assert.equal((await a.load()).proxyUrl, 'http://localhost:9000');
  for (const patch of [{displayName: ' '}, {displayName: 'x'.repeat(81)}, {proxyUrl: 'ftp://localhost'}, {proxyUrl: 'http://user:secret@localhost'}, {managementKey: 'bad\nkey'}, {clientApiKey: 123}, {routingMode: 'automatic'}]) {
    await assert.rejects(a.update({managementKey: 'overwrite', ...patch}));
    assert.equal((await a.load()).managementKey, 'keep');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version = 2'); db.close();
  await assert.rejects(a.load(), /newer/);
}));

test('console routes derive from configured port or loopback origin and reject remote origins', () => {
  assert.equal(consoleOrigin({PORT: '9320'}), 'http://127.0.0.1:9320');
  assert.equal(consoleOrigin({PORT: '9320', CLIPROXY_CONSOLE_URL: 'http://localhost:9320/'}), 'http://localhost:9320');
  for (const value of ['0','NaN','65536','-1']) assert.throws(() => consolePort({PORT: value}));
  for (const value of ['https://example.com', 'http://user:secret@localhost', 'http://localhost/path', 'http://localhost?key=x', 'file:///tmp/a']) assert.throws(() => consoleOrigin({CLIPROXY_CONSOLE_URL: value}));
});


test('frontend model configuration persists and rejects 200K, prefixed IDs, duplicates and invalid defaults atomically', async () => fixture(async file => {
  const store = new SettingsStore(file, {env:{}});
  const model = {id:'claude-opus-5',label:'Primary Claude',contextWindow:1000000,maxEffort:'high'};
  await store.update({claudeModels:[model],cliEffort:'high',consoleUrl:'http://localhost:9330',claudeConfigDir:'~/custom-claude'});
  const view = await new SettingsStore(file, {env:{}}).publicView();
  assert.deepEqual(view.claudeModels,[model]);assert.equal(view.consoleUrl,'http://localhost:9330');
  assert.equal(view.claudeConfigDir,path.join(os.homedir(),'custom-claude'));
  for (const models of [[],[{...model,contextWindow:200000}],[{...model,id:'account/claude-opus-5'}],[{...model,id:'claude-opus-5[1m]'}],[model,model]]) await assert.rejects(store.update({claudeModels:models}));
  await assert.rejects(store.update({cliEffort:'max'}),/effort cap/);
  assert.equal((await store.load()).cliEffort,'high');
  const override = new SettingsStore(file,{env:{CLIPROXY_CLAUDE_MODELS:JSON.stringify([{...model,label:'Environment label'}])}});
  await override.update({displayName:'Unrelated change'});
  assert.equal((await override.publicView()).sources.claudeModels,'env');
  assert.equal((await store.load()).claudeModels[0]?.label,'Primary Claude');
}));

test('role models and request retention are validated together with the model allowlist',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settings-roles-'));
 try {const store=new SettingsStore(path.join(dir,'settings.sqlite'),{env:{}});
  await store.update({claudeBackgroundModel:'claude-fable-5-1',claudeSubagentModel:'claude-opus-5',receiptRetentionDays:7});
  const view=await store.publicView();assert.equal(view.claudeBackgroundModel,'claude-fable-5-1');assert.equal(view.receiptRetentionDays,7);
  await assert.rejects(store.update({receiptRetentionDays:0}));await assert.rejects(store.update({claudeBackgroundModel:'unknown'}));
  await assert.rejects(store.update({claudeModels:[{id:'claude-opus-5',label:'Opus',contextWindow:1000000,maxEffort:'max'}]}));
 } finally {await rm(dir,{recursive:true,force:true});}
});
