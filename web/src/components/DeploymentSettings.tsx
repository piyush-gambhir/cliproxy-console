import {useEffect, useState} from 'react';
import {Button} from './ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from './ui/collapsible';
import {FormInput} from './controls';
import {ErrorLine, Field, Notice} from './ui';

interface Startup {port:number;dataDir:string;settingsDb:string}
interface StartupView {file:string;running:Startup;next:Startup;restartRequired:boolean;sources:Record<string,string>}
interface ServiceView {file:string;values:Record<string,string>;sources:Record<string,string>}
async function call<T>(route:string, body?:unknown):Promise<T> {
  const res=await fetch(`/api/${route}`,body===undefined?undefined:{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw new Error(data.error || 'Could not save configuration');return data;
}
const SERVICE_FIELDS=[['label','Proxy service label'],['brewLabel','Homebrew service label'],['brewBinary','Homebrew executable'],['brewPrefix','Homebrew prefix'],['config','Proxy configuration file'],['repository','Proxy release repository'],['consoleUrl','Console URL for service checks']];
export function DeploymentSettings() {
  const [startup,setStartup]=useState<StartupView|null>(null),[draft,setDraft]=useState<Startup|null>(null);
  const [service,setService]=useState<ServiceView|null>(null),[serviceDraft,setServiceDraft]=useState<Record<string,string>>({});
  const [error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState('');
  useEffect(()=>{void Promise.all([call<StartupView>('startup'),call<ServiceView>('service-settings')]).then(([a,b])=>{setStartup(a);setDraft(a.next);setService(b);setServiceDraft(b.values);}).catch(setError);},[]);
  async function saveStartup(value:Startup) {
    setBusy(true);setError(null);setSaved('');
    try {const next=await call<StartupView>('startup',value);setStartup(next);setDraft(next.next);setSaved(next.restartRequired?'Startup changes saved. Restart the console to apply them.':'Pending startup changes cleared.');}
    catch(err){setError(err);}finally{setBusy(false);}
  }
  async function saveService() {
    setBusy(true);setError(null);setSaved('');
    try {const patch=Object.fromEntries(Object.entries(serviceDraft).filter(([key,value])=>value!==service?.values[key]));const next=await call<ServiceView>('service-settings',patch);setService(next);setServiceDraft(next.values);setSaved('Service helper settings saved. They apply on the next service install or update; the running proxy was not restarted.');}
    catch(err){setError(err);}finally{setBusy(false);}
  }
  return <Collapsible className="settings-section">
    <CollapsibleTrigger asChild><Button variant="secondary">Server, storage and service settings</Button></CollapsibleTrigger>
    <CollapsibleContent className="settings-fields">
      <p className="microcopy">These settings have separate save buttons. Environment-controlled fields are locked. The console remains bound to localhost.</p>
      <ErrorLine error={error}/>
      {saved && <p role="status">{saved}</p>}
      {startup && draft && <>
        <Field label="Console server port" hint={`Running on port ${startup.running.port}. A change takes effect after restarting the console.`}><FormInput type="number" min={1} max={65535} disabled={busy || startup.sources.port==='env'} value={draft.port} onChange={e=>setDraft({...draft,port:Number(e.target.value)})}/></Field>
        <Field label="Console data directory" hint="To relocate data, choose a new directory inside your home. On restart the console copies its data and retains the original directory as a backup."><FormInput className="mono" disabled={busy || startup.sources.dataDir==='env'} value={draft.dataDir} onChange={e=>setDraft({...draft,dataDir:e.target.value,...draft.settingsDb===`${draft.dataDir}/settings.sqlite` && startup.sources.settingsDb!=='env'?{settingsDb:`${e.target.value}/settings.sqlite`}:{}})}/></Field>
        <Field label="Settings SQLite file" hint="An existing destination file is never overwritten. The current database is copied during restart."><FormInput className="mono" disabled={busy || startup.sources.settingsDb==='env'} value={draft.settingsDb} onChange={e=>setDraft({...draft,settingsDb:e.target.value})}/></Field>
        <div className="row wrap"><Button variant="secondary" disabled={busy || JSON.stringify(draft)===JSON.stringify(startup.next)} onClick={()=>void saveStartup(draft)}>Save startup changes</Button>{startup.restartRequired && <Button variant="ghost" disabled={busy} onClick={()=>void saveStartup(startup.running)}>Cancel pending changes</Button>}</div>
        {startup.restartRequired && <Notice tone="warn" title="Console restart required"><p>Stop and start your console process or its service manager. Then open <code>http://127.0.0.1:{startup.next.port}</code>. If the port changed, reapply client connections before using Claude.</p></Notice>}
        <p className="microcopy break-path">Startup file: {startup.file}</p>
      </>}
      {service && <>
        <h3>Optional proxy service helper</h3><p className="microcopy">These values configure the macOS installer and launcher. Changing them does not move or restart an installed proxy service. Apply a service install/update to use changed labels or executable paths.</p>
        {SERVICE_FIELDS.map(([key,label])=><Field key={key} label={label!} hint={service.sources[key!]==='env'?'Controlled by the process environment.':undefined}><FormInput className="mono" disabled={busy || service.sources[key!]==='env'} value={serviceDraft[key!] || ''} onChange={e=>setServiceDraft({...serviceDraft,[key!]:e.target.value})}/></Field>)}
        <Button variant="secondary" disabled={busy || JSON.stringify(serviceDraft)===JSON.stringify(service.values)} onClick={()=>void saveService()}>Save service helper settings</Button>
        <p className="microcopy break-path">Service settings: {service.file}</p>
      </>}
    </CollapsibleContent>
  </Collapsible>;
}
