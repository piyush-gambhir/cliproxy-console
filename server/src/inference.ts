import type {IncomingMessage, ServerResponse} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {MgmtClient} from './mgmt.ts';
import type {ProfileStore} from './profiles.ts';
import {resolveSelection, readRouting, accountModels} from './routing.ts';
import {sendJson} from './http.ts';
import {WireError} from './wire.ts';
import {consoleOrigin} from './runtime.ts';

import {DEFAULT_CLAUDE_MODELS, type ClaudeModelOption} from './model-config.ts';
export function subscriptionUrl(profile: string, origin = consoleOrigin()) {
  return `${origin}/inference/${encodeURIComponent(profile)}`;
}
export async function relayInference(req: IncomingMessage, res: ServerResponse, profile: string, endpoint: string, proxyUrl: string, mgmt: MgmtClient, profiles: ProfileStore, models: ClaudeModelOption[] = DEFAULT_CLAUDE_MODELS) {
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
    const registered = new Set(await accountModels(mgmt, selected.authFile));
    const data = [];
    for (const model of models.filter(model => registered.has(`${selected.lastKnownPrefix}/${model.id}`))) {
      await resolveSelection(mgmt,profiles,{profile,model:model.id});
      data.push({id:model.id,type:'model',object:'model',display_name:`${model.label} · 1M`,supports_1m:true,max_input_tokens:1_000_000});
    }
    if (!data.length) throw new WireError('No configured 1M models are registered for this subscription',409);
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
  if (!body || !models.some(model => model.id === body.model)) throw new WireError('Choose a configured 1M Claude model using its official model ID');
  const routing = await readRouting(mgmt);
  if (!routing.forceModelPrefix || routing.switchProject || routing.switchPreviewModel || routing.requestRetry !== 0) throw new WireError('Strict account routing must be enabled and automatic fallback/retries disabled', 409);
  const selected = await profiles.get(profile);
  if (!selected.authFile.startsWith('claude-')) throw new WireError('Choose a Claude subscription');
  const selection = await resolveSelection(mgmt, profiles, {profile, model: body.model});
  const headers = new Headers({'content-type':'application/json'});
  for (const name of Object.keys(req.headers).filter(name => ['authorization','x-api-key','user-agent','x-app'].includes(name) || name.startsWith('anthropic-') || name.startsWith('x-claude-') || name.startsWith('x-stainless-'))) {
    const value = req.headers[name]; if (typeof value === 'string') headers.set(name, value);
  }
  // Claude strips [1m] from wire IDs; request the configured 1M capability explicitly.
  const betas = new Set((headers.get('anthropic-beta') || '').split(',').map(v => v.trim()).filter(Boolean));
  betas.add('context-1m-2025-08-07');
  headers.set('anthropic-beta', [...betas].join(','));
  const controller = new AbortController();
  const cancel = () => controller.abort(); res.once('close', cancel);
  try {
    const upstream = await fetch(`${proxyUrl.replace(/\/$/,'')}${endpoint}`, {method:'POST',headers,body:JSON.stringify({...body,model:selection.model}),signal:controller.signal,redirect:'error'});
    res.statusCode = upstream.status;
    for (const [key,value] of upstream.headers) {
      if (['content-type','request-id','retry-after','x-should-retry','x-cliproxy-receipt','x-cliproxy-subscription'].includes(key) || key.startsWith('anthropic-ratelimit-')) res.setHeader(key,value);
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

/** Compatibility route for existing clients. New client configurations go directly to the proxy. */
export async function relayNative(req: IncomingMessage,res:ServerResponse,profile:string,endpoint:string,proxyUrl:string) {
 const headers=new Headers();
 const blocked=new Set(['host','connection','content-length','transfer-encoding','keep-alive','upgrade','proxy-authorization','proxy-authenticate','te','trailer','cookie']);
 for(const item of String(req.headers.connection || '').split(',')) blocked.add(item.trim().toLowerCase());
 for(const [name,value] of Object.entries(req.headers)) if(!blocked.has(name)&&typeof value==='string') headers.set(name,value);
 const controller=new AbortController();const cancel=()=>controller.abort();res.once('close',cancel);
 try {
  const init:RequestInit & {duplex?:string}={method:req.method,headers,signal:controller.signal,redirect:'error'};
  if(req.method!=='GET'&&req.method!=='HEAD'){init.body=Readable.toWeb(req) as never;init.duplex='half';}
  const upstream=await fetch(`${proxyUrl.replace(/\/$/,'')}/inference/${encodeURIComponent(profile)}${endpoint}`,init);
  res.statusCode=upstream.status;
  const responseBlocked=new Set(['connection','content-length','transfer-encoding','keep-alive','upgrade','proxy-authorization','proxy-authenticate','te','trailer','content-encoding','set-cookie']);
  for(const item of (upstream.headers.get('connection') || '').split(','))responseBlocked.add(item.trim().toLowerCase());
  for(const [name,value] of upstream.headers)if(!responseBlocked.has(name))res.setHeader(name,value);
  if(upstream.body)await pipeline(Readable.fromWeb(upstream.body as never),res);else res.end();
 }catch(err){if(!controller.signal.aborted){if(res.headersSent)res.destroy();else throw new WireError('Native gateway connection failed',502);}}
 finally{res.off('close',cancel);}
}
