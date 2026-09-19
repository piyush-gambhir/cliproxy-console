import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID, createHash} from 'node:crypto';

export interface StartupConfig {port: number; dataDir: string; settingsDb: string}
interface StoredStartup extends StartupConfig {version: 1; migration?: {id: string; from: StartupConfig}}
const FIELDS = {port:'PORT',dataDir:'CLIPROXY_DATA_DIR',settingsDb:'CLIPROXY_SETTINGS_DB'} as const;
function absolute(value: string, home: string) {return path.resolve(value === '~' ? home : value.startsWith('~/') ? path.join(home,value.slice(2)) : value);}
function inside(parent: string, child: string) {const rel = path.relative(parent,child); return !rel || !rel.startsWith('..') && !path.isAbsolute(rel);}
// Resolve existing parents too: a new destination can sit beneath a symlink.
function physical(file: string): string {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  const parent=path.dirname(file);
  return parent===file ? file : path.join(physical(parent),path.basename(file));
}
function fail(message: string): never {throw Object.assign(new Error(message), {status:400});}
function write(file: string, value: StoredStartup) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600}); fs.renameSync(tmp,file);
}
export function startupFile(env = process.env, home = os.homedir()) {
  return absolute(env['CLIPROXY_STARTUP_FILE'] || path.join(home,'.cliproxy-console/startup.json'),home);
}
export function readStartup(env = process.env, home = os.homedir()): StartupConfig {
  const file = startupFile(env,home);
  const stored: Partial<StoredStartup> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {};
  if (stored.version !== undefined && stored.version !== 1) throw new Error('Unsupported startup configuration version');
  const port = Number(env['PORT'] || stored.port || 8320);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Port must be between 1 and 65535');
  const dataDir = absolute(env['CLIPROXY_DATA_DIR'] || stored.dataDir || path.join(home,'.cliproxy-console'),home);
  const settingsDb = absolute(env['CLIPROXY_SETTINGS_DB'] || stored.settingsDb || path.join(dataDir,'settings.sqlite'),home);
  return {port,dataDir,settingsDb};
}

/** One fixed bootstrap file locates movable runtime data. Paths become active only at startup. */
export class StartupStore {
  readonly #env: NodeJS.ProcessEnv;
  readonly #home: string;
  readonly file: string;
  readonly running: StartupConfig;
  constructor(env = process.env, home = os.homedir()) {
    this.#env=env;this.#home=home;this.file=startupFile(env,home);this.running=readStartup(env,home);
  }
  view() {
    const next = readStartup(this.#env,this.#home);
    return {file:this.file,running:this.running,next,restartRequired:JSON.stringify(next)!==JSON.stringify(this.running),
      sources:Object.fromEntries(Object.entries(FIELDS).map(([key,env])=>[key,this.#env[env] ? 'env':'file']))};
  }
  update(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Startup settings must be an object');
    const patch=value as Record<string,unknown>;
    const next={...readStartup(this.#env,this.#home)};
    for (const field of Object.keys(FIELDS) as (keyof StartupConfig)[]) {
      if (patch[field] === undefined) continue;
      if (this.#env[FIELDS[field]] && patch[field] === next[field]) continue;
      if (this.#env[FIELDS[field]]) fail(`${FIELDS[field]} controls ${field}; remove the environment override before editing it here`);
      if (field === 'port') {
        if (typeof patch.port !== 'number' || !Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535) fail('Port must be between 1 and 65535');
        next.port=patch.port;
      } else {
        if (typeof patch[field] !== 'string' || !patch[field].trim() || patch[field].includes('\0')) fail(`Invalid ${field}`);
        next[field]=absolute(patch[field],this.#home);
        const target=physical(next[field]), home=physical(this.#home);
        if (!inside(home,target) || target===home) fail(`${field} must be a path inside your home directory`);
        for (const forbidden of ['.claude','.cli-proxy-api','Library/Application Support/Claude','Library/Application Support/Claude-3p']) {
          if (inside(physical(path.join(this.#home,forbidden)),target)) fail('Do not store console data in a provider or Claude client directory');
        }
      }
    }
    if (next.dataDir!==this.running.dataDir) {
      if (inside(physical(this.running.dataDir),physical(next.dataDir)) || inside(physical(next.dataDir),physical(this.running.dataDir))) fail('The new data directory cannot contain or be inside the current one');
      if (fs.existsSync(next.dataDir)) fail('Choose a new, nonexistent data directory so no existing files are overwritten');
    }
    if (next.settingsDb!==this.running.settingsDb && fs.existsSync(next.settingsDb)) fail('The destination settings database already exists');
    if (next.settingsDb===next.dataDir || inside(next.settingsDb,next.dataDir)) fail('The database must be a file, not the data directory or its parent');
    const relocating=next.dataDir!==this.running.dataDir || next.settingsDb!==this.running.settingsDb;
    write(this.file,{version:1,...next,...relocating ? {migration:{id:randomUUID(),from:this.running}} : {}});
    return this.view();
  }
}

/** Runs before opening the DB or accepting traffic. Keeps the source directory as a backup. */
export function prepareStartup(env=process.env, home=os.homedir()): StartupConfig {
  const file=startupFile(env,home), next=readStartup(env,home);
  if (!fs.existsSync(file)) return next;
  const stored=JSON.parse(fs.readFileSync(file,'utf8')) as StoredStartup;
  const migration=stored.migration;
  if (!migration) return next;
  if (stored.dataDir!==next.dataDir || stored.settingsDb!==next.settingsDb) throw new Error('Remove storage environment overrides or cancel the pending storage migration before restarting');
  const source=migration.from;
  if (source.dataDir!==next.dataDir) {
    const marker=path.join(next.dataDir,'.console-migration.json');
    if (fs.existsSync(next.dataDir)) {
      if (!fs.existsSync(marker) || JSON.parse(fs.readFileSync(marker,'utf8')).id!==migration.id) throw new Error('Storage migration destination already exists; refusing to overwrite it');
    } else {
      fs.mkdirSync(path.dirname(next.dataDir),{recursive:true,mode:0o700});
      const stage=fs.mkdtempSync(path.join(path.dirname(next.dataDir),'.cliproxy-migration-'));
      try {
        fs.cpSync(source.dataDir,stage,{recursive:true,force:false,errorOnExist:false});
        fs.chmodSync(stage,0o700);
        fs.writeFileSync(path.join(stage,'.console-migration.json'),JSON.stringify({id:migration.id}),{mode:0o600});
        fs.renameSync(stage,next.dataDir);
      } catch(err) {fs.rmSync(stage,{recursive:true,force:true});throw err;}
    }
  }
  if (source.settingsDb!==next.settingsDb && fs.existsSync(source.settingsDb)) {
    const hash=(name:string)=>createHash('sha256').update(fs.readFileSync(name)).digest('hex');
    if (fs.existsSync(next.settingsDb)) {
      if (hash(next.settingsDb)!==hash(source.settingsDb)) throw new Error('The destination database differs; refusing to overwrite it');
    } else {
      fs.mkdirSync(path.dirname(next.settingsDb),{recursive:true,mode:0o700});
      fs.copyFileSync(source.settingsDb,next.settingsDb,fs.constants.COPYFILE_EXCL);
    }
    fs.chmodSync(next.settingsDb,0o600);
  }
  write(file,{version:1,...next});
  return next;
}
