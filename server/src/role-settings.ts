import fs from 'node:fs/promises';
import path from 'node:path';
import {readJsonFile,writeJsonFile} from './json-store.ts';
import {resolveUserDir} from './paths.ts';
import {WireError} from './wire.ts';
export function roleEnvironment(main:string,background='',subagent='') {
 return {ANTHROPIC_DEFAULT_HAIKU_MODEL:`${background || main}[1m]`,CLAUDE_CODE_SUBAGENT_MODEL:`${subagent || main}[1m]`};
}
async function read(directory:string) {
 const file=path.join(resolveUserDir(directory),'settings.json');
 const data=await readJsonFile<Record<string,unknown>>(file,{});
 if(!data || typeof data!=='object' || Array.isArray(data) || (data.env!==undefined && (!data.env || typeof data.env!=='object'||Array.isArray(data.env)))) throw new WireError('Claude settings must contain an object with an env object',409);
 return {file,data,env:(data.env || {}) as Record<string,unknown>};
}
export async function roleSettingsMatch(directory:string,main:string,background='',subagent='') {
 const {env}=await read(directory);return Object.entries(roleEnvironment(main,background,subagent)).every(([k,v])=>env[k]===v) && env.ANTHROPIC_SMALL_FAST_MODEL===undefined;
}
export async function applyRoleSettings(directory:string,main:string,background='',subagent='') {
 const {file,data,env}=await read(directory);
 const next:Record<string,unknown>={...env,...roleEnvironment(main,background,subagent)};delete next.ANTHROPIC_SMALL_FAST_MODEL;
 let backup:string|null=null;
 try {backup=`${file}.backup-${Date.now()}`;await fs.copyFile(file,backup,fs.constants.COPYFILE_EXCL);await fs.chmod(backup,0o600);} catch(err){if((err as NodeJS.ErrnoException).code!=='ENOENT')throw err;backup=null;}
 await writeJsonFile(file,{...data,env:next});return {backup};
}
