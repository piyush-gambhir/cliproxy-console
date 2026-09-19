import {Button} from './ui/button';
import {FormInput} from './controls';
import { useCallback, useState } from 'react';
import { api } from '../api.ts';
import type { Settings } from '../types.ts';
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
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl);
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [key, setKey] = useState('');
  const [clientKey, setClientKey] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const patch: { displayName?: string; proxyUrl?: string; managementKey?: string; clientApiKey?: string } = {};
      if (displayName.trim() !== settings.displayName) patch.displayName = displayName.trim();
      if (proxyUrl.trim() !== settings.proxyUrl) patch.proxyUrl = proxyUrl.trim();
      if (clientKey !== '') patch.clientApiKey = clientKey;
      if (key !== '') patch.managementKey = key;
      onSaved(await api.saveSettings(patch));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [key, clientKey, settings, onSaved, proxyUrl, displayName]);

  const clearKey = useCallback(async (field: 'managementKey' | 'clientApiKey') => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.saveSettings({ [field]: '' }));
      if (field === 'managementKey') setKey(''); else setClientKey('');
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
      <Field label="Proxy URL" hint={settings.sources.proxyUrl === 'env' ? 'Set by CLIPROXY_URL. Change the process environment to override it.' : 'Where CLIProxyAPI listens.'}>
        <FormInput className="mono" type="text" disabled={settings.sources.proxyUrl === 'env'} value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} />
      </Field>

      <Field
        label="Management key"
        hint={
          settings.keySource === 'env'
            ? 'Currently taken from $CLIPROXY_MGMT_KEY, which overrides anything saved here.'
            : settings.hasManagementKey
              ? 'A key is stored. Type a new one to replace it; leave blank to keep it.'
              : 'Must match remote-management.secret-key in the proxy config.'
        }
      >
        <FormInput
          className="mono"
          type="password"
          autoComplete="off"
          placeholder={settings.hasManagementKey ? '•••••••• (unchanged)' : 'paste the secret key'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>

      {settings.hasStoredManagementKey ? (
        <div className="row">
          <Button className="btn sm danger" disabled={busy} onClick={() => void clearKey('managementKey')}>
            Clear stored key
          </Button>
        </div>
      ) : null}

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
