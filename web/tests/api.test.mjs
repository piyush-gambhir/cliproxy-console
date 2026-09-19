import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/api.ts',import.meta.url),'utf8');
const compiled=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext});
const {request}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const saved=new Map();globalThis.sessionStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
let authEvents=0;globalThis.window={dispatchEvent:()=>authEvents++};
test('frontend calls native management routes with tab authentication',async()=>{
 saved.set('cliproxy.managementKey','test-key');let call;
 globalThis.fetch=async(url,options)=>{call={url,options};return new Response('{"ok":true}',{status:200})};
 assert.deepEqual(await request('/api/profiles'),{ok:true});assert.equal(call.url,'/v0/management/console/profiles');assert.equal(call.options.headers.get('Authorization'),'Bearer test-key');
 await request('/api/mgmt/auth-files');assert.equal(call.url,'/v0/management/auth-files');
 await request('/api/settings',{method:'PUT',body:'{}'});assert.equal(call.options.headers.get('Content-Type'),'application/json');
});
test('expired management authentication locks the tab and clears the saved key',async()=>{
 saved.set('cliproxy.managementKey','bad-key');globalThis.fetch=async()=>new Response('{"error":"unauthorized"}',{status:401});
 await assert.rejects(request('/api/settings'),/unauthorized/);assert.equal(saved.has('cliproxy.managementKey'),false);assert.equal(authEvents,1);
});
test('the console package has no backend dependency or backend entrypoint',()=>{
 const packageFile=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url)));assert.deepEqual(packageFile.workspaces,['web']);assert.equal(fs.existsSync(new URL('../../server/src/index.ts',import.meta.url)),false);
 assert.ok(!fs.readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8').includes('server/src'));
});
