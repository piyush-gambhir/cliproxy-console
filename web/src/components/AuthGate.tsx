import {useEffect,useState,type ReactNode} from 'react';
import {request} from '../api';
import {Button} from './ui/button';
import {Card} from './ui/card';
import {FormInput} from './controls';
import {Field,ErrorLine} from './ui';

export function AuthGate({children}:{children:ReactNode}) {
 const [ready,setReady]=useState(false),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 useEffect(()=>{const lock=()=>setReady(false);window.addEventListener('proxy-auth-required',lock);if(sessionStorage.getItem('cliproxy.managementKey'))request('/api/settings').then(()=>setReady(true),setError);return()=>window.removeEventListener('proxy-auth-required',lock);},[]);
 async function connect(){setBusy(true);setError(null);sessionStorage.setItem('cliproxy.managementKey',key.trim());try{await request('/api/settings');setKey('');setReady(true);}catch(e){sessionStorage.removeItem('cliproxy.managementKey');setError(e);}finally{setBusy(false);}}
 if(ready)return children;
 return <main className="auth-page"><Card className="auth-card"><span className="eyebrow">CLIProxyAPI</span><h1>Connect to your proxy</h1><p>The console is a frontend. Accounts, settings, usage, and request history live in CLIProxyAPI.</p><form onSubmit={e=>{e.preventDefault();void connect();}}><Field label="Management key" hint="Use the existing CLIProxyAPI management key. It stays in this browser tab for the session."><FormInput type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} /></Field><ErrorLine error={error}/><Button type="submit" disabled={busy||!key.trim()}>{busy?'Connecting…':'Connect'}</Button></form></Card></main>;
}
