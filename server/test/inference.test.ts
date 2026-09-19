import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createApp} from '../src/app.ts';
import type {SettingsStore} from '../src/settings.ts';
import type {MgmtClient} from '../src/mgmt.ts';
import type {ProfileStore} from '../src/profiles.ts';

test('subscription relay preserves effort, auth, SSE, large contexts and fails closed without fallback', async () => {
  const requests: {url: string; body: any; key: unknown}[] = [];
  let fail = false, collision = false, fallback = false, disabled = false;
  const upstream = http.createServer(async (req,res) => {
    if (req.method === 'GET') {res.writeHead(req.headers['x-api-key'] === 'client-key' ? 200 : 401,{'content-type':'application/json'});res.end('{}');return;}
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({url:req.url!, body:JSON.parse(Buffer.concat(chunks).toString()),key:req.headers['x-api-key']});
    if (req.headers['x-api-key'] !== 'client-key') {res.writeHead(401);res.end('unauthorized');return;}
    if (fail) {res.writeHead(429,{'retry-after':'60'});res.end('quota exhausted');return;}
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write('event: message_start\ndata: {"model":"claude-opus-5"}\n\n');
    res.end('event: message_stop\ndata: {}\n\n');
  });
  upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
  const url = `http://127.0.0.1:${(upstream.address() as any).port}`;
  const profile = {id:'a',authFile:'claude-a.json',lastKnownPrefix:'a'};
  const profiles = {get:async(id:string)=> {if(id!=='a') throw Object.assign(new Error('missing'),{status:404}); return profile;}} as unknown as ProfileStore;
  const mgmt = {json:async(_method:string,route:string,query:string) => {
    if (route === 'config') return {'force-model-prefix':true,'request-retry':0,'quota-exceeded':{'switch-project':fallback}};
    if (route === 'auth-files') return {files:[{name:'claude-a.json',disabled},{name:'claude-b.json'}]};
    return {models:query.includes('claude-a.json') || collision ? [{id:'a/claude-opus-5'},{id:'a/claude-fable-5-1'}] : [{id:'b/claude-opus-5'}]};
  }} as unknown as MgmtClient;
  const app = createApp({settings:{load:async()=>({proxyUrl:url})} as SettingsStore, profiles, mgmt, webDist:null});
  const relay = http.createServer((req,res) => {void app(req,res);});
  relay.listen(0,'127.0.0.1');await once(relay,'listening');
  const relayUrl = `http://127.0.0.1:${(relay.address() as any).port}/inference/a`;
  const call = (body: object, key: string|null = 'client-key', endpoint='/v1/messages') => fetch(relayUrl+endpoint,{method:'POST',headers:{'content-type':'application/json',...(key ? {'x-api-key':key} : {})},body:JSON.stringify(body)});
  try {
    let list = await fetch(relayUrl+'/v1/models',{headers:{'x-api-key':'client-key'}});
    assert.equal(list.status,200);assert.deepEqual((await list.json() as any).data.map((m:any)=>m.id),['claude-opus-5','claude-fable-5-1']);
    list = await fetch(relayUrl+'/v1/models',{headers:{'x-api-key':'bad-key'}});assert.equal(list.status,401);await list.text();
    const body = {model:'claude-opus-5',stream:true,output_config:{effort:'max'},messages:[{role:'user',content:'x'.repeat(1024*1024+1)}]};
    let res = await call(body,'client-key','/v1/messages?beta=true');assert.equal(res.status,200);assert.match(await res.text(),/message_stop/);
    assert.equal(requests[0]!.body.model,'a/claude-opus-5');
    assert.deepEqual(requests[0]!.body.output_config,body.output_config);
    assert.equal(requests[0]!.key,'client-key');
    res=await call({...body,model:'claude-opus-5[1m]'}); assert.equal(res.status,200);await res.text();assert.equal(requests.at(-1)!.body.model,'a/claude-opus-5');
    requests.pop();
    fail=true; res=await call(body); assert.equal(res.status,429);assert.equal(res.headers.get('retry-after'),'60');await res.text(); assert.equal(requests.length,2);
    res=await call(body,null);assert.equal(res.status,401);await res.text();
    res=await call({...body,model:'b/claude-opus-5'});assert.equal(res.status,400);await res.text();
    collision=true;res=await call(body);assert.equal(res.status,409);await res.text();collision=false;
    disabled=true;res=await call(body);assert.equal(res.status,409);await res.text();disabled=false;
    fallback=true;res=await call(body);assert.equal(res.status,409);await res.text();fallback=false;
    res=await call(body,'client-key','/v0/management/config');assert.equal(res.status,404);await res.text();
    assert.equal(requests.length,2);
    fail=false;res=await call(body,'bad-key');assert.equal(res.status,401);await res.text();
    res=await call(body,'client-key','/v1/messages/count_tokens');assert.equal(res.status,200);await res.text();assert.equal(requests.at(-1)!.url,'/v1/messages/count_tokens');
  } finally {relay.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise<void>(r=>relay.close(()=>r())),new Promise<void>(r=>upstream.close(()=>r()))]);}
});
