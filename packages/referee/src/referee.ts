/**
 * The referee: one framed question, one indexed answer, one metered record.
 *
 * The kernel owns the game throughout. This asks a model which of the kernel's
 * own options to take, re-checks the answer against the state, and hands back
 * an action the caller applies with `reduce`. Nothing here can produce a move
 * the kernel did not already enumerate as legal.
 *
 * Two failure classes are treated differently, on purpose.
 *
 * A model that answers badly — off-schema output, an index past the end, a
 * transport that died mid-call, a refusal — is a thing the deterministic agent
 * already covers. The game continues on the fallback's decision and the
 * rejection is recorded, so an unreliable referee shows up as a number rather
 * than as a crashed game.
 *
 * Everything else is raised. A budget ceiling is a stop the run asked for, and
 * absorbing it would mean the ceiling bought nothing; a missing fixture or an
 * unresolvable provider is a misconfiguration, and falling back would turn a
 * broken replay into a silently deterministic run that still passed its tests.
 *
 * The ceiling itself is the provider's, and there is deliberately no second one
 * here. `@mtg/llm` bills a call attempt by attempt — each attempt is recorded
 * against the provider's guard the moment it comes back, and a completion that
 * never validates raises `LlmSchemaValidationError` with no `CompletionMeta` at
 * all. A guard the referee kept alongside could therefore only ever see the
 * calls that *succeeded*, which is the wrong half: a model answering off-schema
 * three times a ruling is exactly the run a ceiling exists to stop. A caller who
 * wants the referee capped separately from the rest of a run gives the ceiling
 * to a provider of its own — `resolveProvider({ budget })`, as the art pipeline's CLI
 * does — and every attempt lands inside it.
 */
import type { Action, AgentView, Decision, PlayerAgent, PlayerId } from '@mtg/kernel';
import type {
  BudgetSnapshot,
  CompletionMeta,
  CostSource,
  LlmErrorCode,
  LlmProvider,
  ProviderName,
} from '@mtg/llm';
import { isLlmError } from '@mtg/llm';
import type { FrameOptions } from './frame';
import { frameDecision } from './frame';
import { REFEREE_SYSTEM, renderFrame } from './prompt';
import type { Ruling } from './ruling';
import { RulingSchema, selectRuledAction } from './ruling';

/** Model failures the deterministic agent covers for; everything else is raised. */
const RECOVERABLE_CODES: readonly LlmErrorCode[] = ['schema_validation', 'transport', 'refusal'];

/** One ruling, whoever ended up making it. */
export interface RulingRecord {
  readonly decision: Decision['kind'];
  readonly player: PlayerId;
  readonly optionCount: number;
  /** The kernel's report that its enumeration covered the whole legal space. */
  readonly enumerationComplete: boolean;
  readonly source: 'model' | 'fallback';
  readonly chosenIndex: number | null;
  readonly rationale: string | null;
  /** Why the model's answer was not used, when it was not. */
  readonly rejection: string | null;
  /** What this ruling took out of the budget, whether or not it worked. */
  readonly costUsd: number;
  readonly costSource: CostSource;
  readonly latencyMs: number;
  readonly provider: ProviderName;
  readonly model: string;
  /** Backend calls this ruling paid for, including the ones that failed. */
  readonly attempts: number;
}

/** The metering half of a record, which the two paths derive differently. */
type RulingSpend = Pick<RulingRecord, 'costUsd' | 'costSource' | 'provider' | 'model' | 'attempts'>;

export interface RulingOutcome {
  readonly action: Action;
  readonly record: RulingRecord;
}

export interface RefereeOptions {
  readonly provider: LlmProvider;
  /** Decides when the model cannot. Deterministic, and never asked to explain. */
  readonly fallback: PlayerAgent;
  readonly system?: string;
  readonly frame?: FrameOptions;
  /** Injectable clock, so latency is assertable. */
  readonly now?: () => number;
}

export interface Referee {
  readonly name: string;
  readonly system: string;
  rule(view: AgentView): Promise<RulingOutcome>;
  /** Every ruling so far, in order. */
  records(): readonly RulingRecord[];
}

export function createReferee(options: RefereeOptions): Referee {
  const { provider, fallback } = options;
  const system = options.system ?? REFEREE_SYSTEM;
  const now = options.now ?? Date.now;
  const records: RulingRecord[] = [];

  async function rule(view: AgentView): Promise<RulingOutcome> {
    // No ceiling check here: the provider asserts its guard before every attempt
    // it makes, and a second copy of that policy in front of it would be a
    // policy in two places that can disagree. A refused call raises
    // `LlmBudgetExceededError` through this function untouched — it is not a
    // model answering badly, so the fallback never sees it.
    const prompt = renderFrame(frameDecision(view, options.frame ?? {}));
    const before = provider.budget.snapshot();
    const startedAt = now();

    let ruling: Ruling;
    let meta: CompletionMeta;
    try {
      const completion = await provider.complete({ system, prompt, schema: RulingSchema });
      ruling = completion.value;
      meta = completion.meta;
    } catch (error: unknown) {
      if (!isRecoverable(error)) throw error;
      return keep(fall(view, messageOf(error), now() - startedAt, spentSince(before)));
    }
    const latencyMs = now() - startedAt;

    const selection = selectRuledAction(view, ruling);
    if (!selection.ok) return keep(fall(view, selection.reason, latencyMs, metered(meta)));

    return keep({
      action: selection.action,
      record: {
        ...asked(view),
        source: 'model',
        chosenIndex: ruling.optionIndex,
        rationale: ruling.rationale,
        rejection: null,
        latencyMs,
        ...metered(meta),
      },
    });
  }

  function fall(view: AgentView, rejection: string, latencyMs: number, spend: RulingSpend): RulingOutcome {
    return {
      action: fallback.decide(view),
      record: {
        ...asked(view),
        source: 'fallback',
        chosenIndex: null,
        rationale: null,
        rejection,
        latencyMs,
        ...spend,
      },
    };
  }

  /** What a completion that came back cost, from the figures it carries. */
  function metered(meta: CompletionMeta): RulingSpend {
    return {
      costUsd: meta.costUsd,
      costSource: meta.costSource,
      provider: meta.provider,
      model: meta.model,
      attempts: meta.attempts,
    };
  }

  /**
   * What a completion that did *not* come back cost, read off the guard.
   *
   * There is no `CompletionMeta` on this path and the money is real anyway:
   * `@mtg/llm` records each attempt as it returns and only raises once the
   * attempts are exhausted, so three off-schema answers are three paid calls
   * and no meta. The provider's guard is the one thing that saw them, and it is
   * the same guard the ceiling reads, so its delta is exactly what this ruling
   * took out of the budget. The figure is known; which price table produced it
   * is not, which is what `unknown` says. A transport that died before
   * answering recorded nothing and reports a true zero.
   */
  function spentSince(before: BudgetSnapshot): RulingSpend {
    const after = provider.budget.snapshot();
    return {
      costUsd: after.spentUsd - before.spentUsd,
      costSource: 'unknown',
      provider: provider.name,
      model: provider.model,
      attempts: after.calls - before.calls,
    };
  }

  function keep(outcome: RulingOutcome): RulingOutcome {
    records.push(outcome.record);
    return outcome;
  }

  return {
    name: `referee(${provider.name})`,
    system,
    rule,
    records: () => [...records],
  };
}

function asked(
  view: AgentView,
): Pick<RulingRecord, 'decision' | 'player' | 'optionCount' | 'enumerationComplete'> {
  return {
    decision: view.decision.kind,
    player: view.player,
    optionCount: view.decision.options.length,
    enumerationComplete: view.decision.complete,
  };
}

function isRecoverable(error: unknown): boolean {
  return isLlmError(error) && RECOVERABLE_CODES.includes(error.code);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
