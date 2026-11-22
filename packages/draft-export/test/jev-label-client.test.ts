/**
 * The gateway client: the request it writes, and what it does with each way the
 * gateway can answer. Every test drives a fake `fetch`; none reaches a network.
 *
 * The property that matters most is the one about the key: the runner logs
 * whatever a failed call's message says, so a message carrying the key would put
 * a credential in a log. The key here is a distinctive string so a leak is a
 * plain substring check.
 */
import { describe, expect, it } from 'vitest';
import {
  GATEWAY_BASE_URL,
  JEV_MODEL_ID,
  JevHttpError,
  JevRateLimitError,
  createJevClient,
} from '../tools/jev-label/jev-client';
import type { EvaluateRequest } from '../tools/jev-label/jev-client';
import { answerBody } from './jev-label-fixture';

const KEY = 'sk-test-DISTINCTIVE-key-value';
const REQUEST: EvaluateRequest = {
  state: { task: 'pick one' },
  questions: { pick: { type: 'choice', instructions: 'which?', criteria: { a: 'card a', b: 'card b' } } },
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

async function failure(client: ReturnType<typeof createJevClient>): Promise<Error> {
  try {
    await client.evaluate(REQUEST);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the call was expected to fail');
}

describe('the Jev gateway client', () => {
  it('posts the documented request and returns the parsed answer with the raw body', async () => {
    const seen: Seen[] = [];
    const body = answerBody(['a', 'b'], { favor: 'b' });
    const client = createJevClient({ apiKey: KEY, fetchImpl: recording(respond(200, body), seen) });

    const result = await client.evaluate(REQUEST);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${GATEWAY_BASE_URL}/evaluation-model`);
    expect(seen[0]?.init.method).toBe('POST');
    const headers = seen[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(headers['ai-model-id']).toBe(JEV_MODEL_ID);
    expect(headers['ai-evaluation-model-specification-version']).toBe('4');
    expect(headers['ai-gateway-auth-method']).toBe('api-key');
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({
      state: REQUEST.state,
      questions: REQUEST.questions,
    });
    expect(result.response.answers['pick']?.choice).toBe('b');
    expect(result.raw).toEqual(body);
  });

  it('measures latency with the clock it was given', async () => {
    let tick = 100;
    const client = createJevClient({
      apiKey: KEY,
      fetchImpl: respond(200, answerBody(['a', 'b'])),
      now: () => {
        tick += 250;
        return tick;
      },
    });
    expect((await client.evaluate(REQUEST)).latencyMs).toBe(250);
  });

  it('strips a trailing slash from a custom base URL', async () => {
    const seen: Seen[] = [];
    const client = createJevClient({
      apiKey: KEY,
      baseUrl: 'https://gateway.example/v4/ai//',
      fetchImpl: recording(respond(200, answerBody(['a', 'b'])), seen),
    });
    await client.evaluate(REQUEST);
    expect(seen[0]?.url).toBe('https://gateway.example/v4/ai/evaluation-model');
  });

  it('refuses to be built without a key', () => {
    expect(() => createJevClient({ apiKey: '   ' })).toThrow(/empty/);
  });

  it('reports a 429 as a rate limit and reads Retry-After in seconds', async () => {
    const client = createJevClient({
      apiKey: KEY,
      fetchImpl: respond(429, { error: { message: 'slow down' } }, { 'retry-after': '7' }),
    });
    const error = await failure(client);
    expect(error).toBeInstanceOf(JevRateLimitError);
    expect((error as JevRateLimitError).retryAfterMs).toBe(7000);
    expect(error.message).toBe('slow down');
  });

  it('reports a 429 with no Retry-After as an unknown wait', async () => {
    const client = createJevClient({ apiKey: KEY, fetchImpl: respond(429, { error: 'quota' }) });
    expect(((await failure(client)) as JevRateLimitError).retryAfterMs).toBeNull();
  });

  it('reports a provider timeout with its status so a caller can tell it from an auth refusal', async () => {
    const client = createJevClient({
      apiKey: KEY,
      fetchImpl: respond(504, { error: { message: 'upstream timed out' } }),
    });
    const error = await failure(client);
    expect(error).toBeInstanceOf(JevHttpError);
    expect((error as JevHttpError).status).toBe(504);
    expect(error.message).toContain('upstream timed out');
  });

  it('reports a network failure as status 0', async () => {
    const client = createJevClient({
      apiKey: KEY,
      fetchImpl: () => Promise.reject(new TypeError('fetch failed')),
    });
    const error = await failure(client);
    expect((error as JevHttpError).status).toBe(0);
  });

  it('refuses a 200 whose body is not an evaluation', async () => {
    const client = createJevClient({ apiKey: KEY, fetchImpl: respond(200, { answers: 'nope' }) });
    const error = await failure(client);
    expect((error as JevHttpError).status).toBe(200);
    expect(error.message).toContain('not an evaluation');
  });

  it('refuses a 200 that is not JSON at all', async () => {
    const client = createJevClient({ apiKey: KEY, fetchImpl: respond(200, '<html>gateway error</html>') });
    expect(((await failure(client)) as JevHttpError).status).toBe(200);
  });

  it('never puts the key in a failure message, even when the gateway echoes it', async () => {
    const echoes = [
      respond(401, { error: { message: `rejected ${KEY}` } }),
      respond(429, { error: `quota for ${KEY}` }),
      respond(500, `internal error for ${KEY}`),
      respond(200, { answers: 'nope' }),
      () => Promise.reject(new TypeError(`connect failed for ${KEY}`)),
    ];
    for (const fetchImpl of echoes) {
      const error = await failure(createJevClient({ apiKey: KEY, fetchImpl }));
      expect(error.message).not.toContain(KEY);
    }
    const echoed = await failure(
      createJevClient({ apiKey: KEY, fetchImpl: respond(401, { error: `rejected ${KEY}` }) }),
    );
    expect(echoed.message).toContain('[key]');
  });
});
