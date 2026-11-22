/**
 * The direct Jev client: the request it writes to TypeSafe's own API, and what
 * it does with each way that API can answer. Every test drives a fake `fetch`;
 * none reaches a network.
 *
 * The wire shape asserted here is the one `docs/research/stagehand-jev-seam.md`
 * records from the vendor's API reference (2026-09-22): the model in the body,
 * a bearer key, snake-case usage in the answer. The key is a distinctive string
 * so a leak is a plain substring check.
 */
import { describe, expect, it } from 'vitest';
import {
  JEV_DIRECT_BASE_URL,
  JEV_DIRECT_MODEL,
  JevHttpError,
  JevRateLimitError,
  createJevDirectClient,
} from '../tools/jev-label/jev-client';
import type { EvaluateRequest, JevClient } from '../tools/jev-label/jev-client';

const KEY = 'ts-test-DISTINCTIVE-key-value';
const REQUEST: EvaluateRequest = {
  state: { task: 'pick one' },
  questions: { pick: { type: 'choice', instructions: 'which?', criteria: { a: 'card a', b: 'card b' } } },
};

const DIRECT_BODY = {
  model: 'jev-1.13.0',
  answers: { pick: { type: 'choice', choice: 'a', probabilities: { a: 0.8, b: 0.2 }, confidence: 0.7 } },
  usage: { input_tokens: 120, output_tokens: 3 },
};

interface Seen {
  url: string;
  init: RequestInit;
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
    );
}

function recording(inner: typeof fetch, seen: Seen[]): typeof fetch {
  return (input, init) => {
    seen.push({ url: String(input), init: init ?? {} });
    return inner(input, init);
  };
}

async function failure(client: JevClient): Promise<Error> {
  try {
    await client.evaluate(REQUEST);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the call was expected to fail');
}

describe('the direct Jev client', () => {
  it('posts state, model and questions to /v1/systemone with a bearer key', async () => {
    const seen: Seen[] = [];
    const client = createJevDirectClient({
      apiKey: KEY,
      fetchImpl: recording(respond(200, DIRECT_BODY), seen),
    });
    await client.evaluate(REQUEST);

    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect(call?.url).toBe(`${JEV_DIRECT_BASE_URL}/v1/systemone`);
    expect(call?.url.startsWith('https://api.typesafe.ai/')).toBe(true);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers['content-type']).toBe('application/json');
    expect(Object.keys(headers).some((name) => name.startsWith('ai-gateway'))).toBe(false);
    expect(JSON.parse(String(call?.init.body))).toEqual({
      state: REQUEST.state,
      model: JEV_DIRECT_MODEL,
      questions: REQUEST.questions,
    });
  });

  it('names a stated model in the body instead of the alias', async () => {
    const seen: Seen[] = [];
    const client = createJevDirectClient({
      apiKey: KEY,
      model: 'jev-1.13.0',
      fetchImpl: recording(respond(200, DIRECT_BODY), seen),
    });
    await client.evaluate(REQUEST);
    expect((JSON.parse(String(seen[0]?.init.body)) as { model: string }).model).toBe('jev-1.13.0');
  });

  it('normalizes the answer to the shape the gateway arm returns, keeping the raw body', async () => {
    let clock = 10;
    const client = createJevDirectClient({
      apiKey: KEY,
      fetchImpl: respond(200, DIRECT_BODY),
      now: () => (clock += 40),
    });
    const result = await client.evaluate(REQUEST);

    expect(result.response.answers.pick).toEqual({
      type: 'choice',
      choice: 'a',
      probabilities: { a: 0.8, b: 0.2 },
    });
    expect(result.response.usage).toEqual({ inputTokens: 120, outputTokens: 3 });
    expect(result.response.providerMetadata).toEqual({ typesafe: { model: 'jev-1.13.0' } });
    expect(result.raw).toEqual(DIRECT_BODY);
    expect(result.latencyMs).toBe(40);
  });

  it('trims a trailing slash from a stated base URL', async () => {
    const seen: Seen[] = [];
    const client = createJevDirectClient({
      apiKey: KEY,
      baseUrl: 'https://example.test/',
      fetchImpl: recording(respond(200, DIRECT_BODY), seen),
    });
    await client.evaluate(REQUEST);
    expect(seen[0]?.url).toBe('https://example.test/v1/systemone');
  });

  it('refuses a blank key by naming the variable', () => {
    expect(() => createJevDirectClient({ apiKey: '  ' })).toThrow(/TYPESAFE_API_KEY is empty/);
  });

  it('reports 429 and 529 as rate refusals, with Retry-After when given', async () => {
    const limited = await failure(
      createJevDirectClient({
        apiKey: KEY,
        fetchImpl: respond(429, { error: 'slow down' }, { 'retry-after': '3' }),
      }),
    );
    expect(limited).toBeInstanceOf(JevRateLimitError);
    expect((limited as JevRateLimitError).retryAfterMs).toBe(3000);

    const overloaded = await failure(
      createJevDirectClient({ apiKey: KEY, fetchImpl: respond(529, { error: { message: 'Overloaded' } }) }),
    );
    expect(overloaded).toBeInstanceOf(JevRateLimitError);
    expect(overloaded.message).toBe('Overloaded');
  });

  it('reports any other failure with its status, and a network failure as status 0', async () => {
    const auth = await failure(
      createJevDirectClient({ apiKey: KEY, fetchImpl: respond(401, { error: 'bad key' }) }),
    );
    expect(auth).toBeInstanceOf(JevHttpError);
    expect((auth as JevHttpError).status).toBe(401);
    expect(auth.message).toBe('typesafe answered 401: bad key');

    const offline = await failure(
      createJevDirectClient({ apiKey: KEY, fetchImpl: () => Promise.reject(new TypeError('fetch failed')) }),
    );
    expect((offline as JevHttpError).status).toBe(0);
    expect(offline.message).toMatch(/typesafe request failed before a response \(TypeError\)/);
  });

  it('refuses a 200 whose body lacks the documented usage', async () => {
    const { usage: _usage, ...noUsage } = DIRECT_BODY;
    const error = await failure(createJevDirectClient({ apiKey: KEY, fetchImpl: respond(200, noUsage) }));
    expect(error).toBeInstanceOf(JevHttpError);
    expect(error.message).toMatch(/not an evaluation/);
  });

  it('never writes the key into a message, even when the service echoes it', async () => {
    const error = await failure(
      createJevDirectClient({ apiKey: KEY, fetchImpl: respond(401, { error: `rejected ${KEY}` }) }),
    );
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain('[key]');
  });
});
