import {Button} from './ui/button';
import {Label} from './ui/label';
import {FormInput} from './controls';
import { useCallback, useEffect, useState } from 'react';
import { addressable, api } from '../api.ts';
import type { AuthFile, ModelEntry, Profile } from '../types.ts';
import { Drawer, ErrorLine, Field, Notice } from './ui.tsx';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#f43f5e'];

function localDateTime(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const PREFIX_RE = /^[A-Za-z0-9._-]*$/;

export function ProfileEditor({
  profile,
  file,
  onClose,
  onSaved,
}: {
  profile: Profile;
  file: AuthFile | undefined;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.color);
  const [prefix, setPrefix] = useState(profile.lastKnownPrefix ?? '');
  const [resetAt, setResetAt] = useState(profile.resetAt ? localDateTime(profile.resetAt) : '');
  const [subscriptionNote, setSubscriptionNote] = useState(profile.subscriptionNote ?? '');
  const [note, setNote] = useState(file?.note ?? '');
  const [disabled, setDisabled] = useState(file?.disabled ?? false);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsError, setModelsError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .authFileModels(profile.authFile)
      .then((res) => live && setModels(res.models))
      .catch((err) => live && setModelsError(err));
    return () => {
      live = false;
    };
  }, [profile.authFile]);

  const prefixInvalid = !PREFIX_RE.test(prefix.trim());

  const save = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const trimmedPrefix = prefix.trim();
      if (!PREFIX_RE.test(trimmedPrefix)) {
        throw new Error('prefix may only contain letters, digits, dot, dash and underscore');
      }

      // Update proxy-owned fields separately from the console's reset-date notes.
      const fields: Record<string, unknown> = { note: note.trim() };
      if (trimmedPrefix !== (profile.lastKnownPrefix ?? '')) await api.savePrefix(profile.id, trimmedPrefix);
      await api.patchAuthFileFields(profile.authFile, fields);

      // disabled has its own endpoint, which also updates the file on disk.
      if ((file?.disabled ?? false) !== disabled) {
        await api.setAuthFileDisabled(profile.authFile, disabled);
      }

      // Console-owned fields, plus the prefix cache the Management API cannot give back.
      await api.updateProfile(profile.id, {
        name: name.trim(),
        color,
        resetAt: resetAt ? new Date(resetAt).toISOString() : null,
        subscriptionNote,
      });

      onSaved(`Saved ${name.trim()}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [color, disabled, file, name, note, prefix, resetAt, subscriptionNote, profile.authFile, profile.id, profile.lastKnownPrefix, onSaved]);

  return (
    <Drawer
      title="Edit subscription"
      onClose={onClose}
      footer={
        <>
          <span className="muted mono">{profile.authFile}</span>
          <span className="spacer" />
          <Button className="btn" onClick={onClose}>
            Cancel
          </Button>
          <Button className="btn primary" disabled={busy || name.trim() === '' || prefixInvalid} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Name" hint="Console-only. The proxy never sees it.">
        <FormInput type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label="Colour">
        <div className="swatches">
          {COLORS.map((c) => (
            <Button
              key={c}
              style={{ background: c }}
              aria-pressed={c === color}
              aria-label={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </Field>

      <Field
        label="Prefix"
        hint={
          <>
            One segment, no slash — the proxy drops a slashed prefix when it reloads the file. Addresses this
            account as <code>{addressable('claude-opus-5', prefix || undefined)}</code>.
          </>
        }
      >
        <FormInput
          className="mono"
          type="text"
          value={prefix}
          placeholder="work"
          onChange={(e) => setPrefix(e.target.value)}
        />
        <Button className="btn sm" onClick={() => setPrefix(`account-${profile.id}`)}>Generate unique prefix</Button>
        <span className="muted">A unique prefix is required for explicit account selection. Changing it requires updating existing client settings.</span>
        {prefixInvalid ? <div className="inline-err">letters, digits, dot, dash and underscore only</div> : null}
      </Field>

      <Field label="Recorded reset date" hint="Optional fallback when live usage is unavailable. Enter in your local timezone; this never resets usage or changes billing.">
        <FormInput type="datetime-local" value={resetAt} onChange={e => setResetAt(e.target.value)} />
      </Field>
      <Field label="Subscription note" hint="For example: weekly limit resets Friday; use before renewal. Stored only in this console.">
        <FormInput type="text" maxLength={500} value={subscriptionNote} onChange={e => setSubscriptionNote(e.target.value)} />
      </Field>

      <Field label="Note" hint="Stored on the credential in the proxy.">
        <FormInput type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <Field label="State">
        <Label className="row">
          <FormInput
            type="checkbox"
            checked={disabled}
            style={{ width: 'auto' }}
            onChange={(e) => setDisabled(e.target.checked)}
          />
          <span>Disabled — the proxy will not route to this account</span>
        </Label>
      </Field>

      <div>
        <div className="section-head" style={{ margin: '0 0 8px' }}>
          <h2>Addressable model ids</h2>
        </div>
        {modelsError ? (
          <ErrorLine error={modelsError} />
        ) : models.length === 0 ? (
          <Notice tone="plain">
            <p className="muted">
              The proxy lists no models for this credential yet. It registers them after the first successful
              refresh.
            </p>
          </Notice>
        ) : (
          <pre className="code">{models.map((m) => m.id.startsWith(`${prefix.trim()}/`) ? m.id : addressable(m.id, prefix.trim() || undefined)).join('\n')}</pre>
        )}
      </div>

      <ErrorLine error={error} />
    </Drawer>
  );
}
