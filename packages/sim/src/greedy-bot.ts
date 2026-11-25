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
import { isCastable, spellEffectsFor } from '@mtg/dsl';
import { controllerOf, getObject, playerOf, powerOf, satisfyMustBeBlocked, toughnessOf } from '@mtg/kernel';
import type { Action, AgentView, PlayerAgent } from '@mtg/kernel';
import type { GreedyBotConfig } from './config';
import { DEFAULT_GREEDY_CONFIG } from './config';
import { chooseActivation } from './policies/activate';
import { bestTargetingPerCard, chooseCast } from './policies/cast';
import { chooseLandDrop } from './policies/land';
import { chooseAttackers } from './policies/attack';
import { chooseBlocks } from './policies/block';
import { chooseLegendToKeep } from './policies/legend';
import { chooseBlockerOrder, chooseDiscards } from './policies/misc';
import { chooseMulligan } from './policies/mulligan';
import { choosePermanentToSacrifice } from './policies/sacrifice';
import { chooseSpellTargets } from './policies/spell-targets';
import { chooseSearchLibrary, chooseScry } from './policies/library';
import { answerMay, answerOptionalTrigger, answerUnless, chooseTriggerTargets } from './policies/trigger';
import { boardCreatureValue } from './evaluate';

type PlayLandAction = Extract<Action, { type: 'playLand' }>;

function exchangeControlChoice(view: AgentView, config: GreedyBotConfig): Action | null {
  if (view.decision.kind !== 'pluralTargets') return null;
  const pending = view.state.pendingPluralTargets;
  if (pending?.origin !== 'cast') return null;
  const physical = getObject(view.state, pending.oid);
  const free = pending.castingCost === 'withoutMana' ? view.state.pendingFreeCast : undefined;
  const card = free?.oid === pending.oid ? (free.card ?? physical.card) : physical.card;
  if (!isCastable(card)) return null;
  const effect = spellEffectsFor(card, pending.mode ?? null, 'ordinary')[view.decision.effectIndex];
  if (effect?.kind !== 'exchangeControl') return null;

  const candidates = view.decision.options.filter(
    (
      action,
    ): action is Extract<Action, { type: 'choosePluralTarget' }> & {
      readonly target: { readonly kind: 'permanent'; readonly oid: string };
    } => action.type === 'choosePluralTarget' && action.target?.kind === 'permanent',
  );
  const first = view.decision.selected[0];
  const wantMine = first?.kind === 'permanent' ? controllerOf(view.state, first.oid) !== view.player : true;
  const useful = candidates.filter(
    (action) => (controllerOf(view.state, action.target.oid) === view.player) === wantMine,
  );
  if (useful.length === 0) return null;
  return useful.reduce((best, action) => {
    const value = boardCreatureValue(config.cast, view.state, action.target.oid);
    const bestValue = boardCreatureValue(config.cast, view.state, best.target.oid);
    return wantMine ? (value < bestValue ? action : best) : value > bestValue ? action : best;
  });
}

function choosePluralTarget(view: AgentView, config: GreedyBotConfig): Action {
  const exchange = exchangeControlChoice(view, config);
  if (exchange !== null) return exchange;
  const finish = view.decision.options.find(
    (action) => action.type === 'choosePluralTarget' && action.target === null,
  );
  if (view.decision.kind === 'pluralTargets' && view.decision.selected.length > 0 && finish !== undefined) {
    return finish;
  }
  const useful = view.decision.options.find((action) => {
    if (action.type !== 'choosePluralTarget' || action.target === null) return false;
    if (action.target.kind === 'player') return action.target.player !== view.player;
    if (action.target.kind === 'spell') return true;
    return controllerOf(view.state, action.target.oid) !== view.player;
  });
  const chosen = useful ?? finish ?? view.decision.options[0];
  if (chosen === undefined) throw new Error('greedy bot: plural target choice offered no option');
  return chosen;
}

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
 * The block declaration, kept legal when the kernel is asking for one in stages.
 *
 * `chooseBlocks` and `satisfyMustBeBlocked` construct a whole declaration out of
 * the board, which is the documented way to answer this decision: the kernel
 * validates a constructed declaration as hard as an enumerated one, so the
 * capped enumeration can be ignored. That holds only while the declaration is
 * one question. When the option product does not fit under the cap the kernel
 * asks the same declaration one blocker at a time (`blockerDecision`), records
 * the answered prefix in `combat.blocksSettled`, and from then on refuses any
 * answer that drops a block already standing -- "o11 is already blocking and
 * cannot be taken back". A freshly constructed declaration knows nothing about
 * that prefix, so mid-sequence it is illegal whenever the policy changes its
 * mind about an answered blocker, and the game dies.
 *
 * So the constructed declaration is the answer only off-sequence. Mid-sequence
 * the offered options already carry the standing prefix and are legal by
 * construction, and this picks the one nearest what the policy wanted: most of
 * the intended pairs, then fewest pairs it did not intend, then the kernel's own
 * order, which keeps the choice deterministic.
 *
 * Found by the exploring agent rather than reasoned about: greedy self-play
 * reaches these staged positions too, but greedy answers them consistently, so
 * the disagreement needs a deviation to show. Game
 * `native-action-q/train/outcome-v1:241` is the one that failed.
 */
function decideBlocks(view: AgentView, config: GreedyBotConfig): Action {
  const me = view.player;
  const state = view.state;
  if (view.decision.kind !== 'declareBlockers') throw new Error('greedy bot: not a block declaration');
  const intended =
    state.combat.blockDeclarationAuthority === me
      ? satisfyMustBeBlocked(state, [])
      : chooseBlocks(state, me, view.decision.attackers, view.decision.eligible, config);
  if (state.combat.blocksSettled === undefined) {
    return { type: 'declareBlockers', player: me, blocks: intended };
  }
  const wanted = new Set(intended.map((block) => `${block.blocker}>${block.attacker}`));
  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const option of view.decision.options) {
    if (option.type !== 'declareBlockers') continue;
    let kept = 0;
    for (const block of option.blocks) {
      if (wanted.has(`${block.blocker}>${block.attacker}`)) kept += 1;
    }
    const score = kept * 2 - option.blocks.length;
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }
  if (best === null) throw new Error('greedy bot: a staged block declaration offered no legal option');
  return best;
}

/**
 * The attack declaration, kept legal when the kernel is asking for one in stages.
 *
 * The same staging as `decideBlocks` above, one creature at a time with the
 * answered prefix in `combat.attacksSettled`, and the same failure: a freshly
 * constructed declaration that leaves out an attacker already declared is
 * refused with "o21 is already attacking and cannot be taken back". Greedy in
 * both seats answers every stage the same way and never shows it; the first
 * combat-only rollout pilot on the flagship set died on it within twenty
 * games, because a rollout that departed from greedy at one stage handed the
 * next stage back to greedy.
 *
 * Off-sequence the constructed declaration is still the answer. Mid-sequence
 * this picks the offered option nearest the intended one: most intended
 * attacker-defender pairs, then fewest unintended ones, then kernel order.
 */
function decideAttacks(view: AgentView, config: GreedyBotConfig): Action {
  const me = view.player;
  const state = view.state;
  if (view.decision.kind !== 'declareAttackers') throw new Error('greedy bot: not an attack declaration');
  const intended = chooseAttackers(state, me, view.decision.eligible, config, view.decision.defenders);
  if (state.combat.attacksSettled === undefined) {
    return { type: 'declareAttackers', player: me, attackers: intended };
  }
  const wanted = new Set(intended.map((attack) => `${attack.oid}>${JSON.stringify(attack.defender)}`));
  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const option of view.decision.options) {
    if (option.type !== 'declareAttackers') continue;
    let kept = 0;
    for (const attack of option.attackers) {
      if (wanted.has(`${attack.oid}>${JSON.stringify(attack.defender)}`)) kept += 1;
    }
    const score = kept * 2 - option.attackers.length;
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }
  if (best === null) throw new Error('greedy bot: a staged attack declaration offered no legal option');
  return best;
}

/**
 * Dispatches one decision. Mana abilities are never activated on their own: the
 * kernel auto-taps for a cast, so activating them by hand can only strand mana.
 */
export function decideGreedy(view: AgentView, config: GreedyBotConfig): Action {
  const state = view.state;
  const me = view.player;
  switch (view.decision.kind) {
    case 'cardName': {
      const name = Object.values(state.objects)
        .filter((object) => object.owner === me && !object.token)
        .map((object) => object.card.name)
        .sort((left, right) => left.localeCompare(right))[0];
      return { type: 'chooseCardName', player: me, name: name ?? 'Black Lotus' };
    }
    case 'namedZoneExile': {
      const chosen = view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: named-zone exile offered no legal option');
      return chosen;
    }
    case 'priority':
      return decidePriority(view, config);
    case 'manaColor': {
      const chosen = view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: mana-color choice offered no option');
      return chosen;
    }
    case 'freeCast': {
      const candidates = bestTargetingPerCard(view, config);
      const chosen = candidates.reduce(
        (best, candidate) => (best === null || candidate.value > best.value ? candidate : best),
        null as (typeof candidates)[number] | null,
      );
      const fallback = view.decision.options[0];
      if (chosen !== null) return chosen.action;
      if (fallback === undefined) throw new Error('greedy bot: free cast offered no legal option');
      return fallback;
    }
    case 'revealedHandChoice': {
      const chosen =
        view.decision.options.find(
          (action) => action.type === 'chooseFromRevealedHand' && action.chosen !== null,
        ) ?? view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: revealed-hand choice offered no legal option');
      return chosen;
    }
    case 'spellTargets':
      return chooseSpellTargets(view, config, view.decision);
    case 'damagePrevention': {
      const chosen = view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: prevention allocation offered no legal option');
      return chosen;
    }
    case 'declareAttackers':
      return decideAttacks(view, config);
    case 'declareBlockers':
      return decideBlocks(view, config);
    case 'orderBlockers':
      return {
        type: 'orderBlockers',
        player: me,
        orders: chooseBlockerOrder(state, view.decision.blocks),
      };
    case 'orderAttackers':
      return {
        type: 'orderAttackers',
        player: me,
        orders: view.decision.blocks.map((block) => ({
          blocker: block.blocker,
          attackers: block.attackers,
        })),
      };
    case 'discard':
      return {
        type: 'discard',
        player: me,
        oids: chooseDiscards(state, me, view.decision.hand, view.decision.count, config.discard),
      };
    case 'mulligan':
      return chooseMulligan(state, view.decision, config);
    case 'openingHandAction': {
      const chosen = view.decision.options.find(
        (action) => action.type === 'chooseOpeningHandAction' && action.oid !== null,
      );
      return chosen ?? { type: 'chooseOpeningHandAction', player: me, oid: null };
    }
    case 'triggerTargets':
      return chooseTriggerTargets(view, config, view.decision);
    case 'pluralTargets':
      return choosePluralTarget(view, config);
    case 'damageAllocation': {
      const chosen = view.decision.options.at(-1);
      if (chosen === undefined) throw new Error('greedy bot: damage allocation offered no option');
      return chosen;
    }
    case 'optionalTrigger':
      return answerOptionalTrigger(view, config, view.decision);
    case 'may':
      return answerMay(view, config, view.decision);
    case 'unless':
      return answerUnless(view, config, view.decision);
    case 'legendRule':
      return chooseLegendToKeep(view, config, view.decision);
    case 'entryCopy': {
      const choices = view.decision.options.filter(
        (action): action is Extract<Action, { type: 'chooseEntryCopy' }> =>
          action.type === 'chooseEntryCopy' && action.copyOf !== null,
      );
      let chosen: Extract<Action, { type: 'chooseEntryCopy' }> | null = null;
      for (const action of choices) {
        if (action.copyOf === null) continue;
        if (chosen === null || chosen.copyOf === null) {
          chosen = action;
          continue;
        }
        const value = powerOf(state, action.copyOf) + toughnessOf(state, action.copyOf);
        const bestValue = powerOf(state, chosen.copyOf) + toughnessOf(state, chosen.copyOf);
        if (value > bestValue) chosen = action;
      }
      return chosen ?? { type: 'chooseEntryCopy', player: me, oid: view.decision.oid, copyOf: null };
    }
    case 'entryCounter': {
      const chosen = view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: entry counter choice offered no legal option');
      return chosen;
    }
    case 'entryOptionalCounter': {
      const accepted = view.decision.options.find(
        (action) => action.type === 'chooseEntryOptionalCounter' && action.accept,
      );
      if (accepted === undefined) throw new Error('greedy bot: optional entry counter offered no accept');
      return accepted;
    }
    case 'entryPayLife': {
      const alreadyTapped = view.state.pendingEntryPayLifeChoice?.entry.tapped === true;
      const paid = view.decision.options.find(
        (action) =>
          action.type === 'chooseEntryPayLife' &&
          action.pay &&
          !alreadyTapped &&
          playerOf(view.state, view.player).life > action.life,
      );
      const declined = view.decision.options.find(
        (action) => action.type === 'chooseEntryPayLife' && !action.pay,
      );
      const chosen = paid ?? declined;
      if (chosen === undefined) throw new Error('greedy bot: entry life payment offered no option');
      return chosen;
    }
    case 'entryAura':
    case 'entryTimestampOrder': {
      const chosen = view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: entry choice offered no legal option');
      return chosen;
    }
    case 'entryPlayer': {
      const opponent = view.decision.options.find(
        (action) => action.type === 'chooseEntryPlayer' && action.chosen !== me,
      );
      if (opponent === undefined) throw new Error('greedy bot: entry player choice offered no opponent');
      return opponent;
    }
    case 'entryColors': {
      const chosen = view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: entry color choice offered no option');
      return chosen;
    }
    case 'entryCharacteristics': {
      const modes = view.decision.modes;
      const chosen = [...view.decision.options].sort((left, right) => {
        if (left.type !== 'chooseEntryCharacteristics' || right.type !== 'chooseEntryCharacteristics')
          return 0;
        const leftMode = modes[left.mode];
        const rightMode = modes[right.mode];
        const value = (mode: (typeof modes)[number] | undefined): number =>
          mode === undefined
            ? 0
            : mode.power +
              mode.toughness +
              (mode.addKeywords?.length ?? 0) +
              (mode.addKeywordAbilities?.length ?? 0) +
              (mode.addSubtypes?.length ?? 0);
        return value(rightMode) - value(leftMode);
      })[0];
      if (chosen === undefined) throw new Error('greedy bot: entry characteristic choice offered no option');
      return chosen;
    }
    case 'scry': {
      return chooseScry(view, config);
    }
    case 'searchLibrary': {
      return chooseSearchLibrary(view, config);
    }
    case 'searchDestination': {
      const chosen = view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: search destination offered no legal option');
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
    case 'battlefieldChoice': {
      const chosen = view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: battlefield choice offered no legal option');
      return chosen;
    }
    case 'populate': {
      const chosen = view.decision.options
        .filter((option) => option.type === 'choosePopulateToken')
        .sort(
          (left, right) =>
            powerOf(state, right.token) +
            toughnessOf(state, right.token) -
            powerOf(state, left.token) -
            toughnessOf(state, left.token),
        )[0];
      if (chosen === undefined) throw new Error('greedy bot: Populate offered no legal token');
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
      return choosePermanentToSacrifice(view, config, view.decision);
    case 'permanentUntap': {
      const useful = view.decision.options.find(
        (action) =>
          action.type === 'choosePermanentToUntap' &&
          action.oid !== null &&
          controllerOf(state, action.oid) === me &&
          state.objects[action.oid]?.tapped === true,
      );
      const finish = view.decision.options.find(
        (action) => action.type === 'choosePermanentToUntap' && action.oid === null,
      );
      const chosen = useful ?? finish;
      if (chosen === undefined) throw new Error('greedy bot: permanent untap offered no legal option');
      return chosen;
    }
    case 'topLibraryOrder':
    case 'topLibrarySelect':
    case 'topLibraryPartition':
    case 'topLibraryPile': {
      const chosen = view.decision.options[0];
      if (chosen === undefined) throw new Error('greedy bot: top-library decision offered no legal option');
      return chosen;
    }
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
