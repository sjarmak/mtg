/**
 * The only place this package talks to the network.
 *
 * Enforces the etiquette Scryfall documents as mandatory: a pinned descriptive
 * User-Agent, an explicit Accept header, per-host rate limiting, and a 429 that
 * backs off for the documented cooldown instead of retrying immediately.
 */
import { z } from 'zod';
import { ACCEPT_HEADER, DEFAULT_MAX_RETRIES, RATE_LIMIT_COOLDOWN_MS, USER_AGENT } from '../config';
import { HttpError, RemoteShapeError } from '../errors';
import { createLimiter, type Limiter } from './rate-limiter';

export interface HttpClientOptions {
  readonly userAgent?: string;
  readonly maxRetries?: number;
  readonly limiter?: Limiter;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface HttpClient {
  /** Fetches and validates a JSON document against `schema`. */
  getJson<T>(url: string, schema: z.ZodType<T>): Promise<T>;
  /** Fetches a URL as a byte stream; the caller owns consuming/closing it. */
  getStream(url: string): Promise<{ body: ReadableStream<Uint8Array>; contentLength: number | null }>;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    throw new HttpError(url, 0, 'not a valid absolute URL');
  }
}

function retryDelayMs(status: number, retryAfter: string | null, attempt: number): number {
  if (retryAfter !== null) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  }
  if (status === 429) return RATE_LIMIT_COOLDOWN_MS;
  return Math.min(8_000, 500 * 2 ** attempt);
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const userAgent = options.userAgent ?? USER_AGENT;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const limiter = options.limiter ?? createLimiter();
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const headers: Record<string, string> = { 'User-Agent': userAgent, Accept: ACCEPT_HEADER };

  async function request(url: string): Promise<Response> {
    const host = hostOf(url);
    let lastDetail = 'no attempt made';

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await limiter.acquire(host);
      let response: Response;
      try {
        response = await doFetch(url, { headers, redirect: 'follow' });
      } catch (cause) {
        lastDetail = cause instanceof Error ? cause.message : String(cause);
        if (attempt === maxRetries) throw new HttpError(url, 0, lastDetail);
        await sleep(retryDelayMs(0, null, attempt));
        continue;
      }

      if (response.ok) return response;

      const status = response.status;
      lastDetail = response.statusText || 'request failed';
      // Drain the error body so the socket is released before we back off.
      await response.text().catch(() => '');

      if (!RETRYABLE_STATUS.has(status) || attempt === maxRetries) {
        throw new HttpError(url, status, lastDetail);
      }
      const waitMs = retryDelayMs(status, response.headers.get('retry-after'), attempt);
      if (status === 429) limiter.penalize(host, waitMs);
      await sleep(waitMs);
    }

    throw new HttpError(url, 0, lastDetail);
  }

  return {
    async getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
      const response = await request(url);
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (cause) {
        throw new RemoteShapeError(url, cause instanceof Error ? cause.message : 'unparseable JSON');
      }
      const result = schema.safeParse(parsed);
      if (!result.success) throw new RemoteShapeError(url, z.prettifyError(result.error));
      return result.data;
    },

    async getStream(url: string) {
      const response = await request(url);
      if (response.body === null) throw new HttpError(url, response.status, 'response had no body');
      const header = response.headers.get('content-length');
      const contentLength = header === null ? null : Number.parseInt(header, 10);
      return {
        body: response.body,
        contentLength: contentLength !== null && Number.isFinite(contentLength) ? contentLength : null,
      };
    },
  };
}
