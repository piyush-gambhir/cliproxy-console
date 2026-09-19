import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {GatewayService} from '../src/gateway.ts';
import {ReceiptStore} from '../src/receipts.ts';
import {createApp} from '../src/app.ts';
import {SettingsStore} from '../src/settings.ts';
import type {MgmtClient} from '../src/mgmt.ts';
import type {ProfileStore} from '../src/profiles.ts';

test('native configuration sync persists only valid account models and imports sanitized receipts',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gateway-'));
 try{
  const settings=new SettingsStore(path.join(dir,'settings.sqlite'),{env:{}});
  const receipts=new ReceiptStore(path.join(dir,'receipts.sqlite'));
  const profile={id:'a',authFile:'claude-a.json',lastKnownPrefix:'account-a'};
  const profiles={list:async()=>[profile]} as unknown as ProfileStore;
  const calls:string[]=[];let routes:unknown[]=[];
  const mgmt={json:async(method:string,route:string,_query:string,payload:any)=>{
   calls.push(`${method} ${route}`);
   if(route==='account-gateway'){if(method==='PUT')routes=payload.routes;return {version:1,routes};}
   if(route==='auth-files')return {files:[{name:profile.authFile}]};
   if(route==='auth-files/models')return {models:[{id:'account-a/claude-opus-5'}]};
   if(route==='account-gateway/receipts')return {receipts:[{id:'r1',profile:'a',startedAt:new Date().toISOString(),model:'claude-opus-5',inputTokens:10,prompt:'do not persist',authorization:'private',accountConfirmed:true}]};
   throw new Error(`unexpected ${route}`);
  }} as unknown as MgmtClient;
  const gateway=new GatewayService(settings,profiles,mgmt,receipts);await gateway.sync();
  assert.equal(gateway.ready,true);assert.equal((await gateway.view()).inferenceUrl,'http://127.0.0.1:8317');
  assert.deepEqual(routes,[{id:'a',authFile:'claude-a.json',models:[{id:'claude-opus-5',label:'Claude Opus 5',contextWindow:1000000}]}]);
  const row=receipts.list()[0]!;assert.equal(row.accountConfirmed,true);assert.equal(row.outputTokens,null);assert(!JSON.stringify(row).includes('private'));assert(!JSON.stringify(row).includes('persist'));
  await gateway.sync();assert.equal(calls.filter(c=>c==='PUT account-gateway').length,1);assert.equal(receipts.list().length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('receipt retention, deduplication and file permissions survive reopening',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'receipts-'));
 try{const file=path.join(dir,'requests.sqlite');const store=new ReceiptStore(file);
  const current={id:'new',profile:'a',startedAt:new Date().toISOString(),inputTokens:0,outputTokens:-1};
  store.import([current,current,{...current,id:'old',startedAt:'2000-01-01T00:00:00.000Z'},{...current,id:'bad',startedAt:'invalid'}],1);
  const rows=new ReceiptStore(file).list();assert.equal(rows.length,1);assert.equal(rows[0]!.inputTokens,0);assert.equal(rows[0]!.outputTokens,null);assert.equal((await fs.stat(file)).mode&0o777,0o600);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('native compatibility relay needs no management calls and preserves bytes, capabilities and failure headers',async()=>{
 const payload='{"model":"claude-opus-5", "unknown_future_field":true}';let captured:any;
 const upstream=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;captured={text,url:req.url,headers:req.headers};res.writeHead(429,{'content-type':'application/json','x-should-retry':'false','retry-after':'60','anthropic-ratelimit-unified-status':'rejected','set-cookie':'never=forward'});res.end('{"type":"error","error":{"type":"rate_limit_error"}}');});
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const origin=`http://127.0.0.1:${(upstream.address() as any).port}`;
 const app=createApp({gateway:{ready:true} as GatewayService,settings:{load:async()=>({proxyUrl:origin})} as SettingsStore,profiles:{} as ProfileStore,mgmt:{json:()=>{throw new Error('No management calls on the request path');}} as unknown as MgmtClient,webDist:null});
 const relay=http.createServer((req,res)=>{void app(req,res);});relay.listen(0,'127.0.0.1');await once(relay,'listening');
 try{const response=await fetch(`http://127.0.0.1:${(relay.address() as any).port}/inference/profile-a/v1/messages?beta=true`,{method:'POST',headers:{'content-type':'application/json','x-api-key':'test-key','x-claude-code-session-id':'session','anthropic-future-capability':'yes'},body:payload});
  assert.equal(response.status,429);assert.equal(response.headers.get('x-should-retry'),'false');assert.equal(response.headers.get('retry-after'),'60');assert.equal(response.headers.get('set-cookie'),null);await response.text();
  assert.equal(captured.text,payload);assert.equal(captured.url,'/inference/profile-a/v1/messages?beta=true');assert.equal(captured.headers['x-claude-code-session-id'],'session');assert.equal(captured.headers['anthropic-future-capability'],'yes');
 }finally{relay.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise<void>(r=>relay.close(()=>r())),new Promise<void>(r=>upstream.close(()=>r()))]);}
});
