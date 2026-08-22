/**
 * The `claude-cli` provider: shells out to the locally installed, already
 * authenticated `claude` binary.
 *
 * This is the default for local runs because no `ANTHROPIC_API_KEY` exists on
 * the lab machine. The envelope shape below was verified by probing the real
 * binary (samples live in `test/fixtures/claude-cli/`):
 *
 *   claude -p --model <model> --output-format json [--json-schema <schema>]
 *
 * → `{ is_error, result, structured_output?, usage{…}, total_cost_usd,
 *      api_error_status, modelUsage{…}, … }`
 *
 * The prompt goes on stdin (a single argv string is capped at 128 KiB on Linux);
 * the system prompt and schema go on argv, with an explicit size check.
 *
 * ## What bounds one call
 *
 * `CompletionRequest.maxTokens` cannot: this binary has no flag for it, so the
 * policy layer's 4,096-token default is one the other two providers enforce and
 * this one silently cannot. What the binary does offer is `--effort`, and left
 * at its default the gap is not academic. Measured on `@mtg/decklab`'s
 * standard-control scenario, one first selection round — a 922-byte prompt
 * whose answer is about 3 KB — came back in 238s having spent 15,555 output
 * tokens and $1.09. The same round at `--effort medium` took 84s, 5,088 tokens
 * and $0.56; at `low`, 86s, 4,389 tokens and $0.53. Three times the thinking
 * bought nothing the schema had room for, and at the default it put a live
 * build within seconds of `DEFAULT_CLI_TIMEOUT_MS` either side (mtg-bc2.24.2:
 * three samples of that round measured >300s, 275,549ms and 300,026ms).
 *
 * So the transport states the effort rather than inheriting it, and the timeout
 * stays at five minutes: against an 84s round that is roughly 3.5x headroom, and
 * the timeout was never the wrong number — the unbounded ask was.
 *
 * Tools are off for the same reason plus one more. Every call behind this seam
 * is one schema-constrained answer, so a completion that can read the
 * filesystem or run commands buys nothing and costs latency, a wider blast
 * radius than the prompt, and a source of nondeterminism the fixture provider
 * cannot record. `--strict-mcp-config` already said this about MCP servers;
 * `--tools ''` says it about the built-in set.
 */
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { BudgetGuard } from '../budget';
import { createProvider } from '../core';
import { LlmConfigError, LlmTransportError } from '../errors';
import { reconcileCost } from '../reconcile';
import type { CacheWriteSplit } from './pricing';
import type { LlmProvider, LlmTransport, RawRequest, RawResponse, TokenUsage } from '../types';

export const DEFAULT_CLAUDE_BINARY = 'claude';
export const DEFAULT_CLAUDE_CLI_MODEL = 'claude-fable-5';
export const DEFAULT_CLI_TIMEOUT_MS = 300_000;

/** The levels `claude --effort` accepts, in the order it lists them. */
export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ClaudeEffort = (typeof CLAUDE_EFFORT_LEVELS)[number];

/**
 * `medium` rather than the binary's own default: it answered the measured round
 * in a third of the time and a third of the tokens, and it is one step above the
 * `low` that already sufficed, so a harder question has somewhere to go.
 */
export const DEFAULT_CLAUDE_CLI_EFFORT: ClaudeEffort = 'medium';

/** Linux caps a single argv entry at 128 KiB; stay well under it. */
const MAX_ARG_BYTES = 96_000;

/**
 * The per-TTL breakdown of the cache-creation line.
 *
 * The binary reports it, and reading it is what makes the local price table
 * reproduce the binary's own `total_cost_usd` instead of approximating it: a
 * write costs 1.25x the base input rate at five minutes and 2x at one hour, and
 * every call this transport has made was at one hour. Priced at the API's
 * 5-minute default the 249-card flagship set run comes to $32.38 against a
 * reported $46.24 — the difference is entirely this field.
 */
const CacheCreationSchema = z.object({
  ephemeral_5m_input_tokens: z.number().nonnegative().optional(),
  ephemeral_1h_input_tokens: z.number().nonnegative().optional(),
});

const UsageSchema = z.object({
  input_tokens: z.number().nonnegative().optional(),
  output_tokens: z.number().nonnegative().optional(),
  cache_creation_input_tokens: z.number().nonnegative().optional(),
  cache_read_input_tokens: z.number().nonnegative().optional(),
  cache_creation: CacheCreationSchema.optional(),
});

const ModelUsageEntrySchema = z.object({
  canonicalModel: z.string().optional(),
  costUSD: z.number().optional(),
});

export const ClaudeCliEnvelopeSchema = z.object({
  type: z.string().optional(),
  subtype: z.string().optional(),
  is_error: z.boolean(),
  result: z.string(),
  structured_output: z.unknown().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  usage: UsageSchema.optional(),
  modelUsage: z.record(z.string(), ModelUsageEntrySchema).optional(),
  api_error_status: z.number().nullable().optional(),
  session_id: z.string().optional(),
  num_turns: z.number().optional(),
});

export type ClaudeCliEnvelope = z.infer<typeof ClaudeCliEnvelopeSchema>;

export interface ClaudeCliOptions {
  readonly binary?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  /** How hard the model may think per call. See the header for what it costs. */
  readonly effort?: ClaudeEffort;
  readonly cwd?: string;
  readonly extraArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ClaudeCliProviderOptions extends ClaudeCliOptions {
  readonly budget?: BudgetGuard;
  readonly maxAttempts?: number;
  readonly defaultMaxTokens?: number;
}

export const CLAUDE_BINARY_ENV = 'MTG_LLM_CLAUDE_BINARY';
export const CLAUDE_MODEL_ENV = 'MTG_LLM_MODEL';
export const CLAUDE_EFFORT_ENV = 'MTG_LLM_EFFORT';

/** The effort this transport will state, from the option, the environment, or the default. */
export function resolveEffort(option: ClaudeEffort | undefined, raw: string | undefined): ClaudeEffort {
  if (option !== undefined) return option;
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_CLAUDE_CLI_EFFORT;
  const trimmed = raw.trim();
  const match = CLAUDE_EFFORT_LEVELS.find((level) => level === trimmed);
  if (match === undefined) {
    throw new LlmConfigError(
      `${CLAUDE_EFFORT_ENV}=${trimmed} is not an effort level. Valid: ${CLAUDE_EFFORT_LEVELS.join(', ')}`,
    );
  }
  return match;
}

export function createClaudeCliTransport(options: ClaudeCliOptions = {}): LlmTransport {
  const env = options.env ?? process.env;
  const binary = options.binary ?? env[CLAUDE_BINARY_ENV] ?? DEFAULT_CLAUDE_BINARY;
  const model = options.model ?? env[CLAUDE_MODEL_ENV] ?? DEFAULT_CLAUDE_CLI_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  const effort = resolveEffort(options.effort, env[CLAUDE_EFFORT_ENV]);
  const extraArgs = options.extraArgs ?? [];

  return {
    name: 'claude-cli',
    model,
    async send(request: RawRequest): Promise<RawResponse> {
      const schemaArg = JSON.stringify(request.jsonSchema);
      assertArgSize('system prompt', request.system);
      assertArgSize('JSON schema', schemaArg);

      const args = [
        '-p',
        '--model',
        model,
        '--output-format',
        'json',
        '--system-prompt',
        request.system,
        '--json-schema',
        schemaArg,
        '--effort',
        effort,
        // The empty string is how this binary spells "no tools at all".
        '--tools',
        '',
        '--no-session-persistence',
        '--strict-mcp-config',
        ...extraArgs,
      ];

      const run = await runProcess({
        binary,
        args,
        stdin: request.prompt,
        timeoutMs,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      });

      if (run.timedOut) {
        throw new LlmTransportError('claude-cli', `timed out after ${timeoutMs}ms`, {
          output: tail(run.stderr),
        });
      }
      if (run.code !== 0) {
        throw new LlmTransportError(
          'claude-cli',
          `\`${binary}\` exited with code ${run.code ?? 'null'}${
            run.signal === null ? '' : ` (signal ${run.signal})`
          }: ${firstLine(run.stderr) || firstLine(run.stdout) || '<no output>'}`,
          { exitCode: run.code, output: tail(`${run.stdout}\n${run.stderr}`) },
        );
      }

      return envelopeToRawResponse(parseClaudeCliEnvelope(run.stdout), model);
    },
  };
}

export function createClaudeCliProvider(options: ClaudeCliProviderOptions = {}): LlmProvider {
  return createProvider(createClaudeCliTransport(options), {
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    ...(options.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: options.defaultMaxTokens }),
  });
}

/** Parse and validate the `--output-format json` envelope. */
export function parseClaudeCliEnvelope(stdout: string): ClaudeCliEnvelope {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new LlmTransportError('claude-cli', 'produced no output on stdout');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (error: unknown) {
    throw new LlmTransportError('claude-cli', 'stdout was not JSON', {
      cause: error,
      output: tail(trimmed),
    });
  }
  const result = ClaudeCliEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmTransportError(
      'claude-cli',
      `envelope did not match the expected shape: ${result.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
      { output: tail(trimmed) },
    );
  }
  return result.data;
}

/**
 * Turn a validated envelope into a raw response, or throw on a reported error.
 *
 * `total_cost_usd` and `usage` are independently optional on this envelope, and
 * they are two separate accounts of the same call. Reading them as one is how a
 * response carrying dollars and no usage recorded $0.65903 of settled spend
 * against four zero token counts, and how a response whose usage was nine times
 * too small for its dollars passed into a published total. So both are carried
 * out of here, priced against each other, and the verdict travels with them:
 * this transport records what it was told and refuses to imply the two halves
 * agreed when nothing checked.
 */
export function envelopeToRawResponse(envelope: ClaudeCliEnvelope, fallbackModel: string): RawResponse {
  if (envelope.is_error) {
    throw new LlmTransportError('claude-cli', envelope.result || 'reported an error', {
      httpStatus: envelope.api_error_status ?? null,
      output: envelope.result,
    });
  }
  const usage = toTokenUsage(envelope.usage);
  const costUsd = envelope.total_cost_usd;
  const model = canonicalModel(envelope) ?? fallbackModel;
  const split = cacheWriteSplit(envelope.usage);
  return {
    text: envelope.result,
    ...(envelope.structured_output === undefined ? {} : { structured: envelope.structured_output }),
    usage,
    costUsd: costUsd ?? 0,
    costSource: costUsd === undefined ? 'unknown' : 'reported',
    costCheck: reconcileCost({
      model,
      usage,
      usageMeasured: envelope.usage !== undefined,
      reportedUsd: costUsd ?? null,
      ...(split === undefined ? {} : { cacheWrite: split }),
    }),
    model,
  };
}

/**
 * The cache-write TTL split the envelope reported.
 *
 * An envelope with no `cache_creation` breakdown gets no split at all rather
 * than a fabricated one, so `estimateCostUsd` falls back to its documented
 * default instead of this function quietly asserting a TTL nobody sent.
 */
function cacheWriteSplit(usage: ClaudeCliEnvelope['usage']): CacheWriteSplit | undefined {
  const creation = usage?.cache_creation;
  if (creation === undefined) return undefined;
  return {
    ttl5m: creation.ephemeral_5m_input_tokens ?? 0,
    ttl1h: creation.ephemeral_1h_input_tokens ?? 0,
  };
}

function canonicalModel(envelope: ClaudeCliEnvelope): string | undefined {
  const entries = Object.entries(envelope.modelUsage ?? {});
  const first = entries[0];
  if (first === undefined) return undefined;
  return first[1].canonicalModel ?? first[0];
}

function toTokenUsage(usage: ClaudeCliEnvelope['usage']): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
  };
}

interface ProcessRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

function runProcess(input: {
  readonly binary: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly cwd?: string;
}): Promise<ProcessRun> {
  return new Promise<ProcessRun>((resolve, reject) => {
    const child = spawn(input.binary, [...input.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, input.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const hint =
        error.code === 'ENOENT'
          ? `\`${input.binary}\` could not be executed (ENOENT). Install Claude Code so \`claude\` ` +
            `is on PATH, or point ${CLAUDE_BINARY_ENV} at the binary.`
          : error.message;
      reject(new LlmTransportError('claude-cli', hint, { cause: error }));
    });

    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      // EPIPE here means the child already exited; the 'close' handler reports why.
      if (error.code !== 'EPIPE') stderr += `\nstdin error: ${error.message}`;
    });
    child.stdin.end(input.stdin, 'utf8');

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

function assertArgSize(label: string, value: string): void {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_ARG_BYTES) {
    throw new LlmConfigError(
      `${label} is ${bytes} bytes, over the ${MAX_ARG_BYTES}-byte limit the claude-cli transport ` +
        'can pass on argv. Shorten it, or move the bulk into the prompt (which is sent on stdin).',
    );
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n', 1)[0]?.trim() ?? '';
}

function tail(text: string, limit = 2000): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}
