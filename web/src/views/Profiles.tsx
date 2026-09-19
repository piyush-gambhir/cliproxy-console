import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {FormInput} from '@/components/controls';
import { SubscriptionUsage } from '../components/SubscriptionUsage.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountStatus, addressable, api, ApiError } from '../api.ts';
import type { AuthFile, Profile } from '../types.ts';
import { AddAccount } from '../components/AddAccount.tsx';
import { ProfileEditor } from '../components/ProfileEditor.tsx';
import { Chip, Empty, ErrorLine, Field, ManagementOffNotice, Notice } from '../components/ui.tsx';
import { Drawer } from '../components/ui.tsx';

interface Props {
  proxyUrl: string;
  onOpenSettings: () => void;
  toast: (tone: 'ok' | 'err', title: string, detail?: string) => void;
}

export function Profiles({ onOpenSettings, toast }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [modelCounts, setModelCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [naming, setNaming] = useState<AuthFile | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [profileRes, fileRes] = await Promise.all([api.profiles(), api.authFiles()]);
      setProfiles(profileRes.profiles);
      setFiles(fileRes.files);
      const counts: Record<string, number> = {};
      await Promise.all(
        fileRes.files.map(async (f) => {
          try {
            counts[f.name] = (await api.authFileModels(f.name)).models.length;
          } catch {
            counts[f.name] = -1;
          }
        }),
      );
      setModelCounts(counts);
    } catch (err) {
      setError(err);
      try {
        setProfiles((await api.profiles()).profiles);
      } catch {
        /* the profile store is local; if it fails too, the error above says enough */
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byName = useMemo(() => new Map(files.map((f) => [f.name, f])), [files]);
  const mapped = useMemo(() => new Set(profiles.map((p) => p.authFile)), [profiles]);
  const unassigned = useMemo(() => files.filter((f) => !mapped.has(f.name)), [files, mapped]);

  const toggleDisabled = useCallback(
    async (profile: Profile, file: AuthFile) => {
      try {
        await api.setAuthFileDisabled(file.name, !file.disabled);
        toast('ok', `${profile.name} ${file.disabled ? 'enabled' : 'disabled'}`);
        await refresh();
      } catch (err) {
        toast('err', 'Could not change state', (err as Error).message);
      }
    },
    [refresh, toast],
  );

  const managementError = error instanceof ApiError && error.isManagementDisabled ? error : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Subscriptions</h1>
          <p>Your subscriptions, their available usage, and when each limit resets.</p>
        </div>
        <div className="actions">
          <Button className="btn" onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button className="btn primary" onClick={() => setAdding(true)}>
            Add account
          </Button>
        </div>
      </div>

      {managementError ? <ManagementOffNotice error={managementError} onOpenSettings={onOpenSettings} /> : null}
      {error && !managementError ? (
        <Notice tone="err" title="Could not load accounts">
          <ErrorLine error={error} />
        </Notice>
      ) : null}

      <Notice tone="plain" title="You choose which subscription to use">
        <p>Compare remaining usage and reset dates. Select Use in Claude to choose an account, review its models, and apply it to Desktop or copy a CLI launch command.</p>
      </Notice>

      {loading ? (
        <Empty title="Loading accounts…" />
      ) : profiles.length === 0 ? (
        <Empty
          title={
            unassigned.length > 0
              ? 'No profiles yet — name one of the accounts below to get started.'
              : 'No accounts on the proxy yet.'
          }
          action={
            unassigned.length === 0 ? (
              <Button className="btn primary" onClick={() => setAdding(true)}>
                Add account
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="cards">
          {profiles.map((profile) => {
            const file = byName.get(profile.authFile);
            const status = file ? accountStatus(file) : null;
            const count = modelCounts[profile.authFile];
            return (
              <article className="card" key={profile.id}>
                <div className="card-top">
                  <div className="swatch" style={{ background: profile.color }} />
                  <div>
                    <div className="card-name">{profile.name}</div>
                    <div className="card-sub">{file?.email ?? file?.label ?? profile.authFile}</div>
                  </div>
                  <div className="card-actions">
                    {file ? (
                      <>
                        <Button className="btn sm primary" disabled={file.disabled} onClick={() => { window.location.hash = `${profile.authFile.startsWith('claude-') ? 'desktop' : 'wire'}?profile=${encodeURIComponent(profile.id)}`; }}>
                          {profile.authFile.startsWith('claude-') ? 'Use in Claude' : 'Connect client'}
                        </Button>
                        <Button className="btn sm" onClick={() => setEditing(profile)}>
                          Edit
                        </Button>
                        <Button className="btn sm" onClick={() => void toggleDisabled(profile, file)}>
                          {file.disabled ? 'Enable' : 'Disable'}
                        </Button>
                      </>
                    ) : null}
                    <Button className="btn sm danger" onClick={() => setDeleting(profile)}>
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="card-chips">
                  <Chip tone="plain">{file?.provider ?? 'unknown provider'}</Chip>
                  {status ? (
                    <Chip tone={status.tone} title={status.detail}>
                      {status.label}
                    </Chip>
                  ) : (
                    <Chip tone="err" title="No auth file on the proxy matches this profile">
                      missing on proxy
                    </Chip>
                  )}
                  {profile.lastKnownPrefix ? (
                    <Chip tone="accent" title="Prefix this console last wrote — the Management API does not read it back">
                      {addressable('…', profile.lastKnownPrefix)}
                    </Chip>
                  ) : null}
                </div>

                {file ? (
                  <dl className="meta">
                    <div>
                      <dt>models</dt>
                      <dd>{count === undefined ? '…' : count < 0 ? '—' : count}</dd>
                    </div>
                    <div>
                      <dt>ok / fail</dt>
                      <dd>
                        {file.success ?? 0} / {file.failed ?? 0}
                      </dd>
                    </div>
                    {file.note ? (
                      <div>
                        <dt>note</dt>
                        <dd>{file.note}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                <SubscriptionUsage key={profile.id} profile={profile} />
              </article>
            );
          })}
        </div>
      )}

      {unassigned.length > 0 ? (
        <>
          <div className="section-head">
            <h2>Unassigned accounts</h2>
            <span className="dim">{unassigned.length} on the proxy with no profile</span>
          </div>
          <div className="strip">
            {unassigned.map((file) => {
              const status = accountStatus(file);
              return (
                <div className="strip-row" key={file.name}>
                  <span className="name">{file.name}</span>
                  <Chip tone="plain">{file.provider}</Chip>
                  <Chip tone={status.tone} title={status.detail}>
                    {status.label}
                  </Chip>
                  {file.email ? <span className="dim">{file.email}</span> : null}
                  <span className="spacer" />
                  <Button className="btn sm" onClick={() => setNaming(file)}>
                    Create profile
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {adding ? (
        <AddAccount
          onClose={() => setAdding(false)}
          onAdded={() => {
            void refresh();
          }}
        />
      ) : null}

      {editing ? (
        <ProfileEditor
          profile={editing}
          file={byName.get(editing.authFile)}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            toast('ok', message);
            void refresh();
          }}
        />
      ) : null}

      {naming ? (
        <NameProfile
          file={naming}
          onClose={() => setNaming(null)}
          onCreated={(name) => {
            setNaming(null);
            toast('ok', `Created ${name}`);
            void refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteProfile
          profile={deleting}
          hasAuthFile={byName.has(deleting.authFile)}
          onClose={() => setDeleting(null)}
          onDone={(message) => {
            setDeleting(null);
            toast('ok', message);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function NameProfile({
  file,
  onClose,
  onCreated,
}: {
  file: AuthFile;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState(file.email ?? file.name.replace(/\.json$/, ''));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createProfile({ name: name.trim(), authFile: file.name });
      onCreated(name.trim());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [file.name, name, onCreated]);

  return (
    <Drawer
      title="Name this profile"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button className="btn" onClick={onClose}>
            Cancel
          </Button>
          <Button className="btn primary" disabled={busy || name.trim() === ''} onClick={() => void create()}>
            Create
          </Button>
        </>
      }
    >
      <Field label="Profile name" hint={`Maps to ${file.name} on the proxy.`}>
        <FormInput
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() !== '') void create();
          }}
        />
      </Field>
      <ErrorLine error={error} />
    </Drawer>
  );
}

function DeleteProfile({
  profile,
  hasAuthFile,
  onClose,
  onDone,
}: {
  profile: Profile;
  hasAuthFile: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [confirmAuth, setConfirmAuth] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (alsoAuthFile: boolean) => {
      setBusy(true);
      setError(null);
      try {
        if (alsoAuthFile) await api.deleteAuthFile(profile.authFile);
        await api.deleteProfile(profile.id);
        onDone(alsoAuthFile ? `Deleted ${profile.name} and its account` : `Removed the ${profile.name} mapping`);
      } catch (err) {
        setError(err);
      } finally {
        setBusy(false);
      }
    },
    [onDone, profile.authFile, profile.id, profile.name],
  );

  return (
    <Drawer
      title={`Delete ${profile.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button className="btn" onClick={onClose}>
            Cancel
          </Button>
          <Button className="btn danger" disabled={busy} onClick={() => void run(false)}>
            Remove mapping
          </Button>
        </>
      }
    >
      <Notice tone="plain" title="This removes the name, not the account">
        <p className="muted">
          The credential <code>{profile.authFile}</code> stays on the proxy and keeps serving requests. It will
          reappear under Unassigned accounts.
        </p>
      </Notice>

      {hasAuthFile ? (
        <>
          <div className="section-head" style={{ margin: '8px 0 0' }}>
            <h2>Also delete the account</h2>
          </div>
          <Label className="row">
            <FormInput
              type="checkbox"
              style={{ width: 'auto' }}
              checked={confirmAuth}
              onChange={(e) => setConfirmAuth(e.target.checked)}
            />
            <span>
              I understand this deletes <code>{profile.authFile}</code> from the proxy permanently.
            </span>
          </Label>
          <div className="row">
            <Button className="btn danger" disabled={!confirmAuth || busy} onClick={() => void run(true)}>
              Delete profile and account
            </Button>
          </div>
        </>
      ) : null}

      <ErrorLine error={error} />
    </Drawer>
  );
}
