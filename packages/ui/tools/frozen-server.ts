/**
 * Serve one built UI tree while keeping its engine process behind loopback.
 *
 * A frozen browser bundle is still an EngineSession client. Serving it with a
 * file-only server turns `/engine-api/*` into HTML, which is both misleading
 * and unplayable. This server owns only the narrow same-origin bridge: static
 * files stay immutable, while exact engine paths are streamed to the already
 * isolated loopback gateway.
 */
import { createReadStream, statSync } from 'node:fs';
import {
  createServer,
  request as requestUpstream,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { helperAbsentBody, helperServing } from '../src/net/helper-absent';

const BACKEND_GATEWAY_PROTOCOL = 4;
const NETPLAY_PROTOCOL = 3;

const TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jsonl': 'application/x-ndjson; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  }),
);

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.jsonl', '.svg']);

export interface FrozenGatewayTarget {
  readonly host: string;
  readonly port: number;
}

export interface FrozenUiOptions {
  readonly root: string;
  readonly host: string;
  readonly port: number;
  readonly engineGateway?: FrozenGatewayTarget;
  readonly tableGateway?: FrozenGatewayTarget;
}

export interface RunningFrozenUi {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url, 'http://frozen.invalid').pathname;
  } catch {
    return null;
  }
}

function under(pathname: string | null, prefix: string): boolean {
  return pathname !== null && (pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function resolveFile(root: string, url: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function gatewayUnavailable(response: ServerResponse, protocol: number, service: string): void {
  json(response, 502, {
    protocol,
    ok: false,
    error: {
      code: 'gateway-unavailable',
      message: `the configured ${service} gateway is not reachable`,
    },
  });
}

function proxyGateway(
  request: IncomingMessage,
  response: ServerResponse,
  target: FrozenGatewayTarget | undefined,
  protocol: number,
  service: string,
): void {
  if (target === undefined) {
    gatewayUnavailable(response, protocol, service);
    return;
  }
  const upstream = requestUpstream(
    {
      host: target.host,
      port: target.port,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `${target.host}:${String(target.port)}` },
    },
    (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    },
  );
  upstream.once('error', () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    gatewayUnavailable(response, protocol, service);
  });
  request.once('aborted', () => upstream.destroy());
  request.pipe(upstream);
}

function handle(options: FrozenUiOptions, request: IncomingMessage, response: ServerResponse): void {
  const url = request.url ?? '/';
  const pathname = pathnameOf(url);
  if (under(pathname, '/engine-api')) {
    proxyGateway(request, response, options.engineGateway, BACKEND_GATEWAY_PROTOCOL, 'engine');
    return;
  }
  if (under(pathname, '/api')) {
    proxyGateway(request, response, options.tableGateway, NETPLAY_PROTOCOL, 'table');
    return;
  }
  const helper = pathname === null ? null : helperServing(pathname);
  if (helper !== null) {
    json(response, 404, helperAbsentBody(helper));
    return;
  }
  const root = resolve(options.root);
  const file = resolveFile(root, url) ?? resolveFile(root, '/index.html');
  if (file === null) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found\n');
    return;
  }
  sendFile(request, response, file);
}

function acceptsGzip(request: IncomingMessage): boolean {
  const header = request.headers['accept-encoding'];
  const offered = Array.isArray(header) ? header.join(',') : (header ?? '');
  return offered.split(',').some((entry) => {
    const [coding = '', ...parameters] = entry.split(';').map((part) => part.trim().toLowerCase());
    return coding === 'gzip' && !parameters.some((parameter) => /^q=0(?:\.0*)?$/u.test(parameter));
  });
}

function sendFile(request: IncomingMessage, response: ServerResponse, file: string): void {
  const extension = extname(file).toLowerCase();
  const compressible = COMPRESSIBLE.has(extension);
  const gzip = compressible && acceptsGzip(request);
  response.writeHead(200, {
    'content-type': TYPES.get(extension) ?? 'application/octet-stream',
    'cache-control': 'public, max-age=3600',
    ...(compressible ? { vary: 'accept-encoding' } : {}),
    ...(gzip ? { 'content-encoding': 'gzip' } : {}),
  });
  const sent = (cause: NodeJS.ErrnoException | null | undefined): void => {
    if (cause === null || cause === undefined || cause.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    console.error(`frozen-server: sending ${file} failed: ${cause.message}`);
  };
  if (gzip) pipeline(createReadStream(file), createGzip(), response, sent);
  else pipeline(createReadStream(file), response, sent);
}

export async function serveFrozenUi(options: FrozenUiOptions): Promise<RunningFrozenUi> {
  const server = createServer((request, response) => handle(options, request, response));
  await new Promise<void>((resolveListening, reject) => {
    const failed = (cause: Error): void => reject(cause);
    server.once('error', failed);
    server.listen(options.port, options.host, () => {
      server.off('error', failed);
      resolveListening();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('frozen UI server did not bind TCP');
  }
  return {
    host: options.host,
    port: address.port,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((cause) => (cause === undefined ? resolveClose() : reject(cause)));
  });
}

async function main(): Promise<void> {
  const root = process.argv[2];
  if (root === undefined) {
    throw new Error('usage: frozen-server <root> [port] [engine-gateway-port] [table-gateway-port]');
  }
  const port = Number(process.argv[3] ?? '5300');
  const gatewayPort = process.argv[4] === undefined ? undefined : Number(process.argv[4]);
  const tablePort = process.argv[5] === undefined ? undefined : Number(process.argv[5]);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('port must be valid');
  if (
    gatewayPort !== undefined &&
    (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65_535)
  ) {
    throw new Error('engine gateway port must be valid');
  }
  if (tablePort !== undefined && (!Number.isInteger(tablePort) || tablePort < 1 || tablePort > 65_535)) {
    throw new Error('table gateway port must be valid');
  }
  const running = await serveFrozenUi({
    root,
    host: '0.0.0.0',
    port,
    ...(gatewayPort === undefined ? {} : { engineGateway: { host: '127.0.0.1', port: gatewayPort } }),
    ...(tablePort === undefined ? {} : { tableGateway: { host: '127.0.0.1', port: tablePort } }),
  });
  process.stdout.write(
    `frozen lab: http://127.0.0.1:${String(running.port)}/  <-  ${resolve(root)}${
      gatewayPort === undefined ? '' : `; /engine-api -> 127.0.0.1:${String(gatewayPort)}`
    }${tablePort === undefined ? '' : `; /api -> 127.0.0.1:${String(tablePort)}`}\n`,
  );
}

const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) await main();
