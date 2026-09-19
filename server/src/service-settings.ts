import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readStartup} from './startup.ts';
import {readJsonFile, writeJsonFile} from './json-store.ts';
import {consoleOrigin} from './runtime.ts';
const ENV = {label:'CLIPROXY_SERVICE_LABEL',brewLabel:'CLIPROXY_BREW_LABEL',brewBinary:'CLIPROXY_BREW',brewPrefix:'CLIPROXY_BREW_PREFIX',config:'CLIPROXY_CONFIG',repository:'CLIPROXY_RELEASE_REPOSITORY',consoleUrl:'CLIPROXY_CONSOLE_URL'} as const;
type Options = Record<keyof typeof ENV,string>;
const startup=readStartup();
const home=os.homedir();
const expand=(value:string)=>value.startsWith('~/') ? path.join(home,value.slice(2)) : path.resolve(value);
export class ServiceSettingsStore {
  readonly file: string;
  readonly #env: NodeJS.ProcessEnv;
  constructor(file=path.join(expand(process.env['CLIPROXY_SERVICE_DIR'] || path.join(startup.dataDir,'proxy-service')),'service-settings.json'),env=process.env) {this.file=file;this.#env=env;}
  async view() {
    const stored=await readJsonFile<Partial<Options>>(this.file,{});
    let brew='/opt/homebrew/bin/brew';
    for (const directory of (this.#env['PATH'] || '').split(path.delimiter)) {
      const candidate=path.join(directory,'brew');
      try {await fs.access(candidate,fs.constants.X_OK);brew=candidate;break;} catch {}
    }
    const binary=this.#env.CLIPROXY_BREW || stored.brewBinary || brew;
    const prefix=this.#env.CLIPROXY_BREW_PREFIX || stored.brewPrefix || path.dirname(path.dirname(binary));
    const defaults: Options = {label:'local.cliproxyapi',brewLabel:'homebrew.mxcl.cliproxyapi',brewBinary:binary,brewPrefix:prefix,config:path.join(prefix,'etc/cliproxyapi.conf'),repository:'https://github.com/router-for-me/CLIProxyAPI',consoleUrl:consoleOrigin()};
    const values={...defaults};
    const sources: Record<string,'env'|'file'|'default'>={};
    for (const key of Object.keys(ENV) as (keyof Options)[]) {
      const value=this.#env[ENV[key]];
      values[key]=value || (typeof stored[key]==='string' ? stored[key] : undefined) || defaults[key];
      sources[key]=value?'env':stored[key]?'file':'default';
    }
    return {file:this.file,values,sources};
  }
  async update(patch: Record<string, unknown>) {
    if (!patch || typeof patch!=='object' || Array.isArray(patch)) throw Object.assign(new Error('Service settings must be an object'),{status:400});
    const stored=await readJsonFile<Partial<Options>>(this.file,{});
    const next={...stored};
    for (const key of Object.keys(ENV) as (keyof Options)[]) {
      if(patch[key]===undefined) continue;
      if(this.#env[ENV[key]]) throw Object.assign(new Error(`${ENV[key]} controls this setting`),{status:400});
      const value=patch[key];
      if(typeof value!=='string' || !value.trim() || /[\r\n\0]/.test(value)) throw Object.assign(new Error(`Invalid ${key}`),{status:400});
      next[key]=value.trim();
      if(['label','brewLabel'].includes(key) && !/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(value)) throw Object.assign(new Error('Invalid service label'),{status:400});
      if(key==='consoleUrl') next[key]=consoleOrigin({CLIPROXY_CONSOLE_URL:value});
      if(key==='repository') {
        let url: URL;try {url=new URL(value);} catch {throw Object.assign(new Error('Invalid repository URL'),{status:400});}
        if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw Object.assign(new Error('Use an HTTPS repository URL without credentials'),{status:400});
      }
      if(['brewBinary','brewPrefix','config'].includes(key)) next[key]=expand(value);
    }
    await writeJsonFile(this.file,next);
    return this.view();
  }
}
