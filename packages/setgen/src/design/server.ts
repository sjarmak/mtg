/**
 * The set designer's server: four routes, `node:http`, bound to loopback.
 *
 * `mtg-yddw.1`. It exists because the schema that decides what a legal brief is
 * cannot run in a browser — `@mtg/design-data`'s `load.ts` reads its canon off
 * disk at module scope — and a second copy of that schema in the page would be a
 * second answer to the question. So the page holds the draft and this holds the
 * judgment.
 *
 *   GET  /design-api/vocabulary      — every closed list the editor's pickers offer
 *   POST /design-api/brief/validate  — a draft, judged; issues keyed to fields
 *   POST /design-api/brief/plan      — the skeleton the allocator would build, free
 *   POST /design-api/run             — a fixture-replay generation, free (`run.ts`)
 *
 * The prefix is `/design-api` rather than `/api` because `/api` is already a
 * table on `@mtg/netplay`'s server, and Vite proxies the two prefixes to two
 * ports. A designer's page and a LAN game can be open at once; sharing a prefix
 * would mean whichever server the proxy pointed at answered 404 for the other.
 * `/curation-api` is the same arrangement, one service earlier.
 *
 * No framework, for the reason `@mtg/netplay`'s server states: `node:http` is
 * already a router with a `switch` in front of it, and adding a dependency is a
 * finding to report rather than an install to run (`AGENTS.md`).
 *
 * **Nothing here can reach a paid provider.** `run.ts` resolves a fixture
 * provider and a zero budget and has no branch that takes another, which is the
 * scope the playtester set for this lane: a live recorded run stays on the CLI, where
 * `--record` and `--max-usd` are typed by a person each time. A design surface
 * whose button spends money is one misclick from a bill, and the button that
 * would is not on the page because the route behind it is not on the server.
 *
 * **Loopback unless told otherwise**, the same arrangement and for the same
 * reason: `serveDesign` takes a host and has no default that reaches a network.
 * Vite proxies `/api` to it, so one listener is reachable from another machine
 * and it is the one designed to be. Same origin also means no CORS headers, and
 * their absence is the policy rather than an oversight.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { designVocabulary } from './vocabulary';
import { planSkeleton } from './plan';
import { validateBrief } from './validate';
import type { DesignRunner } from './run';

/**
 * A draft is a brief, and a brief with 96 authored cards on it is real. The cap
 * is generous for that reason and is still a cap: this is a body arriving from
 * whatever loaded the page, and an uncapped read is a memory budget somebody
 * else sets.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface ServeDesignOptions {
  readonly port: number;
  /** Bind address. `127.0.0.1` is what a launcher passes; there is no default. */
  readonly host: string;
  /**
   * What answers `POST /design-api/run`. Omitted means that route answers 404,
   * which is what a server started for editing alone does — the same shape
   * `@mtg/netplay` uses for a server with no dealer.
   */
  readonly runner?: DesignRunner;
}

export interface RunningDesignServer {
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    // A judgment is true about the draft that was sent and about nothing else.
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/** The body, or the reason there is none. Counted as it arrives, not after. */
async function readBody(request: IncomingMessage): Promise<string | { readonly tooLarge: true }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return { tooLarge: true };
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The body parsed, or a refusal naming what went wrong.
 *
 * A draft that is not JSON at all is a different failure from a draft that is
 * JSON and is not a brief, and they are told apart here so the editor can say
 * which. The second is `validateBrief`'s business and arrives as issues; this
 * one never does.
 */
type Payload =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly refused: string };

async function payloadOf(request: IncomingMessage): Promise<Payload> {
  const body = await readBody(request);
  if (typeof body !== 'string') {
    return { ok: false, refused: `the draft is larger than ${MAX_BODY_BYTES} bytes` };
  }
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (cause: unknown) {
    return { ok: false, refused: `the draft is not JSON (${String(cause)})` };
  }
}

/** The path a request names, or null when this server has no such route. */
function routeOf(url: URL): string | null {
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  if (segments[0] !== 'design-api') return null;
  return segments.slice(1).join('/');
}

async function handle(
  runner: DesignRunner | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://design.invalid');
  const route = routeOf(url);
  if (route === null) {
    json(response, 404, { refused: 'this server serves /design-api only' });
    return;
  }
  if (route === 'vocabulary') {
    if (request.method !== 'GET') {
      json(response, 405, { refused: 'the vocabulary is read with GET' });
      return;
    }
    json(response, 200, designVocabulary());
    return;
  }
  if (request.method !== 'POST') {
    json(response, 405, { refused: `${route} takes a draft, so it is a POST` });
    return;
  }
  const payload = await payloadOf(request);
  if (!payload.ok) {
    json(response, 400, { refused: payload.refused });
    return;
  }
  if (route === 'brief/validate') {
    json(response, 200, validateBrief(payload.value));
    return;
  }
  if (route === 'brief/plan') {
    const validation = validateBrief(payload.value);
    // A plan of an invalid brief is not a smaller plan, it is a category error:
    // `allocateSlots` takes a `SetBrief`. So the validation comes back instead,
    // in its own shape, and the page draws the same issue markers it already has
    // rather than a second vocabulary for the same refusals.
    if (!validation.ok) {
      json(response, 200, { ok: false, invalid: validation.issues });
      return;
    }
    json(response, 200, planSkeleton(validation.brief));
    return;
  }
  if (route === 'run') {
    if (runner === undefined) {
      json(response, 404, { refused: 'this server was started for editing only, so it runs nothing' });
      return;
    }
    const validation = validateBrief(payload.value);
    if (!validation.ok) {
      json(response, 200, { ok: false, invalid: validation.issues });
      return;
    }
    json(response, 200, await runner(validation.brief));
    return;
  }
  json(response, 404, { refused: `no route ${route}` });
}

export function serveDesign(options: ServeDesignOptions): Promise<RunningDesignServer> {
  const server: Server = createServer((request, response) => {
    handle(options.runner, request, response).catch((cause: unknown) => {
      // The handler's own failure, as opposed to a refusal it decided on. It is
      // reported rather than swallowed: a socket left open on a thrown error is
      // an editor that hangs with no reason on screen.
      json(response, 500, { refused: `the design server failed to answer (${String(cause)})` });
    });
  });
  return new Promise<RunningDesignServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      server.off('error', reject);
      resolve({
        port,
        host: options.host,
        close: (): Promise<void> =>
          new Promise<void>((done, failed) => {
            server.closeAllConnections();
            server.close((cause) => {
              if (cause === undefined) done();
              else failed(cause);
            });
          }),
      });
    });
  });
}
