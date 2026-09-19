import type {SettingsStore} from './settings.ts';
import type {ProfileStore} from './profiles.ts';
import {MgmtDisabledError,type MgmtClient} from './mgmt.ts';
import {accountModels} from './routing.ts';
import {ReceiptStore} from './receipts.ts';

/** Control-plane synchronization only; the proxy serves inference without this process. */
export class GatewayService {
  ready = false;
  error: string | null = null;
  syncedAt: string | null = null;
  storageError: string | null = null;
  #pending: Promise<void> | null = null;
  readonly settings:SettingsStore; readonly profiles:ProfileStore; readonly mgmt:MgmtClient; readonly receipts:ReceiptStore;
  constructor(settings:SettingsStore,profiles:ProfileStore,mgmt:MgmtClient,receipts:ReceiptStore) {this.settings=settings;this.profiles=profiles;this.mgmt=mgmt;this.receipts=receipts;}
  #nativeOrigin: string | null = null;
  sync(fresh = false): Promise<void> {
    if(this.#pending && !fresh) return this.#pending;
    const next=(this.#pending ?? Promise.resolve()).then(()=>this.#sync());
    this.#pending=next;
    void next.finally(()=>{if(this.#pending===next)this.#pending=null;});
    return next;
  }
  async #sync() {
    try {
      const cfg=await this.settings.load();
      if(this.#nativeOrigin!==cfg.proxyUrl)this.ready=false;
      const current = await this.mgmt.json<{version:number;routes:unknown[]}>('GET','account-gateway');
      if(current.version!==1) throw new Error('This proxy does not support native account routes');
      const {files}=await this.mgmt.json<{files:{name:string;disabled?:boolean;status?:string}[]}>('GET','auth-files');
      const routes=[];
      for(const profile of await this.profiles.list()) {
        if(!profile.authFile.startsWith('claude-')) continue;
        const account=files.find(f=>f.name===profile.authFile);
        if(!account || account.disabled || account.status==='disabled') continue;
        const registered=new Set(await accountModels(this.mgmt,profile.authFile));
        const models=cfg.claudeModels.filter(m=>registered.has(profile.lastKnownPrefix ? `${profile.lastKnownPrefix}/${m.id}` : m.id)).map(({id,label,contextWindow})=>({id,label,contextWindow}));
        if(models.length) routes.push({id:profile.id,authFile:profile.authFile,models});
      }
      if(JSON.stringify(current.routes)!==JSON.stringify(routes)) await this.mgmt.json('PUT','account-gateway','',{routes});
      this.#nativeOrigin=cfg.proxyUrl;this.ready=true;this.error=null;
      const journal=await this.mgmt.json<{receipts:unknown[];storageError?:string}>('GET','account-gateway/receipts');
      this.receipts.import(journal.receipts,cfg.receiptRetentionDays);
      this.storageError=journal.storageError || null;
      this.syncedAt=new Date().toISOString();
    } catch(err) {if(err instanceof MgmtDisabledError && err.status===404)this.ready=false;this.error=err instanceof MgmtDisabledError && err.status===404 ? 'Native account routes are unavailable. Install a proxy build with account-gateway support.' : (err as Error).message;}
  }
  async view() {
    const cfg=await this.settings.load();
    return {ready:this.ready,error:this.error,storageError:this.storageError,syncedAt:this.syncedAt,inferenceUrl:this.ready?cfg.proxyUrl:cfg.consoleUrl,independent:this.ready,receiptRetentionDays:cfg.receiptRetentionDays};
  }
}
