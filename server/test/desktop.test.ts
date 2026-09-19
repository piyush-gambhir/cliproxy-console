import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {applyDesktop, validateModels, desktopFile} from '../src/desktop.ts';
import type {MgmtClient} from '../src/mgmt.ts';
import type {ProfileStore} from '../src/profiles.ts';

test('desktop rejects duplicate and empty model lists and invalid effort', () => {
  assert.throws(() => validateModels([]));
  assert.throws(() => validateModels([{name:'a',labelOverride:'A'},{name:'a',labelOverride:'B'}]));
  assert.throws(() => validateModels([{name:'a',labelOverride:'A',maxEffort:'invalid'}]));
});
test('desktop validates isolation and preserves credentials with a backup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'desktop-models-'));
  try {
    await fs.writeFile(path.join(dir,'_meta.json'), JSON.stringify({appliedId:'test'}));
    const file = path.join(dir,'test.json');
    const original = {inferenceProvider:'gateway',inferenceGatewayBaseUrl:'http://127.0.0.1:8317',inferenceGatewayApiKey:'secret',other:'preserve'};
    await fs.writeFile(file, JSON.stringify(original));
    const profile = {id:'a',authFile:'claude-a.json',lastKnownPrefix:'a'};
    const profiles = {list:async()=>[profile],get:async()=>profile} as unknown as ProfileStore;
    let collision = false;
    const mgmt = {json:async(_method:string,route:string,query:string) => route === 'auth-files' ? {files:[{name:'claude-a.json'},{name:'b.json'}]} : {models: query.includes('claude-a.json') || collision ? [{id:'a/claude-opus-5'}] : []}} as unknown as MgmtClient;
    const body = {profile:'a',autoMode:true,models:[{name:'claude-opus-5',labelOverride:'Claude Opus 5',supports1m:true,prefer1m:true}],alwaysDefault:true,defaultEffort:'high'};
    collision = true;
    await assert.rejects(applyDesktop(mgmt,profiles,'http://127.0.0.1:8317',body,dir), /shared/);
    assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')), original);
    collision = false;
    const result = await applyDesktop(mgmt,profiles,'http://127.0.0.1:8317',body,dir,'http://localhost:9320');
    const next = JSON.parse(await fs.readFile(file,'utf8'));
    assert.equal(next.inferenceGatewayBaseUrl,'http://localhost:9320/inference/a'); assert.equal(next.autoModeEnabled,true);
    assert.equal(next.inferenceGatewayApiKey,'secret'); assert.equal(next.other,'preserve');
    assert.deepEqual(next.inferenceModels,body.models.map(m => ({...m,maxEffort:'max'})));
    assert.equal(next.modelDiscoveryEnabled,false); assert.equal(next.modelPrefer1mContext,true);
    assert.deepEqual(JSON.parse(await fs.readFile(result.backup,'utf8')),original);
    assert.ok(!JSON.stringify(result).includes('secret'));
    await applyDesktop(mgmt,profiles,'http://127.0.0.1:8317',body,dir,'http://localhost:9320');
    await assert.rejects(applyDesktop(mgmt,profiles,'http://127.0.0.1:8317',body,dir,'http://localhost:9321'), /proxy URL/);
    await fs.writeFile(path.join(dir,'_meta.json'), JSON.stringify({appliedId:'../escape'}));
    await assert.rejects(desktopFile(dir));
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
