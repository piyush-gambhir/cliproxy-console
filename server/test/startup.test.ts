import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {StartupStore, prepareStartup, readStartup} from '../src/startup.ts';

function fixture(run:(home:string)=>void) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'console-startup-'));
  try{run(home);}finally{fs.rmSync(home,{recursive:true,force:true});}
}
test('startup edits are pending until restart, can be cancelled, and preserve the running configuration',()=>fixture(home=>{
  const store=new StartupStore({},home);
  const initial=store.view();assert.equal(initial.restartRequired,false);
  let view=store.update({port:9320});assert.equal(view.next.port,9320);assert.equal(view.running.port,8320);assert.equal(view.restartRequired,true);
  assert.equal(fs.statSync(store.file).mode&0o777,0o600);
  view=store.update(initial.running);assert.equal(view.restartRequired,false);
  store.update({port:9420});assert.equal(prepareStartup({},home).port,9420);
}));
test('storage relocation copies database and other state at startup and keeps originals',()=>fixture(home=>{
  const store=new StartupStore({},home),before=store.running;
  fs.mkdirSync(before.dataDir,{recursive:true});
  fs.writeFileSync(before.settingsDb,'database-fixture',{mode:0o600});
  fs.writeFileSync(path.join(before.dataDir,'profiles.json'),'profiles-fixture',{mode:0o600});
  const dataDir=path.join(home,'moved'),settingsDb=path.join(dataDir,'settings.sqlite');
  store.update({dataDir,settingsDb});assert(!fs.existsSync(dataDir));
  prepareStartup({},home);
  assert.equal(fs.readFileSync(settingsDb,'utf8'),'database-fixture');
  assert.equal(fs.readFileSync(path.join(dataDir,'profiles.json'),'utf8'),'profiles-fixture');
  assert.equal(fs.readFileSync(before.settingsDb,'utf8'),'database-fixture');
  assert.equal(fs.statSync(settingsDb).mode&0o777,0o600);
  assert.equal(fs.statSync(dataDir).mode&0o777,0o700);
  assert.equal(new StartupStore({},home).view().restartRequired,false);
  prepareStartup({},home); // idempotent
}));
test('database-only relocation works without moving profiles',()=>fixture(home=>{
  const store=new StartupStore({},home);fs.mkdirSync(store.running.dataDir,{recursive:true});
  fs.writeFileSync(store.running.settingsDb,'private-settings');
  const settingsDb=path.join(home,'db/console.sqlite');store.update({settingsDb});prepareStartup({},home);
  assert.equal(fs.readFileSync(settingsDb,'utf8'),'private-settings');
  assert.equal(readStartup({},home).dataDir,store.running.dataDir);
}));
test('migration refuses a destination created after save rather than overwrite it',()=>fixture(home=>{
  const store=new StartupStore({},home);fs.mkdirSync(store.running.dataDir,{recursive:true});fs.writeFileSync(store.running.settingsDb,'source');
  const dataDir=path.join(home,'destination');store.update({dataDir,settingsDb:path.join(dataDir,'settings.sqlite')});
  fs.mkdirSync(dataDir);fs.writeFileSync(path.join(dataDir,'keep'),'untouched');
  assert.throws(()=>prepareStartup({},home),/refusing/);assert.equal(fs.readFileSync(path.join(dataDir,'keep'),'utf8'),'untouched');
}));
test('startup validates ranges, overlapping paths, existing destinations, and environment locks',()=>fixture(home=>{
  const store=new StartupStore({},home);fs.mkdirSync(store.running.dataDir,{recursive:true});
  for(const port of [0,65536,-1,1.5,'9320'])assert.throws(()=>store.update({port}));
  for(const dataDir of [home,'/tmp',path.join(store.running.dataDir,'nested'),path.join(home,'.claude/data')])assert.throws(()=>store.update({dataDir}));
  const existing=path.join(home,'existing.sqlite');fs.writeFileSync(existing,'keep');assert.throws(()=>store.update({settingsDb:existing}));
  const linked=path.join(home,'linked-data');fs.symlinkSync(store.running.dataDir,linked);
  assert.throws(()=>store.update({dataDir:path.join(linked,'nested')}),/inside the current/);
  const outside=path.join(home,'outside');fs.symlinkSync(path.dirname(home),outside);
  assert.throws(()=>store.update({dataDir:path.join(outside,'new-console')}),/home directory/);
  const envStore=new StartupStore({PORT:'9320'},home);assert.equal(envStore.view().sources.port,'env');assert.throws(()=>envStore.update({port:9420}),/environment/);
}));
