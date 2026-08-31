import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.ts';
import { app as tempshell } from './app/routes.tsx';

/**
 * One process, one app. A reverse proxy (Caddy in the example compose) terminates
 * TLS and proxies here; server-sent events must be passed through unbuffered.
 */
const server = new Hono();

server.get('/healthz', (c) => c.text('ok'));

// Brand assets, read once at boot and cached hard.
const assets = new Map<string, Uint8Array>();
for (const name of ['logo.png', 'favicon.png', 'favicon-32.png']) {
  try {
    assets.set(name, new Uint8Array(readFileSync(`./assets/${name}`)));
  } catch (error) {
    console.error(`[assets] missing ${name}`, error);
  }
}
function asset(name: string): Response {
  const bytes = assets.get(name);
  if (!bytes) return new Response('not found', { status: 404 });
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=604800',
      'x-content-type-options': 'nosniff',
    },
  });
}
server.get('/logo.png', () => asset('logo.png'));
server.get('/favicon.png', () => asset('favicon.png'));
server.get('/favicon-32.png', () => asset('favicon-32.png'));
server.get('/favicon.ico', () => asset('favicon-32.png'));
server.get('/apple-touch-icon.png', () => asset('logo.png'));
server.get('/apple-touch-icon-precomposed.png', () => asset('logo.png'));

// Everything else is the app.
server.route('/', tempshell);

server.onError((error, c) => {
  console.error('[error]', c.req.method, c.req.url, error);
  return c.text('Something broke. Check the logs.', 500);
});

const running = serve({ fetch: server.fetch, port: config.port }, (info) => {
  console.log(`tempshell listening on :${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    running.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  });
}
