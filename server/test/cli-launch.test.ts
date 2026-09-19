import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SettingsStore} from '../src/settings.ts';
import {cliLaunch} from '../src/cli-launch.ts';
import {applyRoleSettings,roleSettingsMatch} from '../src/role-settings.ts';
import type {Profile} from '../src/profiles.ts';
test('CLI uses saved manual subscription and independent role defaults without the console',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cli-launch-'));
 try{
  const store=new SettingsStore(path.join(dir,'settings.sqlite'),{env:{}});
  await store.update({cliProfile:'account-a',clientApiKey:'fake-client-key',claudeBackgroundModel:'claude-fable-5-1'});
  const cfg=await store.load();const profiles=[{id:'account-a',name:'One',authFile:'claude-one.json'},{id:'account-b',name:'Two',authFile:'claude-two.json'}] as Profile[];
  let plan=await cliLaunch(cfg,profiles,[],{ANTHROPIC_API_KEY:'old',CLAUDE_CODE_OAUTH_TOKEN:'old',ANTHROPIC_SMALL_FAST_MODEL:'old'});
  assert.equal(plan.profile,'account-a');assert.equal(plan.env.ANTHROPIC_BASE_URL,`${cfg.proxyUrl}/inference/account-a`);assert.equal(plan.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,'claude-fable-5-1[1m]');assert.equal(plan.env.CLAUDE_CODE_SUBAGENT_MODEL,'claude-opus-5[1m]');assert.equal(plan.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);assert.deepEqual(plan.args,['--model','claude-opus-5[1m]','--effort','high']);
  plan=await cliLaunch(cfg,profiles,['--subscription=Two','--model','fable','--effort','max','-p','hello'],{});assert.equal(plan.profile,'account-b');assert.equal(plan.model,'claude-fable-5-1');assert.equal(plan.args.filter(a=>a==='--effort').length,1);
  for(const args of [['--subscription','missing'],['--model','unknown'],['--remote-control'],['--fallback-model','opus']])await assert.rejects(cliLaunch(cfg,profiles,args,{}));
  await assert.rejects(cliLaunch({...cfg,proxyUrl:'https://example.com'},profiles,[],{}),/loopback/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('shared role settings retain other data, remove deprecated overrides and create a private backup',async()=>{
 const dir=await fs.mkdtemp(path.join(os.homedir(),'.cliproxy-roles-test-'));
 try{const file=path.join(dir,'settings.json');const original={effortLevel:'high',permissions:{defaultMode:'acceptEdits'},env:{OTHER:'keep',ANTHROPIC_SMALL_FAST_MODEL:'old'}};
  await fs.writeFile(file,JSON.stringify(original));assert.equal(await roleSettingsMatch(dir,'claude-opus-5'),false);
  const result=await applyRoleSettings(dir,'claude-opus-5','claude-fable-5-1');const next=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(next.env.OTHER,'keep');assert.deepEqual(next.permissions,original.permissions);assert.equal(next.env.ANTHROPIC_SMALL_FAST_MODEL,undefined);assert.equal(next.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,'claude-fable-5-1[1m]');assert.deepEqual(JSON.parse(await fs.readFile(result.backup!,'utf8')),original);assert.equal((await fs.stat(result.backup!)).mode&0o777,0o600);assert.equal(await roleSettingsMatch(dir,'claude-opus-5','claude-fable-5-1'),true);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
