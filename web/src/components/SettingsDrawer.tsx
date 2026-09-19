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
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const patch: { displayName: string; proxyUrl: string; managementKey?: string } = { displayName: displayName.trim(), proxyUrl: proxyUrl.trim() };
      if (key !== '') patch.managementKey = key;
      onSaved(await api.saveSettings(patch));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [key, onSaved, proxyUrl, displayName]);

  const clearKey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.saveSettings({ managementKey: '' }));
      setKey('');
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
      <Field label="Console name" hint="Shown in the header and browser tab; saved only on this computer.">
        <FormInput value={displayName} maxLength={80} onChange={e => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Proxy URL" hint="Where CLIProxyAPI listens.">
        <FormInput className="mono" type="text" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} />
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

      {settings.hasManagementKey && settings.keySource === 'file' ? (
        <div className="row">
          <Button className="btn sm danger" disabled={busy} onClick={() => void clearKey()}>
            Clear stored key
          </Button>
        </div>
      ) : null}

      <Notice tone="plain" title="Where this is kept">
        <p className="muted mono">{settings.configFile}</p>
        <p className="muted">
          The key stays on the server side of this console — the browser only ever learns whether one is set.
        </p>
      </Notice>

      <ErrorLine error={error} />
    </Drawer>
  );
}
