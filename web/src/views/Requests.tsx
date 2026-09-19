import {useCallback,useEffect,useState} from 'react';
import {RefreshCw,ChevronDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '@/components/ui/collapsible';
import {SelectField,SelectChoice} from '@/components/controls';
import {Chip,Field,Notice} from '@/components/ui';
import {api} from '../api';
import type {RequestHistory} from '../types';
const tokens=(value:number|null)=>value===null ? 'Unknown' : value.toLocaleString();
export function Requests(){
 const [history,setHistory]=useState<RequestHistory|null>(null);
 const [profile,setProfile]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const load=useCallback(async(sync=false)=>{setBusy(true);try{if(sync)await api.syncGateway();setHistory(await api.requestHistory(profile));setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[profile]);
 useEffect(()=>{let live=true;const poll=()=>{api.requestHistory(profile).then(data=>{if(live){setHistory(data);setError('');}},e=>{if(live)setError(e.message);});};poll();const timer=setInterval(poll,10_000);return()=>{live=false;clearInterval(timer);};},[profile]);
 return <div className="page request-page">
  <div className="page-head"><div><span className="eyebrow">Observed activity</span><h1>Request history</h1><p>See which subscription actually handled each request.</p></div><Button variant="secondary" disabled={busy} onClick={()=>void load(true)}><RefreshCw size={15}/> {busy?'Refreshing…':'Refresh'}</Button></div>
  {error&&<Notice tone="err" title="Could not load history"><p role="alert">{error}</p></Notice>}
  {history&&<>
   <Notice tone={history.gateway.error||history.gateway.storageError||!history.gateway.ready?'warn':'plain'} title={history.gateway.ready?'Requests run directly in the proxy':'Native gateway not ready'}>
    <p>{history.gateway.ready?'Saved account routes work without the console. The console imports request metadata every 10 seconds.':'Update the proxy to a version supporting account routes. Older compatibility requests have no verified receipts.'}</p>
    {history.gateway.error&&<p>{history.gateway.error}</p>}{history.gateway.storageError&&<p>{history.gateway.storageError}</p>}
    <p className="microcopy">Retained for {history.gateway.receiptRetentionDays} days. Last import: {history.gateway.syncedAt?new Date(history.gateway.syncedAt).toLocaleString():'never'}. The proxy buffers up to 5,000 recent receipts while the console is closed.</p>
   </Notice>
   <div className="request-filter"><Field label="Subscription"><SelectField value={profile} onChange={e=>setProfile(e.target.value)}><SelectChoice value="">All subscriptions</SelectChoice>{history.profiles.map(p=><SelectChoice key={p.id} value={p.id}>{p.name}</SelectChoice>)}</SelectField></Field></div>
   <p className="microcopy">Latest 200 finished requests. Token counts come from provider responses and do not measure your weekly quota. “1M configured” is a setting; “Above 200K observed” confirms a completed request used more than 200K input tokens, not the full 1M maximum.</p>
   {!history.receipts.length&&<Card className="request-empty"><h2>No requests recorded yet</h2><p>Use the direct connection from Claude setup. Completed requests will appear here; prompts, response text and keys are excluded.</p></Card>}
   <div className="request-list">{history.receipts.map(r=>{
    const account=history.profiles.find(p=>p.id===r.profile)?.name || r.profile;
    const counting=r.endpoint.endsWith('/count_tokens');
    return <Card className="request-card" key={r.id}>
     <div className="row wrap"><strong>{account}</strong><Chip tone={r.accountConfirmed?'ok':'warn'}>{r.accountConfirmed?'Account confirmed':'Account unconfirmed'}</Chip><Chip tone={r.status>=400||r.errorType?'err':r.completed?'ok':'warn'}>{r.status} · {r.errorType|| (r.completed?'Completed':'Incomplete')}</Chip><span className="spacer"/><time dateTime={r.startedAt}>{new Date(r.startedAt).toLocaleString()}</time></div>
     <div className="row wrap"><span className="mono break-path">{r.model || 'No model'}</span><span className="dim">{counting?'Token count':r.agent?'Agent request':'Message request'} · Effort: {r.effort || 'Not reported'} · {(r.durationMs/1000).toFixed(1)}s</span></div>
     <dl className="request-tokens"><div><dt>New input</dt><dd>{tokens(r.inputTokens)}</dd></div><div><dt>Cache read</dt><dd>{tokens(r.cacheReadTokens)}</dd></div><div><dt>Cache write</dt><dd>{tokens(r.cacheCreationTokens)}</dd></div><div><dt>Output</dt><dd>{tokens(r.outputTokens)}</dd></div></dl>
     <div className="row wrap"><Chip tone="plain">{r.contextConfigured===1000000?'1M configured':'Context not configured'}</Chip>{r.over200kObserved&&<Chip tone="ok">Above 200K observed</Chip>}</div>
     <Collapsible><CollapsibleTrigger asChild><Button size="sm" variant="ghost">Request details <ChevronDown size={14}/></Button></CollapsibleTrigger><CollapsibleContent><dl className="request-details">{[['Response model',r.responseModel||'Not reported'],['Session',r.session||'Not reported'],['Agent',r.agent||'Not reported'],['Parent agent',r.parentAgent||'Not reported'],['Endpoint',r.endpoint],['Receipt',r.id]].map(([k,v])=><div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}</dl></CollapsibleContent></Collapsible>
    </Card>;
   })}</div>
  </>}
 </div>;
}
