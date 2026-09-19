import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ServiceSettingsStore} from '../src/service-settings.ts';
test('frontend service options preserve unrelated local data, validate values, and never persist environment overrides',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'console-service-options-'));
  try {
    const file=path.join(dir,'service.json');await fs.writeFile(file,JSON.stringify({label:'local.existing',unrelated:'private-extra'}));
    const store=new ServiceSettingsStore(file,{CLIPROXY_BREW:'/env/bin/brew'});
    const view=await store.view();assert.equal(view.values.brewBinary,'/env/bin/brew');assert.equal('unrelated' in view.values,false);
    await store.update({label:'local.changed',repository:'https://github.com/example/proxy'});
    const data=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(data.unrelated,'private-extra');assert.equal(data.brewBinary,undefined);
    assert.equal((await fs.stat(file)).mode&0o777,0o600);
    await assert.rejects(store.update({label:'bad/label'}));
    await assert.rejects(store.update({repository:'https://user:secret@example.com/proxy'}));
    await assert.rejects(store.update({consoleUrl:'https://external.example.com'}));
    await assert.rejects(store.update({brewBinary:'/other/brew'}),/controls/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
