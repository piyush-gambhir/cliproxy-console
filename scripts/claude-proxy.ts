#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {SettingsStore} from '../server/src/settings.ts';
import {ProfileStore} from '../server/src/profiles.ts';
import {cliLaunch} from '../server/src/cli-launch.ts';
try {
 const profiles=await new ProfileStore().list();
 const args=process.argv.slice(2);
 if(args.includes('--list-subscriptions')) {
  for(const profile of profiles.filter(p=>p.authFile.startsWith('claude-')))console.log(`${profile.name} [${profile.id}]`);
 } else {
  const cfg=await new SettingsStore().load();
  const plan=await cliLaunch(cfg,profiles,args);
  const child=spawn('claude',plan.args,{env:plan.env,stdio:'inherit'});
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>child.kill(signal));
  child.on('error',()=>{console.error('Could not launch the standard claude binary. Check PATH.');process.exitCode=1;});
  child.on('exit',(code,signal)=>{process.exitCode=code ?? (signal==='SIGINT'?130:1);});
 }
} catch(err){console.error(`Claude proxy: ${(err as Error).message}`);process.exitCode=1;}
