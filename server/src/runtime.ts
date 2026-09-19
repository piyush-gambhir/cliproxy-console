import {readStartup} from './startup.ts';
const activePort = readStartup().port;
/** Shared by the API and development server. Never trust a request Host for client URLs. */
export function consolePort(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env['PORT'] || (env === process.env ? activePort : 8320));
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('PORT must be between 1 and 65535');
  return value;
}

export function consoleOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const value = env['CLIPROXY_CONSOLE_URL']?.trim() || `http://127.0.0.1:${consolePort(env)}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CLIPROXY_CONSOLE_URL must be a loopback HTTP(S) origin without credentials or a path');
  }
  return url.origin;
}
