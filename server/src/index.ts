import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { SettingsStore } from './settings.ts';
import { ProfileStore } from './profiles.ts';
import { MgmtClient } from './mgmt.ts';

const PORT = Number(process.env['PORT'] ?? 8320);
const HOST = '127.0.0.1'; // localhost only, by design — the console has no auth of its own

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../../web/dist');
const webDist = fs.existsSync(path.join(distDir, 'index.html')) ? distDir : null;

const settings = new SettingsStore();
const app = createApp({
  settings,
  profiles: new ProfileStore(),
  mgmt: new MgmtClient(settings),
  webDist,
});

const server = http.createServer((req, res) => {
  void app(req, res);
});

server.listen(PORT, HOST, () => {
  const view = `http://${HOST}:${PORT}`;
  console.log(`cliproxy-console server listening on ${view}`);
  console.log(webDist ? `serving web/dist from ${webDist}` : 'web/dist not built — API only');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
