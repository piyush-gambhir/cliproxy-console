import {useEffect, useState} from 'react';
import {ArrowRight, Check, ChevronDown, Cpu, Gauge, Monitor, RefreshCw, Terminal, Zap} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Card} from '@/components/ui/card';
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {SelectField, SelectChoice, FormInput} from '@/components/controls';
import {Chip, CodeBlock, Field, Notice} from '@/components/ui';
import {SubscriptionUsage} from '@/components/SubscriptionUsage';
import {api, accountStatus, request} from '../api';
import type {AuthFile, Profile, ClaudeModelOption} from '../types';

interface Model {name: string; labelOverride: string; maxEffort?: string; supports1m?: boolean; prefer1m?: boolean}
interface State {cliProfile:string;inferenceUrl:string;gateway?:import('../types').GatewayStatus;claudeBackgroundModel:string;claudeSubagentModel:string;roleSettingsMatch?:boolean;claudeConfigDir: string; allowedModels: ClaudeModelOption[]; cliEffort: string; setupRequired?: boolean; oneMillionConfigured?: boolean; consoleUrl: string; profile: string; autoMode: boolean; models: (Model|string)[]; defaultEffort: string; alwaysDefault: boolean; gatewayUrl: string; catalog: {profile: Profile; models: string[]; error?: string}[]}
const EFFORTS = ['low','medium','high','xhigh','max'];
const EFFORT_LABELS = ['Low','Medium','High','Extra high','Max'];
function configModels(data: State): Model[] {
  return data.models.map(m => typeof m === 'string' ? {name:m,labelOverride:m} : m)
    .filter(m => data.allowedModels.some(option => option.id === m.name))
    .map(m => {const option=data.allowedModels.find(o=>o.id===m.name)!;return {...m,maxEffort:!m.maxEffort || EFFORTS.indexOf(m.maxEffort)>EFFORTS.indexOf(option.maxEffort) ? option.maxEffort : m.maxEffort,supports1m:true,prefer1m:true};});
}
async function call(method = 'GET', body?: unknown) {
  return request<State & {backup:string}>('/api/desktop', {method,...(body?{body:JSON.stringify(body)}:{})});
}
function requestedProfile() {return new URLSearchParams(window.location.hash.split('?')[1]).get('profile');}

export function Desktop({onOpenSettings}: {onOpenSettings: () => void}) {
  const [state, setState] = useState<State|null>(null);
  const [files, setFiles] = useState<AuthFile[]|null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [profile, setProfile] = useState('');
  const [autoMode, setAutoMode] = useState(false);
  const [effort, setEffort] = useState('');
  const [always, setAlways] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [backup, setBackup] = useState('');
  const [client, setClient] = useState('desktop');
  const [cliModel, setCliModel] = useState('');
  const [cliEffort, setCliEffort] = useState('high');
  const [fastInfo, setFastInfo] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  async function load() {
    setBusy(true); setError('');
    try {
      const data: State = await call();
      setState(data); setModels(configModels(data));
      setCliModel(current => data.allowedModels.some(m => m.id === current) ? current : data.allowedModels[0]?.id ?? '');
      setCliEffort(data.cliEffort);
      const requested = requestedProfile();
      setProfile(requested && data.catalog.some(c => c.profile.id === requested && c.profile.authFile.startsWith('claude-')) ? requested : data.profile);
      setAutoMode(data.autoMode); setEffort(data.defaultEffort); setAlways(data.alwaysDefault);
      try {setFiles((await api.authFiles()).files);} catch {setFiles(null);}
      setSaved(false);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  useEffect(() => {void load(); const refresh = () => {void load();}; window.addEventListener('console-settings-saved', refresh); return () => window.removeEventListener('console-settings-saved', refresh);}, []);
  useEffect(() => {
    const selectFromLink = () => {
      const requested = requestedProfile();
      if (requested && state?.catalog.some(c => c.profile.id === requested && c.profile.authFile.startsWith('claude-'))) {
        setProfile(requested); setClient('desktop'); setSaved(false);
      }
    };
    window.addEventListener('hashchange',selectFromLink);
    return () => window.removeEventListener('hashchange',selectFromLink);
  },[state]);

  const MODELS = (state?.allowedModels ?? []).map(m => ({...m, name:m.id, description:'1M context', alias:m.id}));
  const catalog = state?.catalog.filter(c => c.profile.authFile.startsWith('claude-')) ?? [];
  const selected = catalog.find(c => c.profile.id === profile);
  const selectedFile = files?.find(f => f.name === selected?.profile.authFile);
  const savedProfile = catalog.find(c => c.profile.id === state?.profile)?.profile;
  const serves = (name: string) => selected?.models.includes(`${selected.profile.lastKnownPrefix}/${name}`) === true;
  const unavailable = !selected ? 'Choose a subscription to continue.' : selected.error ? selected.error : files !== null && (!selectedFile || selectedFile.disabled || selectedFile.status === 'disabled') ? 'This subscription is missing or disabled. Enable it in Subscriptions.' : '';
  const modelError = !models.length ? 'Choose at least one model.' : models.some(m => !serves(m.name)) ? 'A selected model is not registered on this subscription. Choose another model or refresh its account.' : '';
  const cliCap = MODELS.find(m => m.id === cliModel)?.maxEffort || 'max';
  const cliEffortError = EFFORTS.indexOf(cliEffort === 'ultracode' ? 'xhigh' : cliEffort) > EFFORTS.indexOf(cliCap);
  const cap = models[0]?.maxEffort || MODELS.find(m => m.id === models[0]?.name)?.maxEffort;
  const effortError = effort && cap && EFFORTS.indexOf(effort) > EFFORTS.indexOf(cap) ? 'Starting effort exceeds the default model’s effort cap. Adjust it in Advanced options.' : '';
  const draft = {profile,autoMode,models,defaultEffort:effort,alwaysDefault:always};
  const normalize = (items: (Model|string)[]) => items.map(entry => {const m = typeof entry === 'string' ? {name:entry,labelOverride:entry} : entry;return [m.name,m.labelOverride,m.maxEffort || '',m.supports1m === true,m.prefer1m === true];});
  const dirty = state && (!state.roleSettingsMatch || state.gatewayUrl !== `${state.inferenceUrl}/inference/${profile}` || !state.oneMillionConfigured || profile !== state.profile || autoMode !== state.autoMode || effort !== state.defaultEffort || always !== state.alwaysDefault || JSON.stringify(normalize(models)) !== JSON.stringify(normalize(state.models)));
  const labelError = models.some(m => !m.labelOverride.trim() || m.labelOverride.length > 200) ? 'Each model needs a display label of 1–200 characters.' : '';
  const canSave = Boolean(state && !state.setupRequired && dirty && !busy && !unavailable && !modelError && !effortError && !labelError);
  const [cliCommand,setCliCommand]=useState(''),[cliCommandError,setCliCommandError]=useState('');
  useEffect(()=>{
    let live=true;setCliCommand('');setCliCommandError('');
    if(client==='cli' && state && profile && cliModel && !unavailable && !cliEffortError){
      request<{command:string}>('/api/cli-command',{method:'POST',body:JSON.stringify({profile,model:cliModel,effort:cliEffort})}).then(value=>{if(live)setCliCommand(value.command);},e=>{if(live)setCliCommandError(e.message);});
    }
    return()=>{live=false;};
  },[client,state,profile,cliModel,cliEffort,unavailable,cliEffortError]);
  const selectedModelLabel = MODELS.find(m => m.name === models[0]?.name)?.label ?? 'No model';

  function edit() {setSaved(false);}
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await call('PUT',draft);
      setState(prev => prev ? {...prev,...result} : prev);
      setBackup(result.backup); setSaved(true);
      window.dispatchEvent(new Event('claude-config-saved'));
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }

  return <div className="page setup-page">
    <div className="page-head">
      <div><span className="eyebrow">Your local workspace</span><h1>Claude setup</h1><p>Choose who pays for the request. Then choose how Claude works.</p></div>
      <div className="actions"><Button variant="secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={15}/> Reload</Button></div>
    </div>
    <div className="saved-configuration">
      <Monitor size={18}/><div><span className="dim">Saved Desktop subscription</span><strong>{savedProfile?.name ?? (busy ? 'Loading…' : 'Not configured')}</strong></div>
      <Chip tone="plain">Manual selection</Chip><span className="dim">Saved settings do not confirm what a running session is using.</span>
    </div>
    {state?.gateway && <Notice tone={state.gateway.ready && !state.gateway.error ? 'plain' : 'warn'} title={state.gateway.ready ? 'Direct proxy connection' : 'Console compatibility connection'}><p>{state.gateway.ready ? 'New client settings connect directly to CLIProxyAPI. Saved routes keep working when this console is closed.' : 'Update the proxy to enable persistent account routes and request history.'} <a href="#requests">Inspect actual requests →</a></p>{state.gateway.error && <p>{state.gateway.error}</p>}</Notice>}
    {state && <p className="microcopy">Background helpers: <strong>{state.claudeBackgroundModel || models[0]?.name || 'selected main model'} · 1M</strong>. Default subagents: <strong>{state.claudeSubagentModel || models[0]?.name || 'selected main model'} · 1M</strong>. <Button variant="link" onClick={onOpenSettings}>Configure model roles</Button></p>}
    {client==='cli' && state && <div className="row wrap"><span className="dim">Plain claude default: {catalog.find(c=>c.profile.id===state.cliProfile)?.profile.name || 'Saved Desktop subscription'}</span><Button variant="secondary" disabled={busy||Boolean(unavailable)||profile===state.cliProfile} onClick={async()=>{setBusy(true);try{await api.saveSettings({cliProfile:profile});setState(current=>current?{...current,cliProfile:profile}:current);setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Save CLI subscription</Button></div>}
    <RadioGroup className="client-switch" aria-label="Configure a client" value={client} onValueChange={value => {setClient(value);edit();}}>
      <Label className={client === 'desktop' ? 'selected' : ''} htmlFor="client-desktop"><RadioGroupItem id="client-desktop" value="desktop"/><Monitor size={16}/> Claude Desktop</Label>
      <Label className={client === 'cli' ? 'selected' : ''} htmlFor="client-cli"><RadioGroupItem id="client-cli" value="cli"/><Terminal size={16}/> Claude CLI</Label>
    </RadioGroup>
    {client==='cli' && cliCommandError && <Notice tone="warn" title="CLI connection unavailable"><p>{cliCommandError}</p></Notice>}
    {error && <Notice tone="err" title="Could not complete setup"><p role="alert">{error}</p></Notice>}
    {saved && <Notice tone="ok" title="Configuration saved"><p role="status">Quit and reopen Claude Desktop to load the saved subscription. Existing sessions can retain their previous model.</p>{backup && <Collapsible><CollapsibleTrigger asChild><Button size="sm" variant="ghost">Backup location <ChevronDown size={14}/></Button></CollapsibleTrigger><CollapsibleContent><code className="break-path">{backup}</code></CollapsibleContent></Collapsible>}</Notice>}

    <div className="setup-layout">
      <div className="setup-sections">
        <section className="setup-section" aria-labelledby="subscription-heading">
          <div className="setup-section-head"><span className="step-number">1</span><div><h2 id="subscription-heading">Select a subscription</h2><p>Every request stays with your choice, including when its quota runs out.</p></div><Button variant="ghost" onClick={() => {window.location.hash='profiles';}}>Manage accounts <ArrowRight size={14}/></Button></div>
          {!state && <p role="status">{busy ? 'Loading your configuration…' : 'Reload to try again.'}</p>}
          {state && !catalog.length && <Notice title="No Claude subscriptions"><p>Add a Claude account in Subscriptions to get started.</p></Notice>}
          <RadioGroup className="account-choices" aria-label="Subscription for Claude" value={profile} disabled={busy} onValueChange={value => {setProfile(value);edit();}}>
            {catalog.map(({profile:p,error:catalogError}) => {
              const file = files?.find(f => f.name === p.authFile);
              const disabled = Boolean(catalogError || files !== null && (!file || file.disabled || file.status === 'disabled'));
              const status = file ? accountStatus(file) : null;
              return <Card className={`account-choice ${profile === p.id ? 'is-selected' : ''}`} key={p.id}>
                <Label className="account-choice-label" htmlFor={`account-${p.id}`}>
                  <RadioGroupItem id={`account-${p.id}`} value={p.id} disabled={disabled}/>
                  <span className="account-choice-name"><strong>{p.name}</strong><small>{file?.email ?? 'Claude subscription'}</small></span>
                  {profile === p.id && <Check size={17} aria-hidden="true"/>}
                </Label>
                <div className="row wrap">{state?.profile === p.id && <Chip tone="accent">Saved for Desktop</Chip>}{status && <Chip tone={status.tone} title={status.detail ?? 'Credential status, not remaining quota'}>{status.state === 'healthy' ? 'Connected' : status.label}</Chip>}{catalogError && <Chip tone="err">Registration unavailable</Chip>}</div>
                <SubscriptionUsage profile={p} compact/>
              </Card>;
            })}
          </RadioGroup>
          {unavailable && state && <p className="inline-err" role="alert">{unavailable}</p>}
        </section>

        <section className="setup-section" aria-labelledby="model-heading">
          <div className="setup-section-head"><span className="step-number">2</span><div><h2 id="model-heading">{client === 'desktop' ? 'Models & default' : 'Starting model'}</h2><p>Only models configured for 1M context are listed here.</p></div></div>
          {client === 'desktop' ? <div className="model-choices">{MODELS.map(option => {
            const model = models.find(m => m.name === option.name);
            return <Card className={`model-choice ${model ? 'is-selected' : ''}`} key={option.name}>
              <Label htmlFor={`allow-${option.name}`}><FormInput id={`allow-${option.name}`} type="checkbox" checked={Boolean(model)} disabled={busy} onChange={e => {edit();setModels(prev => e.target.checked ? [...prev,{name:option.name,labelOverride:option.label,maxEffort:option.maxEffort,supports1m:true,prefer1m:true}] : prev.filter(m => m.name !== option.name));}}/><span><strong>{option.label}</strong><small>{option.description}</small></span><Chip>1M</Chip></Label>
              <div className="row wrap"><code>{option.name}</code>{selected && !serves(option.name) && <Chip tone="warn">Not registered</Chip>}</div>
              {model && (models[0]?.name === option.name ? <span className="default-marker"><Check size={14}/> Default for new sessions</span> : <Button size="sm" variant="secondary" disabled={busy} onClick={() => {edit();setModels(prev => [model,...prev.filter(m => m.name !== model.name)]);}}>Make default</Button>)}
            </Card>;
          })}</div> : <Field label="CLI model"><SelectField value={cliModel} onChange={e => {setCliModel(e.target.value); const cap=MODELS.find(m=>m.id===e.target.value)?.maxEffort || 'max'; if(EFFORTS.indexOf(cliEffort==='ultracode'?'xhigh':cliEffort)>EFFORTS.indexOf(cap)) setCliEffort(cap);}}>{MODELS.map(m => <SelectChoice key={m.name} value={m.name}>{m.label} · 1M</SelectChoice>)}</SelectField></Field>}
          <Button variant="secondary" onClick={onOpenSettings}>Manage allowed models</Button>
          {state?.setupRequired && client === 'desktop' && <Notice tone="warn" title="Desktop gateway setup needed"><p>Configure a Gateway in Claude Desktop first, or select its configuration folder in Settings. You can use the CLI tab now.</p></Notice>}
          {client === 'desktop' && <p className="microcopy">Desktop can still show its standard-context alternative. Its supported gateway settings cannot hide that variant. Explicit model choices in existing sessions take precedence.</p>}
          {client === 'desktop' && modelError && state && <p className="inline-err" role="alert">{modelError}</p>}
        </section>

        <section className="setup-section" aria-labelledby="behavior-heading">
          <div className="setup-section-head"><span className="step-number">3</span><div><h2 id="behavior-heading">Reasoning & behavior</h2><p>Effort, permissions, and response speed are separate controls.</p></div></div>
          <Field label={client === 'desktop' ? 'Starting reasoning effort' : 'CLI reasoning effort'} hint="Higher effort allows more reasoning and can use more of your allowance.">
            <SelectField value={client === 'desktop' ? effort : cliEffort} onChange={e => {if(client === 'desktop') {setEffort(e.target.value);edit();} else setCliEffort(e.target.value);}} disabled={busy}>
              {client === 'desktop' && <SelectChoice value="">Model default</SelectChoice>}
              {EFFORTS.map((v,i) => <SelectChoice key={v} value={v} disabled={client === 'cli' && i > EFFORTS.indexOf(cliCap)}>{EFFORT_LABELS[i]}</SelectChoice>)}
              {client === 'cli' && <SelectChoice value="ultracode" disabled={EFFORTS.indexOf(cliCap) < EFFORTS.indexOf('xhigh')}>Ultracode · xhigh + workflows</SelectChoice>}
            </SelectField>
          </Field>
          {labelError && client === 'desktop' && <p className="inline-err" role="alert">{labelError}</p>}
          {effortError && client === 'desktop' && <p className="inline-err" role="alert">{effortError}</p>}
          {client === 'desktop' && <div className="setting-rows">
            <Label htmlFor="default-model"><span><strong>Use the default model for new sessions</strong><small>Start with {selectedModelLabel} and prefer its 1M variant.</small></span><FormInput id="default-model" type="checkbox" checked={always} disabled={busy} onChange={e => {setAlways(e.target.checked);edit();}}/></Label>
            <Label htmlFor="auto-permissions"><span><strong>Offer Auto permission mode</strong><small>Makes Auto available in Claude’s permission picker. Account selection stays manual.</small></span><FormInput id="auto-permissions" type="checkbox" checked={autoMode} disabled={busy} onChange={e => {setAutoMode(e.target.checked);edit();}}/></Label>
          </div>}
          <div className="feature-grid">
            <Card className="feature-card"><div className="row"><Cpu size={18}/><strong>Ultracode</strong><Chip>Per session</Chip></div><p>Extra high reasoning plus automatic workflows. Enable inside Claude when you want it; workflows must be available.</p><CodeBlock text="/effort ultracode"/><a href="https://code.claude.com/docs/en/workflows#let-claude-decide-with-ultracode" target="_blank" rel="noreferrer">Ultracode requirements ↗</a></Card>
            <Card className="feature-card"><div className="row"><Zap size={18}/><strong>Fast mode</strong><Chip tone="warn">Usage credits</Chip></div><p>Faster Opus responses. Charged separately from included subscription usage. Availability through this gateway has not been verified.</p><Button variant="secondary" onClick={() => setFastInfo(v => !v)} aria-expanded={fastInfo}>How to enable Fast mode <ChevronDown size={14}/></Button></Card>
          </div>
          {fastInfo && <Card className="fast-details">
            <h3>Fast mode through this gateway</h3>
            <p>Use Opus 5, enable usage credits for that subscription, then use <code>/fast</code> in Claude Code CLI. Fable does not support Fast mode. This console does not turn on billing or enable Fast mode.</p>
            <CodeBlock label="Check or toggle in Claude Code CLI" text="/fast"/>
            <p>A local gateway token cannot prove Anthropic Fast mode eligibility. With token-only authentication, Claude may report it as disabled before making an upstream request.</p>
            <p>If your selected account already has Fast mode access, Anthropic documents this client-side workaround. It does not grant upstream access or enable Fast mode by itself.</p>
            {cliCommand ? <CodeBlock label="Optional CLI launch for an account with Fast mode access" text={`CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK=1 ${cliCommand}`}/> : <p>Select a registered subscription and model to see the launch command.</p>}
            <a href="https://code.claude.com/docs/en/fast-mode#use-fast-mode-behind-proxies-and-llm-gateways" target="_blank" rel="noreferrer">Read Anthropic’s gateway and billing requirements ↗</a>
          </Card>}
          <Collapsible open={advanced} onOpenChange={setAdvanced} className="advanced-options"><CollapsibleTrigger asChild><Button variant="ghost">Advanced options & session controls <ChevronDown size={15}/></Button></CollapsibleTrigger><CollapsibleContent>
            {client === 'desktop' && models.map(model => <div className="advanced-model" key={model.name}><strong>{model.name}</strong><div className="grid-2"><Field label={`Display label for ${model.name}`}><FormInput disabled={busy} value={model.labelOverride} onChange={e => {edit();setModels(prev => prev.map(m => m.name === model.name ? {...m,labelOverride:e.target.value} : m));}}/></Field><Field label={`Effort cap for ${model.name}`}><SelectField disabled={busy} value={model.maxEffort ?? ''} onChange={e => {edit();setModels(prev => prev.map(m => m.name === model.name ? {...m,maxEffort:e.target.value} : m));}}><SelectChoice value="">Model default</SelectChoice>{EFFORTS.map((v,i) => <SelectChoice key={v} value={v} disabled={i > EFFORTS.indexOf(MODELS.find(option => option.id === model.name)?.maxEffort || 'max')}>{EFFORT_LABELS[i]}</SelectChoice>)}</SelectField></Field></div></div>)}
            <div className="session-controls"><h3>Set inside each Claude session</h3><dl><div><dt>Permission mode</dt><dd>Manual, Accept edits, Plan, Auto when available, or Bypass permissions. Choose from Claude’s permission picker.</dd></div><div><dt>Reasoning</dt><dd><code>/effort</code> in CLI; the effort control beside the model in Desktop.</dd></div><div><dt>Ultracode off</dt><dd><code>/effort high</code> returns to regular reasoning.</dd></div><div><dt>Context</dt><dd><code>/context</code> in CLI; the context indicator beside the model in Desktop.</dd></div><div><dt>Session scope</dt><dd>This setup uses your shared local profile. Cloud sessions and Remote Control are not enabled by this screen.</dd></div></dl></div>
          </CollapsibleContent></Collapsible>
        </section>
      </div>

      <aside className="setup-summary" aria-label="Review your selection">
        <Card className="summary-card"><div className="row"><Gauge size={18}/><h2>{client === 'desktop' ? 'Your Desktop setup' : 'Your CLI launch'}</h2></div>
          <dl><div><dt>Subscription</dt><dd>{selected?.profile.name ?? 'Choose an account'}</dd></div><div><dt>{client === 'desktop' ? 'Default model' : 'Model'}</dt><dd>{client === 'desktop' ? selectedModelLabel : MODELS.find(m => m.name === cliModel)?.label}</dd></div><div><dt>Context</dt><dd>1M configured</dd></div><div><dt>Effort</dt><dd>{client === 'desktop' ? effort || 'Model default' : cliEffort}</dd></div><div><dt>Account switching</dt><dd>Manual only</dd></div></dl>
          {client === 'desktop' ? <>
            <Chip tone={dirty ? 'warn' : 'plain'}>{!state ? 'Not loaded' : dirty ? 'Unsaved changes' : 'Matches saved settings'}</Chip>
            <p>Apply writes the Desktop configuration and keeps a backup. Restart Claude to load it; running sessions are not switched here.</p>
            <Button disabled={!canSave} onClick={() => void save()}>{busy ? 'Saving…' : dirty ? 'Apply to Claude Desktop' : 'Configuration saved'}</Button>
          </> : <><p>Set <code>CLIPROXY_API_KEY</code> to a proxy client key, then run this from your project folder. Find your client keys in Advanced connections.</p>{cliCommand ? <CodeBlock label="Launch Claude CLI" text={cliCommand}/> : <p className="inline-err">Choose an enabled account with this model registered.</p>}<p className="microcopy">Uses the standard Claude CLI and its existing local history. No custom shell wrapper is required. Existing sessions keep their own subscription.</p></>}
        </Card>
      </aside>
    </div>
  </div>;
}
