import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import type { RequestListener } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { serveFrozenUi, type RunningFrozenUi } from '../../tools/frozen-server';

const running: Array<{ close(): Promise<void> }> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mtg-frozen-server-'));
  roots.push(root);
  await writeFile(join(root, 'index.html'), '<!doctype html><title>frozen ui</title>');
  await writeFile(join(root, 'set.json'), JSON.stringify({ code: 'test' }));
  return root;
}

async function startGateway(handler: RequestListener): Promise<{ port: number; close(): Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('gateway did not bind TCP');
  const result = {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
  running.push(result);
  return result;
}

async function startFrozen(
  root: string,
  gateways: { readonly engine?: number; readonly table?: number } = {},
): Promise<RunningFrozenUi> {
  const server = await serveFrozenUi({
    root,
    host: '127.0.0.1',
    port: 0,
    ...(gateways.engine === undefined ? {} : { engineGateway: { host: '127.0.0.1', port: gateways.engine } }),
    ...(gateways.table === undefined ? {} : { tableGateway: { host: '127.0.0.1', port: gateways.table } }),
  });
  running.push(server);
  return server;
}

interface RawResponse {
  readonly status: number;
  readonly encoding: string | undefined;
  readonly vary: string | undefined;
  readonly body: Buffer;
}

function rawGet(url: string, acceptEncoding: string | undefined): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    get(
      url,
      { headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            encoding: response.headers['content-encoding'],
            vary: response.headers['vary'],
            body: Buffer.concat(chunks),
          }),
        );
      },
    ).once('error', reject);
  });
}

describe('the frozen UI server', () => {
  it('compresses text files for a browser that accepts gzip and sends them whole to one that does not', async () => {
    const root = await fixtureRoot();
    const catalog = JSON.stringify({
      cards: Array.from({ length: 4000 }, (_, n) => ({ name: `Card ${String(n)}`, typeLine: 'Creature' })),
    });
    await writeFile(join(root, 'catalog.json'), catalog);
    const pixels = Buffer.alloc(4096, 7);
    await writeFile(join(root, 'art.png'), pixels);
    const server = await startFrozen(root);
    const base = `http://127.0.0.1:${String(server.port)}`;

    const packed = await rawGet(`${base}/catalog.json`, 'gzip, deflate');
    expect(packed.status).toBe(200);
    expect(packed.encoding).toBe('gzip');
    expect(packed.vary).toBe('accept-encoding');
    expect(packed.body.byteLength).toBeLessThan(Buffer.byteLength(catalog) / 4);
    expect(gunzipSync(packed.body).toString('utf8')).toBe(catalog);

    const whole = await rawGet(`${base}/catalog.json`, undefined);
    expect(whole.encoding).toBeUndefined();
    expect(whole.vary).toBe('accept-encoding');
    expect(whole.body.toString('utf8')).toBe(catalog);

    const refused = await rawGet(`${base}/catalog.json`, 'gzip;q=0, deflate');
    expect(refused.encoding).toBeUndefined();
    expect(refused.body.toString('utf8')).toBe(catalog);

    const image = await rawGet(`${base}/art.png`, 'gzip, deflate');
    expect(image.encoding).toBeUndefined();
    expect(image.vary).toBeUndefined();
    expect(image.body.equals(pixels)).toBe(true);
  });

  it('serves files and reserves the SPA fallback for non-API navigation', async () => {
    const server = await startFrozen(await fixtureRoot());
    const base = `http://127.0.0.1:${String(server.port)}`;

    const set = await fetch(`${base}/set.json`);
    expect(set.status).toBe(200);
    expect(set.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(set.json()).resolves.toEqual({ code: 'test' });

    const route = await fetch(`${base}/draft/deck`);
    expect(route.status).toBe(200);
    await expect(route.text()).resolves.toContain('<title>frozen ui</title>');

    const absentApi = await fetch(`${base}/engine-api/sessions`, { method: 'POST', body: '{}' });
    expect(absentApi.status).toBe(502);
    expect(absentApi.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(absentApi.json()).resolves.toMatchObject({
      protocol: 4,
      ok: false,
      error: { code: 'gateway-unavailable' },
    });

    const absentTable = await fetch(`${base}/api/health`);
    expect(absentTable.status).toBe(502);
    expect(absentTable.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(absentTable.json()).resolves.toMatchObject({
      protocol: 3,
      ok: false,
      error: { code: 'gateway-unavailable' },
    });
  });

  it('forwards engine requests and preserves gateway status, type, path, method, and body', async () => {
    let received: { url?: string | undefined; method?: string | undefined; body?: string } = {};
    const gateway = await startGateway(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      received = {
        url: request.url,
        method: request.method,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      const body = JSON.stringify({
        protocol: 4,
        ok: false,
        error: { code: 'unknown-session', message: 'nope' },
      });
      response.writeHead(409, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': 'no-store',
      });
      response.end(body);
    });
    const server = await startFrozen(await fixtureRoot(), { engine: gateway.port });
    const payload = JSON.stringify({ protocol: 4, revision: 3, move: 'pass' });
    const response = await fetch(
      `http://127.0.0.1:${String(server.port)}/engine-api/sessions/capability?trace=1`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'unknown-session' } });
    expect(received).toEqual({
      url: '/engine-api/sessions/capability?trace=1',
      method: 'POST',
      body: payload,
    });
  });

  it('forwards table requests instead of serving the SPA fallback', async () => {
    let received: { url?: string | undefined; method?: string | undefined } = {};
    const gateway = await startGateway((request, response) => {
      received = { url: request.url, method: request.method };
      const body = JSON.stringify({ protocol: 3, ok: true, deals: true, rooms: true, drafts: true });
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
      });
      response.end(body);
    });
    const server = await startFrozen(await fixtureRoot(), { table: gateway.port });

    const response = await fetch(`http://127.0.0.1:${String(server.port)}/api/health?probe=1`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      protocol: 3,
      ok: true,
      deals: true,
      rooms: true,
      drafts: true,
    });
    expect(received).toEqual({ url: '/api/health?probe=1', method: 'GET' });
  });

  it('does not proxy hostile paths that only resemble the engine prefix', async () => {
    let gatewayRequests = 0;
    const gateway = await startGateway((_request, response) => {
      gatewayRequests += 1;
      response.writeHead(500).end();
    });
    const server = await startFrozen(await fixtureRoot(), { engine: gateway.port });

    const response = await fetch(`http://127.0.0.1:${String(server.port)}/engine-api-elsewhere`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('<title>frozen ui</title>');
    expect(gatewayRequests).toBe(0);
  });

  it('returns a structured JSON failure when the configured gateway is unreachable', async () => {
    const unavailable = await startGateway((_request, response) => response.end());
    const port = unavailable.port;
    await unavailable.close();
    running.splice(running.indexOf(unavailable), 1);
    const server = await startFrozen(await fixtureRoot(), { engine: port });

    const response = await fetch(`http://127.0.0.1:${String(server.port)}/engine-api/sessions`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(response.json()).resolves.toMatchObject({
      protocol: 4,
      ok: false,
      error: { code: 'gateway-unavailable' },
    });
  });

  it('answers a helper route it does not serve with a JSON 404 rather than the page', async () => {
    const server = await startFrozen(await fixtureRoot());
    const base = `http://127.0.0.1:${String(server.port)}`;
    const asked: readonly (readonly [string, string, string])[] = [
      ['POST', '/design-api/brief/validate', 'design'],
      ['GET', '/design-api/vocabulary', 'design'],
      ['GET', '/deck-api/sets?probe=1', 'deck'],
      ['GET', '/feedback-api/status', 'feedback'],
      ['POST', '/curation-api/preference', 'curation'],
    ];
    for (const [method, path, helper] of asked) {
      const response = await fetch(`${base}${path}`, {
        method,
        ...(method === 'POST' ? { body: '{}', headers: { 'content-type': 'application/json' } } : {}),
      });
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type'), path).toBe('application/json; charset=utf-8');
      await expect(response.json(), path).resolves.toEqual({
        ok: false,
        error: { code: 'helper-absent', message: `this lab runs without the ${helper} server` },
      });
    }
  });

  it('still serves the page for a path that only resembles a helper prefix', async () => {
    const server = await startFrozen(await fixtureRoot());
    const base = `http://127.0.0.1:${String(server.port)}`;
    for (const path of ['/design-api-elsewhere', '/deck', '/customize/sets']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, path).toBe(200);
      await expect(response.text(), path).resolves.toContain('<title>frozen ui</title>');
    }
  });
});
