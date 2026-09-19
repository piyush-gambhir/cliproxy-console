import type {IncomingMessage, ServerResponse} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {MgmtClient} from './mgmt.ts';
import type {ProfileStore} from './profiles.ts';
import {resolveSelection, readRouting} from './routing.ts';
import {sendJson} from './http.ts';
import {WireError} from './wire.ts';
import {consoleOrigin} from './runtime.ts';

export const CLAUDE_MODELS = ['claude-opus-5', 'claude-fable-5-1'] as const;
export function subscriptionUrl(profile: string, origin = consoleOrigin()) {
  return `${origin}/inference/${encodeURIComponent(profile)}`;
}
export async function relayInference(req: IncomingMessage, res: ServerResponse, profile: string, endpoint: string, proxyUrl: string, mgmt: MgmtClient, profiles: ProfileStore) {
  const listModels = req.method === 'GET' && endpoint === '/v1/models';
  if (!listModels && (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(endpoint))) throw new WireError('Unsupported inference endpoint', 404);
  if (!req.headers.authorization && !req.headers['x-api-key']) throw new WireError('A proxy client key is required', 401);
  if (listModels) {
    const headers = new Headers();
    for (const name of ['authorization','x-api-key','anthropic-version']) {
      const value = req.headers[name]; if (typeof value === 'string') headers.set(name,value);
    }
    const upstream = await fetch(`${proxyUrl.replace(/\/$/,'')}/v1/models`,{headers,redirect:'error',signal:AbortSignal.timeout(20_000)});
    if (!upstream.ok) {res.writeHead(upstream.status,{'content-type':'application/json'});res.end(await upstream.text());return;}
    const selected = await profiles.get(profile);
    if (!selected.authFile.startsWith('claude-')) throw new WireError('Choose a Claude subscription');
    const data = [];
    for (const model of CLAUDE_MODELS) {
      await resolveSelection(mgmt,profiles,{profile,model});
      data.push({id:model,type:'model',object:'model',display_name:model,supports_1m:true,max_input_tokens:1_000_000});
    }
    return sendJson(res,200,{object:'list',data,has_more:false,first_id:data[0]?.id,last_id:data.at(-1)?.id});
  }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new WireError('Request exceeds 64 MB', 413);
    chunks.push(Buffer.from(chunk));
  }
  let body: Record<string, unknown>;
  try {body = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new WireError('Invalid JSON');}
  if (body && typeof body.model === 'string') body.model = body.model.replace(/\[1m\]$/i, '');
  if (!body || !CLAUDE_MODELS.includes(body.model as typeof CLAUDE_MODELS[number])) throw new WireError('Choose claude-opus-5 or claude-fable-5-1 using its official model ID');
  const routing = await readRouting(mgmt);
  if (!routing.forceModelPrefix || routing.switchProject || routing.switchPreviewModel || routing.requestRetry !== 0) throw new WireError('Strict account routing must be enabled and automatic fallback/retries disabled', 409);
  const selected = await profiles.get(profile);
  if (!selected.authFile.startsWith('claude-')) throw new WireError('Choose a Claude subscription');
  const selection = await resolveSelection(mgmt, profiles, {profile, model: body.model});
  const headers = new Headers({'content-type':'application/json'});
  for (const name of ['authorization','x-api-key','anthropic-version','anthropic-beta','user-agent','x-app']) {
    const value = req.headers[name]; if (typeof value === 'string') headers.set(name, value);
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(); res.once('close', cancel);
  try {
    const upstream = await fetch(`${proxyUrl.replace(/\/$/,'')}${endpoint}`, {method:'POST',headers,body:JSON.stringify({...body,model:selection.model}),signal:controller.signal,redirect:'error'});
    res.statusCode = upstream.status;
    for (const [key,value] of upstream.headers) {
      if (['content-type','request-id','retry-after'].includes(key) || key.startsWith('anthropic-ratelimit-')) res.setHeader(key,value);
    }
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-CLIProxy-Subscription',profile);
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body as never),res);
    else res.end();
  } catch (err) {
    if (!controller.signal.aborted) {
      if (res.headersSent) res.destroy();
      else throw new WireError('Inference upstream connection failed',502);
    }
  } finally {res.off('close',cancel);}
}
