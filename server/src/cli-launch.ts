import fs from 'node:fs/promises';
import {desktopFile} from './desktop.ts';
import type {ConsoleConfig} from './settings.ts';
import type {Profile} from './profiles.ts';
import {roleEnvironment} from './role-settings.ts';

/** Prepare a standard Claude invocation from local configuration. No management HTTP calls. */
export async function cliLaunch(cfg:ConsoleConfig,profiles:Profile[],args:string[],baseEnv:NodeJS.ProcessEnv=process.env) {
 const endpoint=new URL(cfg.proxyUrl);
 if(!['http:','https:'].includes(endpoint.protocol)||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash) throw new Error('The local Claude launcher requires a loopback proxy URL.');
 let subscription=cfg.cliProfile,model='',requestedEffort=false;
 const pass:string[]=[];
 for(let i=0;i<args.length;i++) {
  const arg=args[i]!;
  if(/^(remote|remote-control|web|--remote|--remote-control|--teleport|--resume-url)(=|$)/.test(arg)) throw new Error('Cloud sessions and Remote Control are disabled in this local proxy profile.');
  if(/^--fallback-model(=|$)/.test(arg))throw new Error('Automatic model fallback is disabled.');
  if(arg==='--subscription'||arg==='--model') {const value=args[++i];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${arg}`);if(arg==='--subscription')subscription=value;else model=value;continue;}
  if(arg.startsWith('--subscription=')){subscription=arg.slice(15);continue;}
  if(arg.startsWith('--model=')){model=arg.slice(8);continue;}
  if(arg==='--effort'||arg.startsWith('--effort='))requestedEffort=true;
  pass.push(arg);
 }
 let desktop:Record<string,unknown>={};
 try{if(!subscription||!cfg.clientApiKey) desktop=JSON.parse(await fs.readFile(await desktopFile(cfg.desktopConfigDir),'utf8'));}catch(err){if(!subscription||!cfg.clientApiKey)throw new Error('Choose a CLI subscription and save a client key in the console, or configure Claude Desktop first.');}
 subscription ||= /\/inference\/([^/]+)$/.exec(String(desktop.inferenceGatewayBaseUrl))?.[1] || '';
 const candidates=profiles.filter(p=>p.authFile.startsWith('claude-')&&(p.id===subscription||p.name.toLowerCase()===subscription.toLowerCase()));
 if(candidates.length!==1)throw new Error('Choose a unique subscription in Claude setup or use --subscription with its exact name or ID.');
 model=model.replace(/\[1m\]$/i,'') || cfg.claudeModels[0]!.id;
 const exact=cfg.claudeModels.find(m=>m.id===model);
 const family=cfg.claudeModels.filter(m=>m.id.startsWith(`claude-${model}-`));
 const selected=exact || (family.length===1 ? family[0] : undefined);
 if(!selected)throw new Error('Choose a configured official 1M model from the console.');
 const key=cfg.clientApiKey || (typeof desktop.inferenceGatewayApiKey==='string' ? desktop.inferenceGatewayApiKey : '');
 if(!key)throw new Error('Save a proxy client API key in console Settings.');
 const env={...baseEnv};
 for(const name of ['ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_SMALL_FAST_MODEL'])delete env[name];
 Object.assign(env,{CLAUDE_CONFIG_DIR:cfg.claudeConfigDir,ANTHROPIC_BASE_URL:`${cfg.proxyUrl}/inference/${candidates[0]!.id}`,ANTHROPIC_AUTH_TOKEN:key,CLAUDE_CODE_DISABLE_1M_CONTEXT:'0',ANTHROPIC_MODEL:`${selected.id}[1m]`,...roleEnvironment(selected.id,cfg.claudeBackgroundModel,cfg.claudeSubagentModel)});
 for(const family of ['OPUS','FABLE','SONNET']) {const option=cfg.claudeModels.find(m=>m.id.startsWith(`claude-${family.toLowerCase()}-`)) || selected;env[`ANTHROPIC_DEFAULT_${family}_MODEL`]=`${option.id}[1m]`;}
 return {profile:candidates[0]!.id,model:selected.id,env,args:[...pass,'--model',`${selected.id}[1m]`,...requestedEffort?[]:['--effort',cfg.cliEffort]]};
}
