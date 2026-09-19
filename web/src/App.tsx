import {Button} from '@/components/ui/button';
import { Desktop } from './views/Desktop.tsx';
import { RoutingSettings } from './views/RoutingSettings.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import type { Health, Settings } from './types.ts';
import { Profiles } from './views/Profiles.tsx';
import { Wire } from './views/Wire.tsx';
import { SettingsDrawer } from './components/SettingsDrawer.tsx';
import { Toasts, type Toast } from './components/ui.tsx';

type Screen = 'profiles' | 'wire' | 'routing' | 'desktop';

const SCREENS: Array<{ id: Screen; label: string }> = [
  { id: 'desktop', label: 'Claude setup' },
  { id: 'profiles', label: 'Subscriptions & usage' },
  { id: 'wire', label: 'Advanced connections' },
  { id: 'routing', label: 'Request settings' },
];

function screenFromHash(): Screen {
  const value = window.location.hash.slice(1).split('?')[0];
  return value === 'profiles' || value === 'wire' || value === 'routing' ? value : 'desktop';
}

export function App() {
  const [screen, setScreen] = useState<Screen>(screenFromHash);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToastId = useRef(1);

  useEffect(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: Screen) => {
    window.location.hash = next;
    setScreen(next);
  }, []);

  useEffect(() => {
    api.settings().then(setSettings, () => setSettings(null));
  }, []);

  useEffect(() => {
    document.title = settings?.displayName ?? 'CLIProxy Console';
  }, [settings?.displayName]);

  useEffect(() => {
    let live = true;
    const poll = () => {
      api.health().then(
        (h) => live && setHealth(h),
        () => live && setHealth(null),
      );
    };
    poll();
    const id = window.setInterval(poll, 10_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [settings?.proxyUrl]);

  const toast = useCallback((tone: 'ok' | 'err', title: string, detail?: string) => {
    const entry: Toast = { id: nextToastId.current++, tone, title };
    if (detail !== undefined) entry.detail = detail;
    setToasts((prev) => [...prev, entry]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dotClass = health === null ? 'wait' : health.ok ? 'ok' : 'err';
  const healthLabel =
    health === null ? 'checking proxy…' : health.ok ? 'proxy up' : (health.error ?? 'proxy unreachable');

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          {settings?.displayName ?? 'CLIProxy Console'}
        </div>
        <span className="topbar-spacer" />
        <span className="health" title={settings?.proxyUrl}>
          <span className={`dot ${dotClass}`} />
          {healthLabel}
          {health?.proxyVersion ? <span className="dim">· v{health.proxyVersion}</span> : null}
        </span>
        <Button className="btn sm" onClick={() => setShowSettings(true)}>
          Settings
        </Button>
      </header>

      <div className="body">
        <nav className="nav" aria-label="Console navigation">
          {SCREENS.map((s) => (
            <Button key={s.id} aria-current={screen === s.id} onClick={() => go(s.id)}>
              {s.label}
            </Button>
          ))}
          <div className="nav-foot">
            {settings?.hasManagementKey ? 'management key set' : 'no management key'}
            {settings ? (
              <>
                <br />
                <a href={`${settings.proxyUrl}/management.html`} target="_blank" rel="noreferrer">
                  built-in panel ↗
                </a>
              </>
            ) : null}
          </div>
        </nav>

        <main className="main">
          {screen === 'profiles' ? (
            <Profiles
              proxyUrl={settings?.proxyUrl ?? 'http://127.0.0.1:8317'}
              onOpenSettings={() => setShowSettings(true)}
              toast={toast}
            />
          ) : screen === 'desktop' ? (
            <Desktop onOpenSettings={() => setShowSettings(true)} />
          ) : screen === 'routing' ? (
            <RoutingSettings toast={toast} />
          ) : (
            <Wire onOpenSettings={() => setShowSettings(true)} toast={toast} />
          )}
        </main>
      </div>

      {showSettings && settings ? (
        <SettingsDrawer
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(next) => {
            setSettings(next);
            setShowSettings(false);
            window.dispatchEvent(new Event('console-settings-saved'));
            toast('ok', 'Settings saved');
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
