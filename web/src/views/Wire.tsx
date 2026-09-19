import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Label} from '@/components/ui/label';
import {SelectField,SelectChoice,FormInput} from '@/components/controls';
import { SubscriptionUsage } from '../components/SubscriptionUsage.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api.ts';
import type { Profile, Targets, WirePlan } from '../types.ts';
import { CodeBlock, Chip, Empty, ErrorLine, Field, ManagementOffNotice, Notice } from '../components/ui.tsx';

interface Props {
  onOpenSettings: () => void;
  toast: (tone: 'ok' | 'err', title: string, detail?: string) => void;
}

function maskKey(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function Wire({ onOpenSettings, toast }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState(() => new URLSearchParams(window.location.hash.split('?')[1]).get('profile') ?? '');
  const routingMode = 'manual';
  const [modelsLoading, setModelsLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [keys, setKeys] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [hasConfiguredKey, setHasConfiguredKey] = useState(false);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [target, setTarget] = useState<'project' | 'profile-global'>('project');
  const [dir, setDir] = useState('');
  const [plan, setPlan] = useState<WirePlan | null>(null);
  const [snippet, setSnippet] = useState('');
  const [snippetError, setSnippetError] = useState<unknown>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [planError, setPlanError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const profile = useMemo(() => profiles.find((p) => p.id === profileId), [profileId, profiles]);
  const prefix = profile?.lastKnownPrefix ?? '';
  const sentModel = profile?.authFile.startsWith('claude-') ? model : prefix && !model.startsWith(`${prefix}/`) ? `${prefix}/${model}` : model;

  useEffect(() => {
    void (async () => {
      try {
        const [profileRes, settings, targetRes] = await Promise.all([api.profiles(), api.settings(), api.targets()]);
        setHasConfiguredKey(settings.hasClientApiKey);
        const keyRes = settings.hasClientApiKey ? {'api-keys': []} : await api.apiKeys();
        setProfiles(profileRes.profiles);

        const list = keyRes['api-keys'] ?? [];
        setKeys(list);
        setApiKey((prev) => prev || list[0] || '');
        setTargets(targetRes);
      } catch (err) {
        setLoadError(err);
        try {
          const profileRes = await api.profiles();
          setProfiles(profileRes.profiles);

        } catch {
          /* already reported */
        }
      }
    })();
  }, []);

  useEffect(() => {
    let live = true;
    setModel(''); setModels([]); setPlan(null); setSnippet('');
    if (!profile) { setModelsLoading(false); return; }
    setModelsLoading(true);
    const request = api.authFileModels(profile!.authFile).then(res => res.models.map(m => m.id).filter(id => prefix && id.startsWith(`${prefix}/`)).map(id => profile.authFile.startsWith('claude-') ? id.slice(prefix.length+1) : id).filter(id => !profile.authFile.startsWith('claude-') || ['claude-opus-5','claude-fable-5-1'].includes(id)));
    request.then(ids => {
      if (!live) return;
      setModels(ids); setModel(ids[0] ?? ''); setLoadError(null);
    }).catch(err => { if (live) setLoadError(err); })
      .finally(() => { if (live) setModelsLoading(false); });
    return () => { live = false; };
  }, [profile, routingMode, prefix]);

  // Default the directory when the target kind changes.
  useEffect(() => {
    if (target === 'profile-global' && targets && !targets.globals.some((g) => g.path === dir)) {
      setDir(targets.globals[0]?.path ?? '');
    }
    if (target === 'project' && targets?.globals.some((g) => g.path === dir)) {
      setDir(targets.recents[0]?.path ?? '');
    }
  }, [target, targets, dir]);

  const ready = Boolean((profile && prefix) && !modelsLoading && model && (apiKey || hasConfiguredKey) && dir.trim());

  useEffect(() => {
    let live = true;
    setPlan(null); setPlanError(null);
    if (!ready) return;
    const timer = setTimeout(() => {
      api.wirePreview({target, path: dir, model, apiKey, profile: profileId, routingMode})
        .then(next => { if (live) setPlan(next); })
        .catch(err => { if (live) setPlanError(err); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [apiKey, dir, model, profileId, ready, target, routingMode]);

  useEffect(() => {
    setSnippet(''); setSnippetError(null);
    if ((!profile || !prefix) || !model) {
      setSnippet('');
      return;
    }
    let live = true;
    api
      .snippet({ profile: profile?.id ?? '', model, routingMode })
      .then((res) => live && setSnippet(res.snippet))
      .catch(err => { if (live) setSnippetError(err); });
    return () => {
      live = false;
    };
  }, [model, prefix, profile, routingMode]);

  const write = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.wire({ target, path: dir, model, prefix, apiKey, profile: profileId, routingMode });
      toast('ok', 'Settings written', result.displayFile);
      setPlan(result);
      setTargets(await api.targets());
    } catch (err) {
      toast('err', 'Could not write settings', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [apiKey, dir, model, prefix, profileId, target, toast, routingMode]);

  const refreshAccounts = async () => {
    setBusy(true);
    try { setProfiles((await api.profiles()).profiles); }
    catch (err) { setLoadError(err); }
    finally { setBusy(false); }
  };

  const prepareAccount = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const updated = await api.savePrefix(profile.id, `account-${profile.id}`);
      setProfiles(current => current.map(p => p.id === updated.id ? updated : p));
      toast('ok', 'Account route created');
    } catch (err) { toast('err', 'Could not create account route', (err as Error).message); }
    finally { setBusy(false); }
  };

  const managementError = loadError instanceof ApiError && loadError.isManagementDisabled ? loadError : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Advanced connections</h1>
          <p>
            Choose the subscription and model for a project or Claude configuration. Preview the settings before saving.
          </p>
        </div>
        <Button className="btn" disabled={busy} onClick={() => void refreshAccounts()}>Refresh accounts</Button>
      </div>

      {managementError ? <ManagementOffNotice error={managementError} onOpenSettings={onOpenSettings} /> : null}
      {loadError && !managementError ? (
        <Notice tone="err" title="Could not load proxy data">
          <ErrorLine error={loadError} />
        </Notice>
      ) : null}

      <Notice tone="plain" title="Use only the subscription you select">
        <p>If its usage is exhausted, requests fail until you choose another subscription or the limit resets. Claude’s default model aliases use this selection too; explicit model overrides can change it.</p>
      </Notice>
      {profile && <SubscriptionUsage key={profile.id} profile={profile} />}
      {profiles.length === 0 ? (
        <Empty title="No profiles yet — name an account on the Subscriptions screen first." />
      ) : (
        <>
          <Card className="card">
            <div className="grid-3">
              <Field label="Subscription">
                {profile && !prefix ? <div><p className="muted">This account needs a unique route. You can rename its prefix in Edit profile later.</p><Button className="btn" disabled={busy} onClick={() => void prepareAccount()}>{busy ? 'Creating…' : 'Create unique account route'}</Button></div> : null}
                <SelectField value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  <SelectChoice value="">Choose a subscription…</SelectChoice>
                  {profiles.map((p) => (
                    <SelectChoice key={p.id} value={p.id}>
                      {p.name}
                    </SelectChoice>
                  ))}
                </SelectField>
              </Field>

              <Field
                label="Model"
                hint={
                  models.length === 0
                    ? (modelsLoading ? 'Loading models…' : 'No verified models available for this selection.')
                    : `Sent as ${sentModel || 'model'}`
                }
              >
                <SelectField className="mono" disabled={modelsLoading || models.length === 0} value={model} onChange={e => setModel(e.target.value)}>
                  <SelectChoice value="">Choose a model…</SelectChoice>
                  {models.map(m => <SelectChoice key={m} value={m}>{m}</SelectChoice>)}
                </SelectField>
              </Field>

              <Field
                label="Proxy API key"
                hint={hasConfiguredKey ? 'Using the client key from Settings or the server environment.' : keys.length === 0 ? 'No client keys configured on the proxy.' : `${keys.length} available`}
              >
                {keys.length === 0 && !hasConfiguredKey ? (
                  <FormInput
                    className="mono"
                    type="text"
                    placeholder="paste a client key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                ) : (
                  <SelectField className="mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)}>
                    {hasConfiguredKey && <SelectChoice value="">Configured key (server)</SelectChoice>}
                    {keys.map((k) => (
                      <SelectChoice key={k} value={k}>
                        {maskKey(k)}
                      </SelectChoice>
                    ))}
                  </SelectField>
                )}
              </Field>
            </div>

            <div className="row wrap">
              <RadioGroup aria-label="Configuration scope" value={target} onValueChange={value => setTarget(value as 'project'|'profile-global')} className="flex gap-5">
                <Label className="row"><RadioGroupItem value="project" />Project folder</Label>
                <Label className="row"><RadioGroupItem value="profile-global" />Shared Claude profile</Label>
              </RadioGroup>
              <span className="dim">
                {target === 'project' ? 'writes <dir>/.claude/settings.json' : 'writes <dir>/settings.json'}
              </span>
            </div>

            {target === 'profile-global' ? (
              <Field label="Config directory">
                <SelectField className="mono" value={dir} onChange={(e) => setDir(e.target.value)}>
                  {(targets?.globals ?? []).map((g) => (
                    <SelectChoice key={g.path} value={g.path}>
                      {g.display}
                      {g.exists ? '' : ' (does not exist yet)'}
                    </SelectChoice>
                  ))}
                </SelectField>
              </Field>
            ) : (
              <Field label="Project folder" hint="Must be inside your home directory.">
                <FormInput
                  className="mono"
                  type="text"
                  placeholder="~/code/some-repo"
                  value={dir}
                  onChange={(e) => setDir(e.target.value)}
                />
                {targets && targets.recents.length > 0 ? (
                  <div className="row wrap" style={{ marginTop: 4 }}>
                    <span className="dim">recent:</span>
                    {targets.recents.map((r) => (
                      <Button key={r.path} className="btn sm ghost mono" onClick={() => setDir(r.path)}>
                        {r.display}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </Field>
            )}
          </Card>

          {planError ? (
            <div style={{ marginTop: 16 }}>
              <Notice tone="err" title="Cannot use this selection">
                <ErrorLine error={planError} />
              </Notice>
            </div>
          ) : null}

          {plan ? (
            <>
              <div className="section-head">
                <h2>Preview</h2>
                <span className="dim mono">{plan.displayFile}</span>
                {plan.fileExists ? <Chip tone="plain">will be backed up</Chip> : <Chip tone="ok">new file</Chip>}
                {plan.overwrites.length > 0 ? (
                  <Chip tone="warn" title={plan.overwrites.join(', ')}>
                    overwrites {plan.overwrites.length}
                  </Chip>
                ) : null}
              </div>
              <Card className="card">
                <CodeBlock label="settings.json after the merge" text={JSON.stringify(plan.merged, null, 2)} />
                <div className="row">
                  <Button className="btn primary" disabled={busy || !ready} onClick={() => void write()}>
                    {busy ? 'Writing…' : 'Write settings'}
                  </Button>
                  {plan.displayBackupFile ? (
                    <span className="muted mono">backed up to {plan.displayBackupFile}</span>
                  ) : null}
                </div>
              </Card>
            </>
          ) : null}

          <ErrorLine error={snippetError} />
          {snippet ? (
            <>
              <div className="section-head">
                <h2>Or paste this into ~/.zshrc</h2>
              </div>
              <Card className="card">
                <CodeBlock text={snippet} />
                <span className="muted">
                  Set <code>CLIPROXY_API_KEY</code> in your shell before using this function. Copied commands never contain a key.
                </span>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
