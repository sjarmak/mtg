/**
 * How often a learned candidate picks the action the policy it was trained on
 * would have picked, on that policy's own state distribution.
 *
 * This exists because a campaign verdict does not say *why* a candidate lost.
 * `train-learned-evaluator.ts` builds its dataset by
 * `learnedPreferenceExamplesFromEpisode`, which labels the greedy bot's chosen
 * action +1 and every alternative -1. That objective is imitation: its ceiling
 * is the reference policy, and every disagreement on the reference's own states
 * is imitation error rather than an improvement, because nothing in the labels
 * ever rated an unchosen action by what it went on to produce. So the one
 * number that separates "the candidate learned something different" from "the
 * candidate learned the same thing, badly" is the top-1 agreement rate, read
 * per decision kind — an aggregate hides it, since priority is 94% of the
 * decisions in a game and the game is decided in combat and on the mulligan.
 *
 * The reference agent plays every game, so the states measured are exactly the
 * states the dataset was drawn from. The candidate only observes. A run seed
 * outside the training run's therefore makes this a held-out reading.
 *
 * `uniformRandomAgreement` is the null it is read against: the mean of 1/options
 * over the same decisions, which is what a candidate that had learned nothing
 * at all would score. Agreement near that number means the imitation failed;
 * agreement near 1 means it succeeded and the candidate is a copy.
 */
import { actionKey, type Action, type AgentView, type PlayerAgent } from '@mtg/kernel';
import type { Decision } from '@mtg/kernel';

export interface PolicyAgreementRow {
  readonly kind: Decision['kind'];
  readonly decisions: number;
  readonly agreement: number;
  readonly meanOptions: number;
}

export interface PolicyAgreementReport {
  readonly decisions: number;
  readonly agreement: number;
  readonly uniformRandomAgreement: number;
  readonly meanOptions: number;
  readonly byKind: readonly PolicyAgreementRow[];
}

interface Tally {
  decisions: number;
  agreed: number;
  options: number;
}

export interface PolicyAgreementRecorder {
  /** Wraps the reference agent. The wrapper plays; the candidate only observes. */
  observe(reference: PlayerAgent, candidate: (view: AgentView) => Action): PlayerAgent;
  report(): PolicyAgreementReport;
}

/**
 * A decision the candidate owns: the same admission `learnedBot` applies, so a
 * decision it would delegate to its greedy fallback is never counted against it.
 */
export function candidateOwnsDecision(view: AgentView): boolean {
  return view.decision.complete && view.decision.options.length >= 2 && view.decision.kind !== 'cardName';
}

/** Collects agreement across however many games the caller plays through `observe`. */
export function createPolicyAgreementRecorder(): PolicyAgreementRecorder {
  const byKind = new Map<Decision['kind'], Tally>();
  const total: Tally = { decisions: 0, agreed: 0, options: 0 };
  let uniform = 0;
  return {
    observe(reference: PlayerAgent, candidate: (view: AgentView) => Action): PlayerAgent {
      return {
        name: reference.name,
        decide(view: AgentView): Action {
          const chosen = reference.decide(view);
          if (!candidateOwnsDecision(view)) return chosen;
          const agreed = actionKey(candidate(view)) === actionKey(chosen) ? 1 : 0;
          const tally = byKind.get(view.decision.kind) ?? { decisions: 0, agreed: 0, options: 0 };
          tally.decisions += 1;
          tally.agreed += agreed;
          tally.options += view.decision.options.length;
          byKind.set(view.decision.kind, tally);
          total.decisions += 1;
          total.agreed += agreed;
          total.options += view.decision.options.length;
          uniform += 1 / view.decision.options.length;
          return chosen;
        },
      };
    },
    report(): PolicyAgreementReport {
      if (total.decisions === 0) throw new Error('policy agreement observed no candidate-owned decision');
      return {
        decisions: total.decisions,
        agreement: total.agreed / total.decisions,
        uniformRandomAgreement: uniform / total.decisions,
        meanOptions: total.options / total.decisions,
        byKind: [...byKind.entries()]
          .map(([kind, tally]) => ({
            kind,
            decisions: tally.decisions,
            agreement: tally.agreed / tally.decisions,
            meanOptions: tally.options / tally.decisions,
          }))
          .toSorted((left, right) => right.decisions - left.decisions || (left.kind < right.kind ? -1 : 1)),
      };
    },
  };
}
