/**
 * The deck workbench's server: `/deck-api`, `node:http`, bound to loopback.
 *
 * The same arrangement `@mtg/setgen`'s `design/server.ts` uses, and for the same
 * first reason: the page cannot hold this. A build resolves an LLM provider,
 * reads staged set files off disk and writes variations to a directory, none of
 * which a browser can do. So the page holds the form and this holds the work.
 *
 *   GET    /deck-api/sets              — the staged sets a pool can be cut from
 *   POST   /deck-api/criteria/validate — a draft, judged; issues keyed to fields
 *   POST   /deck-api/build             — start a build; answers with a job id
 *   GET    /deck-api/build/<id>        — how that build is going
 *   GET    /deck-api/variations        — the shelf
 *   GET    /deck-api/variations/<id>   — one variation, in full
 *   DELETE /deck-api/variations/<id>   — remove one
 *   GET    /deck-api/decks             — the deck library
 *   PUT    /deck-api/decks/<id>        — save one deck, or replace it
 *   DELETE /deck-api/decks/<id>        — remove one
 *
 * The last three are `mtg-j1rg`'s, and they are on this server rather than
 * behind a prefix of their own for one reason: a fifth prefix would need a fifth
 * launcher, a fifth port and a fifth client, and the thing it would own is a
 * directory of small JSON documents this process is already the right one to
 * hold. They need no provider, no card store and no ceiling, which is why
 * `@mtg/ui`'s `tools/play.ts` can start this server for the library alone and
 * leave the build route unarmed.
 *
 * The prefix is `/deck-api` rather than `/api`, which is already a table on
 * `@mtg/netplay`, or `/design-api`, which is the set designer. Vite proxies each
 * prefix to its own port, so a designer's page, a LAN game and a deck build can
 * all be open at once. No framework, for the reason both existing servers give:
 * `node:http` is already a router with a `switch` in front of it.
 *
 * # This one spends money, and that is the whole of its safety story
 *
 * The design server is forbidden from reaching a paid provider at all: its run
 * route resolves a fixture provider and has no branch that takes another,
 * because a design surface whose button spends money is one misclick from a
 * bill. A deck build cannot be fixture-only — the model choosing the cards *is*
 * the feature — so the rule is kept in the only other way it can be: the build
 * route **exists only when the launcher was given an explicit dollar ceiling**.
 * `builder` is undefined otherwise and `POST /deck-api/build` answers 404, the
 * way the design server's run route does without a runner.
 *
 * That is the same shape as `--backend fal` requiring `--budget`, and it is
 * there for the reason a bead already records: there must be no way to trigger
 * an expensive behavior by forgetting a flag. The page draws the disabled button
 * and names the command that arms it, so the absence is legible rather than
 * mysterious.
 *
 * **Loopback unless told otherwise.** `serveDeckWorkbench` takes a host and has
 * no default that reaches a network. Same origin also means no CORS headers, and
 * their absence is the policy rather than an oversight.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { DeckVariation } from './variation';
import type { WorkbenchCriteria } from './variation';
import { WorkbenchCriteriaSchema } from './variation';
import type { JobStatus } from './jobs';
import { BuildInFlightError, JobBoard, JobNotFoundError } from './jobs';
import type { VariationStore } from './store';
import { InvalidVariationIdError, VariationNotFoundError } from './store';
import type { DeckLibraryStore } from './library-store';
import { DeckIdMismatchError, DeckNotFoundError, InvalidDeckIdError } from './library-store';
import { LibraryDeckSchema } from './library';

/**
 * A staged set as the picker offers it. Deliberately not the set's cards: the
 * page already has every staged set through its own set index, and sending them
 * again would make opening the tab proportional to how many sets are staged.
 */
export interface WorkbenchSet {
  readonly code: string;
  readonly name: string;
  readonly cardCount: number;
}

/** What actually runs a build. Absent means the build route does not exist. */
export type WorkbenchBuilder = (request: BuildRequest) => Promise<DeckVariation>;

export interface BuildRequest {
  readonly criteria: unknown;
  readonly name: string;
  readonly parentId: string | null;
}

export interface ServeWorkbenchOptions {
  readonly port: number;
  /** Bind address. `127.0.0.1` is what a launcher passes; there is no default. */
  readonly host: string;
  readonly sets: readonly WorkbenchSet[];
  readonly store: VariationStore;
  /**
   * The deck library. Omitted means the `decks` routes answer 404, the way the
   * build route does without a builder.
   *
   * Optional rather than required because a server can be started for one job
   * and not the other, and because the absence has to be a state the page can
   * read rather than a crash: a lab talking to a server older than this field
   * asks for the library, is told there is not one, and says so.
   */
  readonly library?: DeckLibraryStore;
  /**
   * What answers `POST /deck-api/build`. Omitted means that route answers 404,
   * which is what a server started without a spend ceiling does.
   */
  readonly builder?: WorkbenchBuilder;
  /**
   * The pool a draft names, assembled: a refusal sentence, or `null`.
   *
   * `mtg-1urk`. Injected the way `builder` is, and for the same reason — the
   * cards live with whoever read them off disk, and this file is a router. It
   * runs inside `criteria/validate`, so a pool the build could not assemble is
   * said under the Sets row while somebody is still choosing sets rather than
   * arriving minutes later as a failed build. `@mtg/decklab`'s `pool-check.ts`
   * is what a launcher passes; a server without one checks the schema and the
   * staged codes and stops there.
   */
  readonly checkPool?: (criteria: WorkbenchCriteria) => string | null;
  /** Injected so a test gets stable ids and timestamps. */
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface RunningWorkbenchServer {
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

/**
 * A criteria document is small. The cap is here because this is a body arriving
 * from whatever loaded the page, and an uncapped read is a memory budget
 * somebody else sets.
 */
const MAX_BODY_BYTES = 256 * 1024;

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    // An answer is true about the state it was asked about and nothing else.
    'cache-control': 'no-store',
  });
  response.end(payload);
}

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

type Payload =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly refused: string };

async function payloadOf(request: IncomingMessage): Promise<Payload> {
  const body = await readBody(request);
  if (typeof body !== 'string') {
    return { ok: false, refused: `the request is larger than ${String(MAX_BODY_BYTES)} bytes` };
  }
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch (cause: unknown) {
    return { ok: false, refused: `the request is not JSON (${String(cause)})` };
  }
}

/** The path segments this server owns, or null when the prefix is not ours. */
function routeOf(url: URL): readonly string[] | null {
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  if (segments[0] !== 'deck-api') return null;
  return segments.slice(1);
}

/**
 * A criteria draft, judged, in the shape the form draws issues from.
 *
 * Issues carry the field path they belong to, because a refusal that cannot be
 * put next to the field that earned it becomes a paragraph the person has to
 * match up by hand.
 */
/** One refusal, addressed to the field that earned it. */
interface CriteriaIssue {
  readonly path: readonly (string | number)[];
  readonly pointer: string;
  readonly message: string;
}

type CriteriaVerdict =
  | { readonly ok: true; readonly criteria: WorkbenchCriteria }
  | { readonly ok: false; readonly issues: readonly CriteriaIssue[] };

function validateCriteria(value: unknown, options: ServeWorkbenchOptions): CriteriaVerdict {
  const sets = options.sets;
  const parsed = WorkbenchCriteriaSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
        pointer: `/${issue.path.join('/')}`,
        message: issue.message,
      })),
    };
  }

  // Checked after the schema and separately from it: a set code is well-formed
  // whether or not this lab has that set staged, so "not a set" and "not staged
  // here" are two different sentences and the second one is only true of this
  // machine.
  const staged = new Set(sets.map((set) => set.code));
  const missing = parsed.data.sets.filter((code) => !staged.has(code));
  if (missing.length > 0) {
    return {
      ok: false,
      issues: [
        {
          path: ['sets'],
          pointer: '/sets',
          message: `not staged in this lab: ${missing.join(', ')}. Staged: ${[...staged].join(', ')}`,
        },
      ],
    };
  }

  // Last, because it is the only check that needs the cards themselves and the
  // two above it decide whether asking is even meaningful. Keyed to `sets`: a
  // pool is refused for what the selection holds, and the repair is a set to
  // leave out. The message names the rest of what was applied.
  const refusal = options.checkPool?.(parsed.data) ?? null;
  if (refusal !== null) {
    return { ok: false, issues: [{ path: ['sets'], pointer: '/sets', message: refusal }] };
  }

  return { ok: true, criteria: parsed.data };
}

interface Context {
  readonly options: ServeWorkbenchOptions;
  readonly board: JobBoard;
}

async function handle(context: Context, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://deck.invalid');
  const route = routeOf(url);
  if (route === null) {
    json(response, 404, { refused: 'this server serves /deck-api only' });
    return;
  }

  const [head, second] = route;
  const options = context.options;

  if (head === 'sets' && route.length === 1) {
    if (request.method !== 'GET') {
      json(response, 405, { refused: 'the staged sets are read with GET' });
      return;
    }
    // `builds` rather than nothing: the page has to draw the unarmed state at
    // load, and it cannot infer it. Without this the button drew enabled until
    // somebody pressed it and read a 404, which is the one state this
    // arrangement exists to state up front rather than to fail into.
    json(response, 200, { sets: options.sets, builds: options.builder !== undefined });
    return;
  }

  if (head === 'criteria' && second === 'validate') {
    if (request.method !== 'POST') {
      json(response, 405, { refused: 'criteria/validate takes a draft, so it is a POST' });
      return;
    }
    const payload = await payloadOf(request);
    if (!payload.ok) {
      json(response, 400, { refused: payload.refused });
      return;
    }
    json(response, 200, validateCriteria(payload.value, options));
    return;
  }

  if (head === 'build') {
    await handleBuild(context, route, request, response);
    return;
  }

  if (head === 'variations') {
    handleVariations(options.store, route, request, response);
    return;
  }

  if (head === 'decks') {
    await handleDecks(options.library, route, request, response);
    return;
  }

  json(response, 404, { refused: `no route ${route.join('/')}` });
}

async function handleBuild(
  { options, board }: Context,
  route: readonly string[],
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const id = route[1];

  if (id !== undefined) {
    if (request.method !== 'GET') {
      json(response, 405, { refused: 'a build is read with GET' });
      return;
    }
    try {
      json(response, 200, board.status(id));
    } catch (cause: unknown) {
      if (cause instanceof JobNotFoundError) {
        json(response, 404, { refused: cause.message });
        return;
      }
      throw cause;
    }
    return;
  }

  if (request.method !== 'POST') {
    json(response, 405, { refused: 'a build is started with POST' });
    return;
  }

  const builder = options.builder;
  if (builder === undefined) {
    // The absence is the safety rule, so the answer states the rule rather than
    // just declining. See this file's header.
    json(response, 404, {
      refused:
        'this server was started without a spend ceiling, so it builds nothing. Every build spends ' +
        'model budget, and there is no way to start one by forgetting a flag. Restart with ' +
        '`npm run deckbench -- --max-usd <dollars>`',
    });
    return;
  }

  const payload = await payloadOf(request);
  if (!payload.ok) {
    json(response, 400, { refused: payload.refused });
    return;
  }

  const body = payload.value as Partial<BuildRequest>;
  const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : null;
  if (name === null) {
    json(response, 400, { refused: 'a build needs a name to shelve the variation under' });
    return;
  }
  const validation = validateCriteria(body.criteria, options);
  if (!validation.ok) {
    // A refusal rather than the validation document this used to answer with.
    // The form re-reads `criteria/validate` on every edit and draws each issue
    // under its own field; this route starts a build or says why it did not, and
    // a page handed a second shape here read the verdict as a malformed job.
    json(response, 400, { refused: refusalOf(validation.issues) });
    return;
  }

  const parentId = typeof body.parentId === 'string' ? body.parentId : null;
  const now = options.now ?? ((): Date => new Date());
  const jobId = (options.newId ?? randomUUID)();

  try {
    const started: JobStatus = board.start(
      jobId,
      name,
      now,
      () => builder({ criteria: body.criteria, name, parentId }),
      (variation) => {
        options.store.write(variation);
      },
    );
    json(response, 202, started);
  } catch (cause: unknown) {
    if (cause instanceof BuildInFlightError) {
      json(response, 409, { refused: cause.message, runningId: cause.runningId });
      return;
    }
    throw cause;
  }
}

/**
 * Every issue as one sentence, each named by the field it belongs to.
 *
 * The build route has one line to say it in and the form has ten places, so
 * this is the flattening rather than a second wording: the messages are the
 * validator's own.
 */
function refusalOf(issues: readonly CriteriaIssue[]): string {
  const said = issues.map((issue) => `${issue.path.join('.') || 'the criteria'}: ${issue.message}`);
  return `these criteria cannot be built. ${said.join('; ')}`;
}

function handleVariations(
  store: VariationStore,
  route: readonly string[],
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const id = route[1];

  if (id === undefined) {
    if (request.method !== 'GET') {
      json(response, 405, { refused: 'the shelf is read with GET' });
      return;
    }
    json(response, 200, store.list());
    return;
  }

  try {
    if (request.method === 'GET') {
      json(response, 200, store.read(id));
      return;
    }
    if (request.method === 'DELETE') {
      store.delete(id);
      json(response, 200, { deleted: id });
      return;
    }
    json(response, 405, { refused: 'a variation is read with GET or removed with DELETE' });
  } catch (cause: unknown) {
    if (cause instanceof VariationNotFoundError || cause instanceof InvalidVariationIdError) {
      json(response, 404, { refused: cause.message });
      return;
    }
    throw cause;
  }
}

/**
 * The deck library: read the shelf, save one deck, remove one.
 *
 * `PUT` rather than `POST` because the page mints the id — a deck saved twice
 * under the same id is the same deck edited, not a second one — so the request
 * names the document it is writing and repeating it changes nothing. That is
 * also what lets a save be retried after a dropped connection without leaving
 * two copies of a sixty-card deck on the shelf.
 *
 * A missing library is a 404 with a sentence rather than a crash, for the reason
 * `POST /deck-api/build` answers one without a builder: the page has to be able
 * to draw what it cannot do, and it can only draw it if it is told.
 */
async function handleDecks(
  library: DeckLibraryStore | undefined,
  route: readonly string[],
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (library === undefined) {
    json(response, 404, { refused: 'this server was started without a deck library' });
    return;
  }
  const id = route[1];

  if (id === undefined) {
    if (request.method !== 'GET') {
      json(response, 405, { refused: 'the deck library is read with GET, and one deck is written with PUT' });
      return;
    }
    json(response, 200, library.list());
    return;
  }

  try {
    if (request.method === 'PUT') {
      const payload = await payloadOf(request);
      if (!payload.ok) {
        json(response, 400, { refused: payload.refused });
        return;
      }
      const deck = LibraryDeckSchema.safeParse(payload.value);
      if (!deck.success) {
        // The whole issue list rather than the first, because a document this
        // far off is usually a page and a server that disagree about the shape,
        // and one field at a time makes that take as many round trips as there
        // are fields.
        json(response, 400, {
          refused: 'that is not a deck this library can keep',
          issues: deck.error.issues.map((issue) => ({
            pointer: `/${issue.path.join('/')}`,
            message: issue.message,
          })),
        });
        return;
      }
      library.write(id, deck.data);
      json(response, 200, { saved: id });
      return;
    }
    if (request.method === 'GET') {
      json(response, 200, library.read(id));
      return;
    }
    if (request.method === 'DELETE') {
      library.delete(id);
      json(response, 200, { deleted: id });
      return;
    }
    json(response, 405, { refused: 'a deck is read with GET, written with PUT or removed with DELETE' });
  } catch (cause: unknown) {
    if (cause instanceof DeckNotFoundError || cause instanceof InvalidDeckIdError) {
      json(response, 404, { refused: cause.message });
      return;
    }
    if (cause instanceof DeckIdMismatchError) {
      json(response, 400, { refused: cause.message });
      return;
    }
    throw cause;
  }
}

export function serveDeckWorkbench(options: ServeWorkbenchOptions): Promise<RunningWorkbenchServer> {
  const context: Context = { options, board: new JobBoard() };
  const server: Server = createServer((request, response) => {
    handle(context, request, response).catch((cause: unknown) => {
      // The handler's own failure, as opposed to a refusal it decided on. A
      // socket left open on a thrown error is a page that hangs with no reason
      // on screen.
      json(response, 500, { refused: `the deck server failed to answer (${String(cause)})` });
    });
  });

  return new Promise<RunningWorkbenchServer>((settle, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      server.off('error', reject);
      settle({
        port,
        host: options.host,
        close: () =>
          new Promise<void>((closed, failed) => {
            server.close((cause) => {
              if (cause === undefined) closed();
              else failed(cause);
            });
          }),
      });
    });
  });
}
