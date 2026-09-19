import {Button} from './ui/button';
import {FormInput} from './controls';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { Drawer, ErrorLine, Field, Notice } from './ui.tsx';

/**
 * Providers and their auth-url routes, mirroring
 * CLIProxyAPI management OAuth endpoints. xAI and Kimi are device flows
 * (auth_files_provider_oauth.go:512-718) and ignore is_webui.
 */
const PROVIDERS = [
  { id: 'anthropic', label: 'Claude', route: 'anthropic-auth-url', flow: 'redirect' },
  { id: 'codex', label: 'Codex', route: 'codex-auth-url', flow: 'redirect' },
  { id: 'antigravity', label: 'Antigravity', route: 'antigravity-auth-url', flow: 'redirect' },
  { id: 'kimi', label: 'Kimi', route: 'kimi-auth-url', flow: 'device' },
  { id: 'xai', label: 'xAI', route: 'xai-auth-url', flow: 'device' },
] as const;

type Provider = (typeof PROVIDERS)[number];
type Phase = 'pick' | 'waiting' | 'done';

export function AddAccount({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [authUrl, setAuthUrl] = useState('');
  const [state, setState] = useState('');
  const [callback, setCallback] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const start = useCallback(async (p: Provider) => {
    setError(null);
    setBusy(true);
    setProvider(p);
    try {
      const res = await api.authUrl(p.route);
      setAuthUrl(res.url);
      setState(res.state);
      setPhase('waiting');
      window.open(res.url, '_blank', 'noopener');
    } catch (err) {
      setError(err);
      setPhase('pick');
    } finally {
      setBusy(false);
    }
  }, []);

  // GET /get-auth-status always answers 200; the outcome is in the body
  // (auth_files_provider_oauth.go:758-832), so poll on the body, not the status code.
  useEffect(() => {
    if (phase !== 'waiting' || state === '') return;
    const tick = async () => {
      try {
        const res = await api.authStatus(state);
        if (res.status === 'ok') {
          stopPolling();
          setPhase('done');
          onAdded();
        } else if (res.status === 'error') {
          stopPolling();
          setError(new Error(res.error ?? 'authentication failed'));
          setPhase('pick');
        }
      } catch (err) {
        stopPolling();
        setError(err);
        setPhase('pick');
      }
    };
    pollRef.current = window.setInterval(() => void tick(), 2000);
    void tick();
    return stopPolling;
  }, [phase, state, onAdded, stopPolling]);

  const pasteCallback = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await api.postOAuthCallback({
        provider: provider?.id,
        state,
        redirect_url: callback.trim(),
      });
      // The proxy finishes the exchange asynchronously; keep polling get-auth-status.
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [callback, provider, state]);

  const cancel = useCallback(async () => {
    stopPolling();
    if (state) {
      try {
        await api.cancelAuthSession(state);
      } catch {
        /* the session may already be gone — closing is still correct */
      }
    }
    onClose();
  }, [onClose, state, stopPolling]);

  const managementOff = error instanceof ApiError && error.isManagementDisabled;

  return (
    <Drawer
      title="Add account"
      onClose={() => void cancel()}
      footer={
        <>
          <span className="muted">
            The proxy stores the credential in <code>~/.cli-proxy-api</code>; this console never reads it.
          </span>
          <span className="spacer" />
          <Button className="btn" onClick={() => void cancel()}>
            {phase === 'done' ? 'Close' : 'Cancel'}
          </Button>
        </>
      }
    >
      {managementOff ? (
        <Notice tone="warn" title="Management API unavailable">
          <p>Adding an account needs the Management API. Set the management key in Settings first.</p>
        </Notice>
      ) : null}

      {phase === 'pick' ? (
        <>
          <Field label="Provider" hint="Opens the provider's consent page in a new tab.">
            <div className="cards">
              {PROVIDERS.map((p) => (
                <Button
                  key={p.id}
                  className="btn"
                  disabled={busy}
                  onClick={() => void start(p)}
                  style={{ justifyContent: 'space-between' }}
                >
                  <span>{p.label}</span>
                  <span className="dim mono">{p.flow === 'device' ? 'device code' : 'oauth'}</span>
                </Button>
              ))}
            </div>
          </Field>
          <ErrorLine error={managementOff ? null : error} />
        </>
      ) : null}

      {phase === 'waiting' ? (
        <>
          <Notice tone="plain" title={`Waiting for ${provider?.label ?? 'provider'}`}>
            <p className="muted">
              Finish the sign-in in the tab that opened. This polls the proxy every 2 seconds.
            </p>
          </Notice>
          <Field label="Authorization URL" hint="Reopen it if the tab was blocked.">
            <FormInput className="mono" type="text" readOnly value={authUrl} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <Field
            label="Stuck? paste the callback URL"
            hint="Copy the address bar of the page you land on after approving, then submit it here."
          >
            <FormInput
              className="mono"
              type="text"
              placeholder="http://localhost:54545/callback?code=…&state=…"
              value={callback}
              onChange={(e) => setCallback(e.target.value)}
            />
          </Field>
          <div className="row">
            <Button className="btn" disabled={busy || callback.trim() === ''} onClick={() => void pasteCallback()}>
              Submit callback URL
            </Button>
          </div>
          <ErrorLine error={error} />
        </>
      ) : null}

      {phase === 'done' ? (
        <Notice tone="ok" title="Account added">
          <p>
            It now shows up under <strong>Unassigned accounts</strong>. Give it a profile name to use it.
          </p>
        </Notice>
      ) : null}
    </Drawer>
  );
}
