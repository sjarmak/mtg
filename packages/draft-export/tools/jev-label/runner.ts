/**
 * The labeling loop: paced, recorded, resumable, and unable to spend unless it
 * is handed a ceiling.
 *
 * The playtester's first ruling (dec-m7zo, 2026-09-20) allowed a one-time offline run
 * on the gateway's free tier and nothing past it, so the loop's defaults all
 * lean toward stopping. It stops at the first rate limit instead of retrying
 * past it, at the first answer whose gateway charge is not exactly zero, at an
 * auth refusal, and at a call cap. Her second ruling (dec-3nhp) approved a paid
 * pass capped at a stated dollar amount; that arrives as `maxUsd`, which has no
 * default, and only its presence lets a charge through. A gateway run stops
 * before the dearest observed charge could cross the ceiling. A direct run
 * instead reserves a conservative fixed bound before every request. A gateway
 * timeout is the one failure it retries, once, after a cooldown, because the probe that preceded this run hit one
 * (a 504 from the model provider, not a rate limit) and lost nothing by it.
 *
 * Progress is the record file. A decision whose answer is already in it is
 * skipped, so a stopped run restarts where it stopped and never pays for the
 * same call twice. Repeat calls follow evenly sized groups of primary labels:
 * that puts stability evidence into a partial run without making an immediate
 * repeat that could merely measure a cache.
 */
import type { JevClient } from './jev-client';
import { JevHttpError, JevRateLimitError } from './jev-client';
import type { LabelDecision } from './decisions';
import { decisionRequest } from './questions';
import type { AnswerRecord, StopReason, StopRecord } from './record';
import { answerView } from './record';

export interface WorkItem {
  readonly decision: LabelDecision;
  readonly repeat: number;
}

/** Evenly spaced decisions repeated after the primary group that follows each one. */
export function workPlan(decisions: readonly LabelDecision[], repeats: number): readonly WorkItem[] {
  if (!Number.isInteger(repeats) || repeats < 0 || repeats > decisions.length) {
    throw new Error(
      `repeats must be an integer in 0-${String(decisions.length)}, received ${String(repeats)}`,
    );
  }
  if (repeats === 0) return decisions.map((decision) => ({ decision, repeat: 0 }));
  const stride = decisions.length / repeats;
  return Array.from({ length: repeats }, (_unused, index) => {
    const start = Math.floor(index * stride);
    const end = index + 1 === repeats ? decisions.length : Math.floor((index + 1) * stride);
    const decision = decisions[start] as LabelDecision;
    return [
      ...decisions.slice(start, end).map((primary) => ({ decision: primary, repeat: 0 })),
      { decision, repeat: 1 },
    ];
  }).flat();
}

export interface RunnerOptions {
  readonly client: JevClient;
  /** Milliseconds between the start of one request and the start of the next. */
  readonly gapMs: number;
  /** Requests this run may make, failed ones included. */
  readonly maxRequests: number;
  /** What the record file already holds: `key#repeat` of every stored answer. */
  readonly done: ReadonlySet<string>;
  readonly onAnswer: (record: AnswerRecord) => void;
  readonly onProgress?: (message: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /** Wait before the one retry of a gateway timeout. */
  readonly cooldownMs?: number;
  /**
   * The spend ceiling in dollars. Absent, the first non-zero charge stops the
   * run. Present, charges are allowed up to it and the run stops before a
   * request the priciest call so far says would cross it.
   */
  readonly maxUsd?: number;
  /** Dollars the record already holds, so a resume does not get a fresh allowance. */
  readonly priorSpendUsd?: number;
  /** The dearest single call already in the record. */
  readonly priorPeakUsd?: number;
  /**
   * Conservative dollars reserved before each paid request. Unlike a gateway
   * charge, this counts failed requests too and never depends on a response.
   */
  readonly requestUpperBoundUsd?: number;
}

export interface RunReport {
  readonly stop: Omit<StopRecord, 'kind' | 'at'>;
  /** Items in the plan that already had an answer. */
  readonly skipped: number;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const RETRYABLE = new Set([0, 502, 503, 504]);

/** Jev's published 64k request limit at $0.042/Mtok, doubled for safety. */
export const JEV_DIRECT_REQUEST_UPPER_BOUND_USD = 64_000 * (0.042 / 1_000_000) * 2;

export const doneKey = (key: string, repeat: number): string => `${key}#${String(repeat)}`;

function stopped(
  reason: StopReason,
  detail: string,
  requests: number,
  recorded: number,
  skipped: number,
  spentUsd: number,
): RunReport {
  return { stop: { reason, detail, requests, recorded, spentUsd }, skipped };
}

const dollars = (amount: number): string => `$${amount.toFixed(4)}`;

export async function runPlan(plan: readonly WorkItem[], options: RunnerOptions): Promise<RunReport> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const say = options.onProgress ?? (() => undefined);
  let requests = 0;
  let recorded = 0;
  let skipped = 0;
  let spent = options.priorSpendUsd ?? 0;
  let peak = options.priorPeakUsd ?? 0;
  const ceiling = options.maxUsd;
  const requestUpperBound = options.requestUpperBoundUsd;
  if (requestUpperBound !== undefined) {
    if (!Number.isFinite(requestUpperBound) || requestUpperBound <= 0) {
      throw new Error('requestUpperBoundUsd must be a positive finite number');
    }
    if (ceiling === undefined) throw new Error('requestUpperBoundUsd requires maxUsd');
  }
  let lastStart = Number.NEGATIVE_INFINITY;

  for (const item of plan) {
    const id = doneKey(item.decision.key, item.repeat);
    if (options.done.has(id)) {
      skipped += 1;
      continue;
    }
    let attempts = 0;
    for (;;) {
      if (requests >= options.maxRequests) {
        return stopped(
          'cap',
          `request cap of ${String(options.maxRequests)} reached`,
          requests,
          recorded,
          skipped,
          spent,
        );
      }
      const nextRequestUsd = requestUpperBound ?? peak;
      if (ceiling !== undefined && (spent >= ceiling || spent + nextRequestUsd > ceiling)) {
        return stopped(
          'budget',
          requestUpperBound === undefined
            ? `${dollars(spent)} spent against a ${dollars(ceiling)} ceiling; ` +
                `the dearest call so far cost ${dollars(peak)}, so another could cross it`
            : `${dollars(spent)} upper-bound estimate against a ${dollars(ceiling)} ceiling; ` +
                `another request reserves ${dollars(requestUpperBound)} and would cross it`,
          requests,
          recorded,
          skipped,
          spent,
        );
      }
      const wait = lastStart + options.gapMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      requests += 1;
      if (requestUpperBound !== undefined) spent += requestUpperBound;
      attempts += 1;
      const request = decisionRequest(item.decision);
      try {
        const result = await options.client.evaluate(request);
        const record: AnswerRecord = {
          kind: 'answer',
          key: item.decision.key,
          repeat: item.repeat,
          podSeed: item.decision.podSeed,
          round: item.decision.round,
          pickNumber: item.decision.pickNumber,
          botPickId: item.decision.botPickId,
          packIds: item.decision.pack.map((card) => card.id),
          poolIds: item.decision.pool.map((card) => card.id),
          at: new Date(lastStart).toISOString(),
          latencyMs: result.latencyMs,
          request,
          raw: result.raw,
        };
        options.onAnswer(record);
        recorded += 1;
        const view = answerView(record);
        if (requestUpperBound === undefined) {
          if (ceiling === undefined) {
            if (view.cost !== 0) {
              return stopped(
                'spend',
                `the gateway reported a charge of ${String(view.cost)} on ${id}; the free tier reports 0`,
                requests,
                recorded,
                skipped,
                spent,
              );
            }
          } else if (Number.isNaN(view.cost)) {
            // An unstated charge cannot be counted against the ceiling, so the ceiling cannot be honored past it.
            return stopped(
              'spend',
              `the gateway stated no charge on ${id}, so the spend against the ceiling is unknown`,
              requests,
              recorded,
              skipped,
              spent,
            );
          } else {
            spent += view.cost;
            peak = Math.max(peak, view.cost);
          }
        }
        say(`${String(recorded)} recorded, ${String(requests)} requests, ${id}`);
        break;
      } catch (error) {
        if (error instanceof JevRateLimitError) {
          return stopped(
            'rate-limit',
            `rate limited at ${id}: ${error.message}`,
            requests,
            recorded,
            skipped,
            spent,
          );
        }
        if (error instanceof JevHttpError && (error.status === 401 || error.status === 403)) {
          return stopped(
            'auth',
            `provider refused the key (${String(error.status)})`,
            requests,
            recorded,
            skipped,
            spent,
          );
        }
        if (error instanceof JevHttpError && RETRYABLE.has(error.status) && attempts < 2) {
          say(`${id}: ${error.message}; one retry after ${String(cooldownMs)} ms`);
          await sleep(cooldownMs);
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        return stopped('error', `${id}: ${detail}`, requests, recorded, skipped, spent);
      }
    }
  }
  return stopped('done', 'every planned decision has an answer', requests, recorded, skipped, spent);
}
