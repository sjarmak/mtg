/**
 * `/feedback-api`: the loopback server that files a UI/UX report.
 *
 * `mtg-fvuyq.4`. Two routes. `GET /feedback-api/status` says what this lab
 * files — whether `gh` can file here, whether a model round is armed, what was
 * staged — so the panel can say so before anybody types. `POST
 * /feedback-api/reports` takes the wire body (`../../src/feedback/wire.ts`),
 * writes the directory (`report.ts`), then files the GitHub issue (`issue.ts`), and
 * answers with both: the directory always, the issue URL when there is one and
 * the reason when there is not. Loopback only, no CORS, no framework, like
 * every other server under this directory; the page reaches it through Vite's
 * proxy on its own origin.
 *
 * Written first, filed second, and the answer is 200 either way once the
 * directory is on disk: an issue is a pointer to the directory and the
 * directory is the report.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { DataPathError } from '../data-path';
import { ghFiler, issueRepo, retryCommand } from './issue';
import type { IssueFiler } from './issue';
import type { BeadDrafter } from './draft';
import { issueArgs, readReport, writeFeedbackReport } from './report';
import type { ReportExtras } from './report';

export const FEEDBACK_API_PREFIX = '/feedback-api';

/** A pasted retina screenshot base64'd, with room: the schema caps the image itself. */
export const MAX_REPORT_BODY_BYTES = 16 * 1024 * 1024;

export interface FeedbackServerOptions {
  readonly port: number;
  readonly host?: string;
  /** Where reports are written; resolved through `resolveDataDir` by the caller. */
  readonly root: string;
  readonly repoRoot: string;
  readonly staged: string;
  /** Injectable for tests; the launcher uses `ghFiler`. */
  readonly filer?: IssueFiler;
  /** `owner/repo` issues go to, or null when `gh` cannot file; asked once at start when not stated. */
  readonly repo?: string | null;
  /** The model round (`--feedback-model`, `draft.ts`); absent means none is armed and `/draft` is a 404. */
  readonly drafter?: BeadDrafter;
  readonly commit?: string;
  readonly now?: () => Date;
}

export interface FeedbackServer {
  readonly port: number;
  readonly message: string;
  close(): Promise<void>;
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

async function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<string | { readonly tooLarge: true }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) return { tooLarge: true };
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The checkout the lab runs from, or `unknown` where git cannot say. */
export function launcherCommit(repoRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

interface Runtime {
  readonly root: string;
  readonly repoRoot: string;
  readonly extras: ReportExtras;
  readonly filer: IssueFiler;
  readonly repo: string | null;
  readonly drafter: BeadDrafter | null;
  readonly now: () => Date;
}

async function readJsonBody(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  const body = await readBody(request, MAX_REPORT_BODY_BYTES);
  if (typeof body !== 'string') {
    json(response, 413, {
      message: `the report is over ${String(MAX_REPORT_BODY_BYTES)} bytes; paste a smaller screenshot`,
    });
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    json(response, 400, { message: 'the report is not JSON' });
    return { ok: false };
  }
}

async function handleDraft(
  drafter: BeadDrafter,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request, response);
  if (!body.ok) return;
  const read = readReport(body.value);
  if (!read.ok) {
    json(response, 400, { message: `not a report: ${read.reason}` });
    return;
  }
  try {
    json(response, 200, { draft: await drafter(read.report) });
  } catch (cause: unknown) {
    json(response, 502, {
      message: `the model round failed: ${cause instanceof Error ? cause.message : String(cause)}. File without it.`,
    });
  }
}

async function handleReport(
  runtime: Runtime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request, response);
  if (!body.ok) return;
  const read = readReport(body.value);
  if (!read.ok) {
    json(response, 400, { message: `not a report: ${read.reason}` });
    return;
  }
  let written;
  try {
    written = writeFeedbackReport({
      root: runtime.root,
      repoRoot: runtime.repoRoot,
      report: read.report,
      extras: runtime.extras,
      at: runtime.now(),
    });
  } catch (cause: unknown) {
    json(response, 500, {
      message: `could not write the report: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
    return;
  }
  if (runtime.repo === null) {
    json(response, 200, {
      issue: null,
      directory: written.relative,
      note: `gh cannot file from this checkout (not signed in, or origin is not on GitHub), so no issue was filed. From a machine where it can: ${retryCommand(issueArgs(read.report, written, '<owner/repo>'))}`,
    });
    return;
  }
  const args = issueArgs(read.report, written, runtime.repo);
  const filed = await runtime.filer(args);
  if (!filed.ok) {
    json(response, 200, {
      issue: null,
      directory: written.relative,
      note: `gh issue create failed (${filed.reason}). The report is on disk; file it with: ${retryCommand(args)}`,
    });
    return;
  }
  json(response, 200, {
    issue: filed.id,
    directory: written.relative,
    note: 'It carries the ui and space:mtg-play-surface labels and no admission label, so it arrives untriaged.',
  });
}

function handle(runtime: Runtime, request: IncomingMessage, response: ServerResponse): void {
  const url = request.url ?? '/';
  if (url === `${FEEDBACK_API_PREFIX}/status` && request.method === 'GET') {
    json(response, 200, {
      staged: runtime.extras.staged,
      issues: runtime.repo !== null,
      model: runtime.drafter !== null,
    });
    return;
  }
  if (url === `${FEEDBACK_API_PREFIX}/reports` && request.method === 'POST') {
    void handleReport(runtime, request, response).catch((cause: unknown) => {
      json(response, 500, { message: cause instanceof Error ? cause.message : String(cause) });
    });
    return;
  }
  if (url === `${FEEDBACK_API_PREFIX}/draft` && request.method === 'POST' && runtime.drafter !== null) {
    const drafter = runtime.drafter;
    void handleDraft(drafter, request, response).catch((cause: unknown) => {
      json(response, 500, { message: cause instanceof Error ? cause.message : String(cause) });
    });
    return;
  }
  json(response, 404, { message: `nothing at ${request.method ?? 'GET'} ${url}` });
}

export async function startFeedbackServer(options: FeedbackServerOptions): Promise<FeedbackServer> {
  try {
    mkdirSync(options.root, { recursive: true });
  } catch (cause: unknown) {
    throw new DataPathError(
      `could not create ${options.root}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const runtime: Runtime = {
    root: options.root,
    repoRoot: options.repoRoot,
    extras: { staged: options.staged, commit: options.commit ?? launcherCommit(options.repoRoot) },
    filer: options.filer ?? ghFiler(options.repoRoot),
    repo: options.repo === undefined ? await issueRepo(options.repoRoot) : options.repo,
    drafter: options.drafter ?? null,
    now: options.now ?? ((): Date => new Date()),
  };
  const server: Server = createServer((request, response) => {
    handle(runtime, request, response);
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;
  return {
    port,
    message:
      runtime.repo !== null
        ? `Filing UI/UX reports as GitHub issues in ${runtime.repo}; reports are written under ${options.root}.`
        : `Writing UI/UX reports under ${options.root}; gh cannot file from here, so none is filed as an issue.`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}
