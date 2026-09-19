import {Collapsible, CollapsibleTrigger, CollapsibleContent} from './ui/collapsible';
import {Button} from './ui/button';
import {Progress} from './ui/progress';
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { Profile, SubscriptionUsage as Usage } from '../types.ts';
import { ErrorLine } from './ui.tsx';

function resetLabel(value: string, now: number) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Reset date unavailable';
  const minutes = Math.ceil((time - now) / 60000);
  const relative = minutes <= 0 ? 'Reset time passed — refresh to check' : minutes < 60 ? `in ${minutes}m` : minutes < 1440 ? `in ${Math.floor(minutes / 60)}h ${minutes % 60}m` : `in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
  return `${new Date(time).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})} · ${relative}`;
}

export function SubscriptionUsage({profile, compact = false}: {profile: Profile; compact?: boolean}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    setUsage(null); setError(null);
    api.subscriptionUsage(profile.id).then(r => {if (live) setUsage(r.usage);}).catch(e => {if (live) setError(e);});
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {live = false; clearInterval(timer);};
  }, [profile.id]);
  const refresh = async () => {
    setBusy(true); setError(null);
    try {setUsage((await api.subscriptionUsage(profile.id, true)).usage); setNow(Date.now());}
    catch (e) {setError(e);} finally {setBusy(false);}
  };
  const stale = usage && now - Date.parse(usage.checkedAt) > 15 * 60_000;
  return <section className={`subscription-usage ${compact ? 'compact' : ''}`}>
    <div className="row wrap"><strong>{compact ? 'Allowance' : 'Usage & reset dates'}{usage?.plan ? ` · ${usage.plan}` : ''}</strong><span className="spacer" /><Button className="btn sm" disabled={busy} onClick={() => void refresh()}>{busy ? 'Checking…' : 'Refresh usage'}</Button></div>
    {!usage ? <p className="muted">Usage hasn’t been checked. Refresh to read this subscription’s limits.</p> : <>
      {usage.windows.length === 0 ? <p className="muted">Provider did not report usage windows or reset dates.</p> : usage.windows.map((w, i) => <div key={`${w.label}-${i}`} className="usage-window">
        <div className="row wrap"><span>{w.label}{w.active ? ' · current limiting window' : ''}</span><span className="spacer" /><strong>{w.remainingPercent === null ? 'Remaining usage unknown' : `${Math.round(w.remainingPercent)}% remaining`}</strong></div>
        {w.remainingPercent !== null && <Progress aria-label={`${w.label} remaining`} max={100} value={w.remainingPercent} />}
        <span className="muted">{w.resetsAt ? resetLabel(w.resetsAt, now) : 'Reset date not reported'}</span>
      </div>)}
      {!compact && usage.subscriptionStatus && <p className="muted">Subscription: {usage.subscriptionStatus}{usage.planTier ? ` · ${usage.planTier}` : ''}</p>}
      {!compact && usage.planCheckUnavailable && <p className="muted">Plan details unavailable; usage was checked successfully.</p>}
      {usage.extraUsageEnabled !== undefined && <p className="muted">Extra usage: {usage.extraUsageEnabled === null ? 'not reported' : usage.extraUsageEnabled ? 'enabled' : 'disabled'}</p>}
      {!compact && Boolean(usage.usageBreakdown?.length) && <Collapsible><CollapsibleTrigger asChild><Button variant="ghost">Weekly usage breakdown</Button></CollapsibleTrigger><CollapsibleContent>
        <p className="muted">Share of usage by app, not percent of quota remaining.{usage.breakdownCheckedAt ? ` As of ${new Date(usage.breakdownCheckedAt).toLocaleString()}.` : ''}</p>
        {usage.usageBreakdown?.map(row => <div className="row" key={row.label}><span>{row.label}</span><strong>{row.percent}%</strong></div>)}
      </CollapsibleContent></Collapsible>}
      <p className="muted">{stale ? 'Saved snapshot — refresh for current limits. ' : ''}Checked {new Date(usage.checkedAt).toLocaleString()}. Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
    </>}
    {profile.resetAt && <p><strong>Your recorded reset: </strong>{resetLabel(profile.resetAt, now)} <span className="muted">(manual)</span></p>}
    {profile.subscriptionNote && <p className="muted">{profile.subscriptionNote}</p>}
    <ErrorLine error={error} />
  </section>;
}
