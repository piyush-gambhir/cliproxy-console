import {Button} from './ui/button';
import {DeploymentSettings} from './DeploymentSettings';
import {FormInput, SelectField, SelectChoice} from './controls';
import {Card} from './ui/card';
import {Collapsible, CollapsibleTrigger, CollapsibleContent} from './ui/collapsible';
import { useCallback, useState } from 'react';
import { api } from '../api.ts';
import type { Settings, ClaudeModelOption } from '../types.ts';
import { Drawer, ErrorLine, Field, Notice } from './ui.tsx';

export function SettingsDrawer({
  settings,
  onClose,
  onSaved,
}: {
  settings: Settings;
  onClose: () => void;
  onSaved: (next: Settings) => void;
}) {
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [models, setModels] = useState(settings.claudeModels);
  const [backgroundModel,setBackgroundModel] = useState(settings.claudeBackgroundModel);
  const [subagentModel,setSubagentModel] = useState(settings.claudeSubagentModel);
  const [retention,setRetention] = useState(settings.receiptRetentionDays);
  const [cliEffort, setCliEffort] = useState(settings.cliEffort);
  const [claudeConfigDir, setClaudeConfigDir] = useState(settings.claudeConfigDir);
  const [desktopConfigDir, setDesktopConfigDir] = useState(settings.desktopConfigDir);
  const [clientKey, setClientKey] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const patch: Parameters<typeof api.saveSettings>[0] = {};
      if (JSON.stringify(models) !== JSON.stringify(settings.claudeModels)) patch.claudeModels = models;
      if(backgroundModel !== settings.claudeBackgroundModel) patch.claudeBackgroundModel=backgroundModel;
      if(subagentModel !== settings.claudeSubagentModel) patch.claudeSubagentModel=subagentModel;
      if(retention !== settings.receiptRetentionDays) patch.receiptRetentionDays=retention;
      if (cliEffort !== settings.cliEffort) patch.cliEffort = cliEffort;
      if (claudeConfigDir !== settings.claudeConfigDir) patch.claudeConfigDir = claudeConfigDir;
      if (desktopConfigDir !== settings.desktopConfigDir) patch.desktopConfigDir = desktopConfigDir;
      if (displayName.trim() !== settings.displayName) patch.displayName = displayName.trim();
      if (clientKey !== '') patch.clientApiKey = clientKey;
      onSaved(await api.saveSettings(patch));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [backgroundModel, subagentModel, retention, clientKey, settings, onSaved, displayName, models, cliEffort, claudeConfigDir, desktopConfigDir]);

  const clearKey = useCallback(async (field: 'clientApiKey') => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.saveSettings({ [field]: '' }));
      setClientKey('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [onSaved]);

  return (
    <Drawer
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button className="btn" onClick={onClose}>
            Cancel
          </Button>
          <Button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Console name" hint={settings.sources.displayName === 'env' ? 'Set by CLIPROXY_DISPLAY_NAME. Change the process environment to override it.' : 'Shown in the header and browser tab; saved only on this computer.'}>
        <FormInput disabled={settings.sources.displayName === 'env'} value={displayName} maxLength={80} onChange={e => setDisplayName(e.target.value)} />
      </Field>
      <Notice tone="plain" title="Connected directly to CLIProxyAPI"><p className="mono">{settings.proxyUrl}</p><p>The proxy owns these settings. Your management key authenticates this browser tab and is never copied into application settings.</p></Notice>

      <Field label="Client API key (optional)" hint={settings.clientKeySource === 'env'
        ? 'Currently taken from CLIPROXY_API_KEY. The environment overrides any saved value.'
        : 'An existing CLIProxyAPI client key for model discovery and client setup. Leave blank to keep it; this does not create a key in the proxy.'}>
        <FormInput className="mono" type="password" autoComplete="off"
          placeholder={settings.hasClientApiKey ? '•••••••• (unchanged)' : 'optional proxy client key'}
          value={clientKey} onChange={e => setClientKey(e.target.value)} />
      </Field>
      {settings.hasStoredClientApiKey && <div className="row">
        <Button className="btn sm danger" disabled={busy} onClick={() => void clearKey('clientApiKey')}>Clear stored client key</Button>
      </div>}

      <Collapsible className="settings-section" defaultOpen>
        <CollapsibleTrigger asChild><Button variant="secondary">Allowed Claude models · 1M</Button></CollapsibleTrigger>
        <CollapsibleContent className="settings-fields">
          <p className="microcopy">Only add models whose provider supports 1M context. The first model is the default CLI choice. After changing this list, apply the chosen models in Claude setup to update Desktop.</p>
          {settings.sources.claudeModels === 'env' && <p className="microcopy">Controlled by CLIPROXY_CLAUDE_MODELS.</p>}
          {models.map((model, index) => <Card className="settings-model" key={index}>
            <Field label={`Model ${index + 1} ID`}><FormInput className="mono" disabled={settings.sources.claudeModels === 'env'} value={model.id} onChange={e => setModels(current => current.map((m,i) => i === index ? {...m,id:e.target.value} : m))}/></Field>
            <Field label={`Model ${index + 1} label`}><FormInput disabled={settings.sources.claudeModels === 'env'} value={model.label} onChange={e => setModels(current => current.map((m,i) => i === index ? {...m,label:e.target.value} : m))}/></Field>
            <Field label={`Model ${index + 1} effort cap`}><SelectField disabled={settings.sources.claudeModels === 'env'} value={model.maxEffort} onChange={e => setModels(current => current.map((m,i) => i === index ? {...m,maxEffort:e.target.value as ClaudeModelOption['maxEffort']} : m))}>{['low','medium','high','xhigh','max'].map(value => <SelectChoice key={value} value={value}>{value}</SelectChoice>)}</SelectField></Field>
            <div className="row wrap"><span className="microcopy">1M context{index === 0 ? ' · CLI default' : ''}</span>
              {index > 0 && <Button size="sm" variant="secondary" disabled={settings.sources.claudeModels === 'env'} onClick={() => setModels(current => [model,...current.filter((_,i) => i !== index)])}>Make default</Button>}
              <Button size="sm" variant="ghost" disabled={models.length === 1 || settings.sources.claudeModels === 'env'} onClick={() => setModels(current => current.filter((_,i) => i !== index))}>Remove model {index + 1}</Button>
            </div>
          </Card>)}
          <Button variant="secondary" disabled={settings.sources.claudeModels === 'env'} onClick={() => setModels(current => [...current,{id:'',label:'',contextWindow:1000000,maxEffort:'max'}])}>Add 1M model</Button>
          <Field label="Default CLI reasoning effort"><SelectField value={cliEffort} disabled={settings.sources.cliEffort === 'env'} onChange={e => setCliEffort(e.target.value as Settings['cliEffort'])}>{['low','medium','high','xhigh','max'].map(value => <SelectChoice key={value} value={value}>{value}</SelectChoice>)}</SelectField></Field>
          <Field label="Background helper model" hint="The Haiku role uses this model. Choosing Opus here makes background work consume Opus usage too. Apply in Claude setup to update shared local settings."><SelectField value={backgroundModel} disabled={settings.sources.claudeBackgroundModel === 'env'} onChange={e => setBackgroundModel(e.target.value)}><SelectChoice value="">Use the selected main model at setup</SelectChoice>{models.filter(m=>m.id).map(m=><SelectChoice key={m.id} value={m.id}>{m.label} · 1M</SelectChoice>)}</SelectField></Field>
          <Field label="Default subagent model" hint="A subagent with its own model setting can override this default. The gateway still enforces the allowed model list and selected account."><SelectField value={subagentModel} disabled={settings.sources.claudeSubagentModel === 'env'} onChange={e => setSubagentModel(e.target.value)}><SelectChoice value="">Use the selected main model at setup</SelectChoice>{models.filter(m=>m.id).map(m=><SelectChoice key={m.id} value={m.id}>{m.label} · 1M</SelectChoice>)}</SelectField></Field>
          <Notice tone="plain" title="Claude Desktop controls its own picker"><p>The console lists only 1M models and defaults clients to 1M. Claude Desktop also creates a standard-context row internally; its supported settings cannot hide that row. Existing sessions may need the 1M variant selected once.</p></Notice>
        </CollapsibleContent>
      </Collapsible>
      <Collapsible className="settings-section">
        <CollapsibleTrigger asChild><Button variant="secondary">Client connections and folders</Button></CollapsibleTrigger>
        <CollapsibleContent className="settings-fields">
          <Field label="Claude CLI configuration folder" hint="Shared local profile. Choosing another folder does not move conversation history."><FormInput className="mono" disabled={settings.sources.claudeConfigDir === 'env'} value={claudeConfigDir} onChange={e => setClaudeConfigDir(e.target.value)}/></Field>
          <Field label="Claude Desktop configuration folder" hint="Select the existing configLibrary directory containing _meta.json."><FormInput className="mono" disabled={settings.sources.desktopConfigDir === 'env'} value={desktopConfigDir} onChange={e => setDesktopConfigDir(e.target.value)}/></Field>
          <p className="microcopy">Fields controlled by the server environment are locked. Desktop and CLI model, subscription, effort, and permission defaults are managed in Claude setup. Proxy routing is managed in Request settings.</p>
        </CollapsibleContent>
      </Collapsible>

      <Field label="Request history retention (days)" hint="Keep routing, model and token metadata for 1–365 days in local SQLite. No prompts, responses or keys are stored in this history."><FormInput type="number" min={1} max={365} value={retention} onChange={e=>setRetention(Number(e.target.value))}/></Field>
      <DeploymentSettings/>
      <Notice tone="plain" title="Local SQLite database">
        <p className="muted mono">{settings.configFile}</p>
        <p className="muted">
          Keys are never returned by Settings. Client setup previews can include the client key. The database is unencrypted, readable only by your OS user; environment values are never copied into it.
        </p>
      </Notice>

      <ErrorLine error={error} />
    </Drawer>
  );
}
