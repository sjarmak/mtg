/**
 * The tier-1 greedy bot: one dispatcher over the kernel's sixteen decision kinds.
 *
 * It holds no rules knowledge. Every decision is either picked from the
 * kernel's enumerated options (priority, a trigger's targets, a trigger's "you
 * may", the legend rule) or constructed and handed back for `validateAction` to
 * re-check
 * (attacks, blocks, ordering, discards, the opening hand) — the
 * kernel's documented guarantee that a constructed declaration is checked as
 * hard as an enumerated one is what lets the combat policies ignore the capped
 * enumeration entirely.
 *
 * Shape follows the Forge decomposition (`docs/research/prior-art-mtg-ai.md`
 * §2.1): per-decision policies, shared evaluators, combat solved separately
 * from casting, all tuning in a profile object.
 *
 * One profile reaches the policies: `GreedyBotConfig`, whose `race` section
 * carries the global "who is winning" term the attack, block and removal
 * policies read on top of their local arithmetic. It is a single object on
 * purpose — it is what a `BotSpec` carries across the worker boundary, so a
 * profile a caller sets is the profile every thread plays.
 */
import type { Action, AgentView, PlayerAgent } from '@mtg/kernel';
import type { GreedyBotConfig } from './config';
import { DEFAULT_GREEDY_CONFIG } from './config';
import { chooseActivation } from './policies/activate';
import { chooseCast } from './policies/cast';
import { chooseLandDrop } from './policies/land';
import { chooseAttackers } from './policies/attack';
import { chooseBlocks } from './policies/block';
import { chooseLegendToKeep } from './policies/legend';
import { chooseBlockerOrder, chooseDiscards } from './policies/misc';
import { chooseMulligan } from './policies/mulligan';
import { chooseCreatureToSacrifice } from './policies/sacrifice';
import { answerMay, answerOptionalTrigger, answerUnless, chooseTriggerTargets } from './policies/trigger';

type PlayLandAction = Extract<Action, { type: 'playLand' }>;

function decidePriority(view: AgentView, config: GreedyBotConfig): Action {
  const lands: PlayLandAction[] = [];
  for (const option of view.decision.options) {
    if (option.type === 'playLand') lands.push(option);
  }
  const land = chooseLandDrop(view.state, view.player, lands, config.land);
  if (land !== null) return land;

  const cast = chooseCast(view, config);
  if (cast !== null) return cast;

  // After casting, never instead of it: the mana an activation spends is mana
  // `chooseCast` has already declined to use this window.
  const activation = chooseActivation(view, config);
  if (activation !== null) return activation;

  return { type: 'passPriority', player: view.player };
}

/**
 * Dispatches one decision. Mana abilities are never activated on their own: the
 * kernel auto-taps for a cast, so activating them by hand can only strand mana.
 */
export function decideGreedy(view: AgentView, config: GreedyBotConfig): Action {
  const state = view.state;
  const me = view.player;
  switch (view.decision.kind) {
    case 'priority':
      return decidePriority(view, config);
    case 'declareAttackers':
      return {
        type: 'declareAttackers',
        player: me,
        attackers: chooseAttackers(state, me, view.decision.eligible, config, view.decision.defenders),
      };
    case 'declareBlockers':
      return {
        type: 'declareBlockers',
        player: me,
        blocks: chooseBlocks(state, me, view.decision.attackers, view.decision.eligible, config),
      };
    case 'orderBlockers':
      return {
        type: 'orderBlockers',
        player: me,
        orders: chooseBlockerOrder(state, view.decision.blocks),
      };
    case 'discard':
      return {
        type: 'discard',
        player: me,
        oids: chooseDiscards(state, me, view.decision.hand, view.decision.count, config.discard),
      };
    case 'mulligan':
      return chooseMulligan(state, view.decision, config);
    case 'triggerTargets':
      return chooseTriggerTargets(view, config, view.decision);
    case 'optionalTrigger':
      return answerOptionalTrigger(view, config, view.decision);
    case 'may':
      return answerMay(view, config, view.decision);
    case 'unless':
      return answerUnless(view, config, view.decision);
    case 'legendRule':
      return chooseLegendToKeep(view, config, view.decision);
    case 'scry': {
      const unchanged = view.decision.options.find(
        (action) => action.type === 'scry' && action.bottom.length === 0,
      );
      if (unchanged === undefined) throw new Error('greedy bot: scry offered no legal option');
      return unchanged;
    }
    case 'searchLibrary': {
      // Take a card when the filter found one. A greedy bot that failed to find
      // would read every tutor in a set as a blank, and this package's whole
      // job is measuring what a set's cards do — a blank measured as balance is
      // the failure, not a conservative default. Which card is the first the
      // decision offers, which is library order after a seeded shuffle;
      // ranking the matches is a card-quality judgment and `@mtg/deckbuild`'s
      // evaluator is where that lives.
      const taken = view.decision.options.find(
        (action) => action.type === 'searchLibrary' && action.found !== null,
      );
      const fallback = view.decision.options[0];
      const chosen = taken ?? fallback;
      if (chosen === undefined) throw new Error('greedy bot: search offered no legal option');
      return chosen;
    }
    case 'graveyardChoice': {
      // The search arm's policy, for the search arm's reason: a bot that took
      // nothing would measure every recursion spell in a set as a blank. The
      // ranking question is the same one and has the same answer — which card
      // is worth taking back is card quality, and that judgment lives in
      // `@mtg/deckbuild` rather than in a simulation driver.
      const taken = view.decision.options.find(
        (action) => action.type === 'chooseFromGraveyard' && action.chosen !== null,
      );
      const fallback = view.decision.options[0];
      const chosen = taken ?? fallback;
      if (chosen === undefined) throw new Error('greedy bot: graveyard choice offered no legal option');
      return chosen;
    }
    case 'handDiscard': {
      const decision = view.decision;
      // One ranking, read from both ends. `chooseDiscards` over the whole hand
      // is the keep-value order ascending, so the cheapest cards are at the
      // front and the best at the back: pitching its own hand this bot takes
      // the front, choosing an opponent's it takes the back. Same policy, same
      // config, opposite end — which is the honest way to say that "which card
      // do I least want" and "which card do they most want" are one question
      // asked from two seats.
      //
      // The valuation is run as `decision.owner` rather than as this seat, so
      // an opponent's hand is judged against the mana *they* can reach. Scoring
      // their cards against this bot's board would price a card they cannot
      // cast as one they can.
      const ranked = chooseDiscards(
        state,
        decision.owner,
        decision.hand,
        decision.hand.length,
        config.discard,
      );
      const picked = new Set(
        decision.owner === me ? ranked.slice(0, decision.count) : ranked.slice(-decision.count),
      );
      // Named back in hand order, which is not cosmetic: `selectionAnswers`
      // enumerates each combination in hand order and `canonicalAction` does
      // not sort this action, so a set spelled in ranking order would have no
      // index in the decision and `chooseAction` would refuse it.
      return {
        type: 'chooseDiscards',
        player: me,
        oids: decision.hand.filter((oid) => picked.has(oid)),
      };
    }
    case 'permanentSacrifice':
      return chooseCreatureToSacrifice(view, config, view.decision);
  }
}

/** A tier-1 greedy bot bound to a heuristic profile. */
export function greedyBot(name: string, config: GreedyBotConfig = DEFAULT_GREEDY_CONFIG): PlayerAgent {
  return {
    name,
    decide(view: AgentView): Action {
      return decideGreedy(view, config);
    },
  };
}
