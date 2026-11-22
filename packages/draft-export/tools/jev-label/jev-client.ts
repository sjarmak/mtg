/**
 * The one call the labeling study makes: Jev's `evaluate`, over plain HTTP.
 *
 * Jev is an evaluation model, reachable two ways, and both are written out here
 * behind the one `JevClient` interface rather than installing an SDK for either.
 *
 * The gateway arm (`createJevClient`) goes through the Vercel AI Gateway as
 * `typesafe-ai/jev`. Its shape was read from `@ai-sdk/gateway`'s
 * `GatewayEvaluationModel.doEvaluate` (ai 7.0.106, omni-experiments), not
 * guessed: `POST {base}/evaluation-model` with `state` and `questions` as the
 * body, the model id and specification version as headers.
 *
 * The direct arm (`createJevDirectClient`) goes to TypeSafe's own API, keyed by
 * `TYPESAFE_API_KEY`. Its shape was read from https://docs.typesafe.ai/api.md on
 * 2026-09-22 (mtg-onjme.2; `docs/research/stagehand-jev-seam.md` records it):
 * `POST {base}/v1/systemone` with `state`, `model` and `questions` in the body,
 * and a response whose `usage` is snake case. That response is normalized to the
 * gateway's shape, so a caller reads one `EvaluateResponse` whichever arm ran.
 *
 * This is an offline labeler and nothing that ships calls it (mtg-bw8z's ruling
 * stands; the playtester allowed the one-time run in dec-m7zo, 2026-09-20). It lives
 * under `tools/` for that reason and is not a provider behind `@mtg/llm`;
 * `mtg-h76gz.1` is the bead that would give the seam a proper home.
 *
 * The key is validated when the client is built and appears in no message this
 * module writes, so a failure the caller logs cannot leak it.
 */
import { z } from 'zod';

export const JEV_MODEL_ID = 'typesafe-ai/jev';
export const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v4/ai';

export const JEV_DIRECT_BASE_URL = 'https://api.typesafe.ai';
/** The alias the vendor documents for the current Jev release. */
export const JEV_DIRECT_MODEL = 'jev-latest';
/** The variable TypeSafe's own SDKs read the key from. */
export const JEV_DIRECT_KEY_VARIABLE = 'TYPESAFE_API_KEY';

const EVALUATION_SPECIFICATION_VERSION = '4';
const GATEWAY_PROTOCOL_VERSION = '0.0.1';
const DEFAULT_TIMEOUT_MS = 30_000;

/** A `choice` question: instructions, and one criterion sentence per option. */
export interface ChoiceQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

export interface EvaluateRequest {
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, ChoiceQuestion>>;
}

const ChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

export const EvaluateResponseSchema = z.object({
  answers: z.record(z.string(), ChoiceAnswerSchema),
  rounding: z.object({ probabilityDecimals: z.number().optional() }).partial().optional(),
  usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional(),
  providerMetadata: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

/** The direct API's answer, as documented: `probabilities` and `usage` are required there. */
const DirectEvaluateResponseSchema = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal('choice'),
      choice: z.string(),
      probabilities: z.record(z.string(), z.number()),
      confidence: z.number().optional(),
    }),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
export type EvaluateResponse = z.infer<typeof EvaluateResponseSchema>;

export interface EvaluateResult {
  readonly response: EvaluateResponse;
  /** The body exactly as the service sent it, so a stored record can be re-scored without calling again. */
  readonly raw: unknown;
  readonly latencyMs: number;
}

/** The service refused for rate, a quota or overload: the run stops rather than retrying past it. */
export class JevRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = 'JevRateLimitError';
  }
}

/** Any other non-success answer, with the HTTP status so a caller can tell auth from an outage. */
export class JevHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'JevHttpError';
  }
}

export interface JevClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export interface JevDirectClientOptions extends JevClientOptions {
  /** The model named in the body; the documented alias unless stated. */
  readonly model?: string;
}

export interface JevClient {
  evaluate(request: EvaluateRequest): Promise<EvaluateResult>;
}

/** What differs between the two arms; everything else is one code path. */
interface Route {
  /** The word error messages call the far end. */
  readonly label: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  body(request: EvaluateRequest): unknown;
  /** Statuses that mean "back off", reported as `JevRateLimitError`. */
  readonly rateStatuses: readonly number[];
  /** The body as an evaluation, or why it is not one. */
  normalize(raw: unknown): EvaluateResponse | { readonly invalid: string };
}

/** `Retry-After` in whole seconds, or null when the header is absent or is an HTTP date. */
function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

/** The error body as one short line, never the request that caused it, with any echo of the key blanked. */
async function errorDetail(response: Response, secret: string): Promise<string> {
  return (await rawErrorDetail(response)).replaceAll(secret, '[key]');
}

async function rawErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (text === '') return response.statusText;
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error = (body as { error: unknown }).error;
      if (typeof error === 'string') return error.slice(0, 300);
      if (typeof error === 'object' && error !== null && 'message' in error) {
        return String((error as { message: unknown }).message).slice(0, 300);
      }
    }
  } catch {
    // A non-JSON body is reported as text below.
  }
  return text.slice(0, 300);
}

function evaluationClient(options: JevClientOptions, route: Route): JevClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());

  return {
    async evaluate(request) {
      const started = now();
      let response: Response;
      try {
        response = await doFetch(route.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
            ...route.headers,
          },
          body: JSON.stringify(route.body(request)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.name : 'unknown';
        throw new JevHttpError(`${route.label} request failed before a response (${reason})`, 0);
      }
      if (route.rateStatuses.includes(response.status)) {
        throw new JevRateLimitError(
          await errorDetail(response, options.apiKey),
          retryAfterMs(response.headers),
        );
      }
      if (!response.ok) {
        throw new JevHttpError(
          `${route.label} answered ${response.status}: ${await errorDetail(response, options.apiKey)}`,
          response.status,
        );
      }
      const raw: unknown = await response.json().catch(() => null);
      const evaluation = route.normalize(raw);
      if ('invalid' in evaluation) {
        throw new JevHttpError(
          `${route.label} answered 200 with a body that is not an evaluation: ${evaluation.invalid}`,
          200,
        );
      }
      return { response: evaluation, raw, latencyMs: Math.round(now() - started) };
    },
  };
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** Jev through the Vercel AI Gateway, keyed by `AI_GATEWAY_API_KEY`. */
export function createJevClient(options: JevClientOptions): JevClient {
  if (options.apiKey.trim() === '') {
    throw new Error('AI_GATEWAY_API_KEY is empty: the labeler makes no call without a key');
  }
  return evaluationClient(options, {
    label: 'gateway',
    url: `${trimBase(options.baseUrl ?? GATEWAY_BASE_URL)}/evaluation-model`,
    headers: {
      'ai-gateway-protocol-version': GATEWAY_PROTOCOL_VERSION,
      'ai-gateway-auth-method': 'api-key',
      'ai-evaluation-model-specification-version': EVALUATION_SPECIFICATION_VERSION,
      'ai-model-id': JEV_MODEL_ID,
    },
    body: (request) => ({ state: request.state, questions: request.questions }),
    rateStatuses: [429],
    normalize: (raw) => {
      const parsed = EvaluateResponseSchema.safeParse(raw);
      return parsed.success ? parsed.data : { invalid: parsed.error.message };
    },
  });
}

/** The direct answer in the gateway's shape: camel-case usage, the served model under `providerMetadata`. */
function normalizeDirect(raw: unknown): EvaluateResponse | { readonly invalid: string } {
  const parsed = DirectEvaluateResponseSchema.safeParse(raw);
  if (!parsed.success) return { invalid: parsed.error.message };
  return {
    answers: Object.fromEntries(
      Object.entries(parsed.data.answers).map(([id, answer]) => [
        id,
        { type: answer.type, choice: answer.choice, probabilities: answer.probabilities },
      ]),
    ),
    usage: {
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens,
    },
    providerMetadata: { typesafe: { model: parsed.data.model } },
  };
}

/**
 * Jev from TypeSafe's own API, keyed by `TYPESAFE_API_KEY`. 529 is the vendor's
 * documented "overloaded, retry with backoff", so it is a rate refusal here.
 */
export function createJevDirectClient(options: JevDirectClientOptions): JevClient {
  if (options.apiKey.trim() === '') {
    throw new Error(`${JEV_DIRECT_KEY_VARIABLE} is empty: Jev makes no call without a key`);
  }
  const model = options.model ?? JEV_DIRECT_MODEL;
  return evaluationClient(options, {
    label: 'typesafe',
    url: `${trimBase(options.baseUrl ?? JEV_DIRECT_BASE_URL)}/v1/systemone`,
    headers: {},
    body: (request) => ({ state: request.state, model, questions: request.questions }),
    rateStatuses: [429, 529],
    normalize: normalizeDirect,
  });
}
