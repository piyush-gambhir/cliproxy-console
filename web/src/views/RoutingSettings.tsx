import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { Routing } from '../types.ts';
import { Chip, ErrorLine, Notice } from '../components/ui.tsx';

export function RoutingSettings({toast}: {toast: (tone: 'ok' | 'err', title: string, detail?: string) => void}) {
  const [routing, setRouting] = useState<Routing | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.routing().then(setRouting).catch(setError); }, []);
  const strict = routing && routing.forceModelPrefix && !routing.switchProject && !routing.switchPreviewModel && routing.requestRetry === 0;
  const restore = async () => {
    setBusy(true); setError(null);
    try {
      setRouting(await api.saveRouting({strategy:'fill-first',forceModelPrefix:true,requestRetry:0,maxRetryInterval:0,switchProject:false,switchPreviewModel:false}));
      toast('ok', 'Manual account routing restored');
    } catch(e) {setError(e);} finally {setBusy(false);}
  };
  return <div className="page"><div className="page-head"><div><h1>Request settings</h1><p>Routing rules for the account you explicitly select.</p></div></div>
    <Notice tone="plain" title="One subscription per request"><p>The Claude gateway requires strict account routing. Automatic account fallback and additional proxy retries would conflict with it.</p></Notice>
    <ErrorLine error={error} />
    {routing && <Card className="summary-card">
      <Chip tone={strict ? 'ok' : 'err'}>{strict ? 'Strict manual routing is ready' : 'Routing needs attention'}</Chip>
      <dl className="routing-facts"><div><dt>Account-specific routes required</dt><dd>{routing.forceModelPrefix ? 'Yes' : 'No'}</dd></div><div><dt>Automatic account fallback</dt><dd>{routing.switchProject ? 'On' : 'Off'}</dd></div><div><dt>Automatic preview-model fallback</dt><dd>{routing.switchPreviewModel ? 'On' : 'Off'}</dd></div><div><dt>Additional proxy retry rounds</dt><dd>{routing.requestRetry}</dd></div></dl>
      <p>Choose your account in Claude setup. If it cannot serve the request, the gateway returns an error instead of consuming another subscription.</p>
      <Button disabled={busy || Boolean(strict)} onClick={() => void restore()}>{busy ? 'Saving…' : strict ? 'Manual routing configured' : 'Restore strict manual routing'}</Button>
    </Card>}
  </div>;
}
