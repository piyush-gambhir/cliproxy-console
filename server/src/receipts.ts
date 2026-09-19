import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export interface Receipt {
 id:string;startedAt:string;profile:string;model:string;responseModel:string;effort:string;session:string;agent:string;parentAgent:string;endpoint:string;
 status:number;durationMs:number;inputTokens:number|null;outputTokens:number|null;cacheReadTokens:number|null;cacheCreationTokens:number|null;
 accountConfirmed:boolean;completed:boolean;contextConfigured:number;over200kObserved:boolean;errorType:string;
}
const strings=['id','startedAt','profile','model','responseModel','effort','session','agent','parentAgent','endpoint','errorType'] as const;
const numbers=['status','durationMs','contextConfigured'] as const;
const tokens=['inputTokens','outputTokens','cacheReadTokens','cacheCreationTokens'] as const;
function normalize(value:unknown):Receipt|null {
 if(!value || typeof value!=='object')return null;
 const raw=value as Record<string,unknown>;
 if(typeof raw.id!=='string'||!raw.id||typeof raw.startedAt!=='string'||!Number.isFinite(Date.parse(raw.startedAt)))return null;
 const out:Record<string,unknown>={};
 for(const key of strings)out[key]=typeof raw[key]==='string' ? raw[key].slice(0,200) : '';
 out.startedAt=new Date(raw.startedAt as string).toISOString();
 for(const key of numbers)out[key]=typeof raw[key]==='number' && Number.isFinite(raw[key]) ? raw[key] : 0;
 for(const key of tokens)out[key]=typeof raw[key]==='number' && Number.isSafeInteger(raw[key]) && raw[key]>=0 ? raw[key] : null;
 for(const key of ['accountConfirmed','completed','over200kObserved'])out[key]=raw[key]===true;
 return out as unknown as Receipt;
}
export class ReceiptStore {
 readonly file:string;
 constructor(file:string) {this.file=file;}
 #db<T>(run:(db:DatabaseSync)=>T):T {
  fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});fs.closeSync(fs.openSync(this.file,'a',0o600));fs.chmodSync(this.file,0o600);
  const db=new DatabaseSync(this.file);
  try{db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, started_at TEXT NOT NULL, profile TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS receipts_time ON receipts(started_at DESC)');return run(db);}finally{db.close();}
 }
 import(values:unknown[],retentionDays=30) {
  const cutoff=new Date(Date.now()-retentionDays*86400000).toISOString();
  this.#db(db=>{db.exec('BEGIN IMMEDIATE');try{const put=db.prepare('INSERT OR IGNORE INTO receipts VALUES(?,?,?,?)');for(const value of values){const r=normalize(value);if(r && r.startedAt>=cutoff)put.run(r.id,r.startedAt,r.profile,JSON.stringify(r));}db.prepare('DELETE FROM receipts WHERE started_at < ?').run(cutoff);db.exec('COMMIT');}catch(err){db.exec('ROLLBACK');throw err;}});
 }
 list(profile='',limit=200):Receipt[] {return this.#db(db=>{const query=profile ? db.prepare('SELECT data FROM receipts WHERE profile=? ORDER BY started_at DESC LIMIT ?').all(profile,limit):db.prepare('SELECT data FROM receipts ORDER BY started_at DESC LIMIT ?').all(limit);return query.map(r=>JSON.parse(String(r.data)));});}
}
