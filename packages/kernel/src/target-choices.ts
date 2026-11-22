/**
 * What each target slot of an object may be aimed at, right now.
 *
 * One module because four callers ask the same question at four different
 * moments and must get the same answer: a spell being cast (CR 601.2c), an
 * activated ability being paid for (CR 601.2c again, through CR 602.2b), an
 * equip ability choosing the creature it will attach to (CR 702.6b), and a
 * triggered ability being put on the stack (CR 603.3d). The rules differ about
 * *when* the choice is made and about nothing else, so the spaces are computed
 * in one place and the three enumerations differ only in which effect list they
 * hand over.
 *
 * Nothing here decides whether a choice is *good*, and nothing here knows which
 * kind of object it is looking at. `legal.ts` turns these spaces into actions,
 * `effects.ts` rechecks a chosen target on resolution, and the bots score them.
 */
import type { ActivatedAbility, Card, Effect, TargetRestriction } from '@mtg/dsl';
import {
  assertNever,
  effectsFor,
  effectsForActivatedAbility,
  hasTarget,
  isMultipleTargetSpec,
  isTargetedFight,
  isAttachingAbility,
  isAuraCard,
  isSpellTargetEffect,
  targetFilterOf,
  targetRestrictionOf,
} from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import type { ProtectionSource } from './keyword-abilities';
import { opponentOf } from './ids';
import type { GameState, Target } from './state';
import { characteristicsOf, controllerOf, hasCardType } from './layers';
import { creaturesControlledBy, creaturesOnBattlefield, tryObject } from './zones';
import { canBeTargetedBy, canPlayerBeTargetedBy } from './keyword-abilities';
import { satisfiesTargetRestriction } from './target-restrictions';
import { graveyardCardSatisfiesFilter, satisfiesTargetFilter, spellSatisfiesFilter } from './target-filter';
import { isLegalAuraHost } from './attach';
import { graveyardMembers } from './zone-filter';
import { canGraveyardCardsBeTargeted } from './game-rules';

/** Both seats, narrowed by live player-target restrictions for this controller. */
function targetablePlayers(
  state: GameState,
  controller: PlayerId,
  restriction: TargetRestriction | null = null,
): readonly Target[] {
  return [controller, opponentOf(controller)]
    .filter((player) => canPlayerBeTargetedBy(state, player, controller))
    .filter((player) => restriction === null || satisfiesTargetRestriction(state, player, restriction))
    .map((player): Target => ({ kind: 'player', player }));
}

type OpponentPermanentTargetKind =
  'targetCreatureOpponentControls' | 'targetNonlandPermanentOpponentControls';

/** The opponent-controlled permanent spaces shared by singular and plural Detain slots. */
function opponentPermanentCandidates(
  state: GameState,
  kind: OpponentPermanentTargetKind,
  controller: PlayerId,
  source?: ProtectionSource,
): readonly Target[] {
  const candidates =
    kind === 'targetCreatureOpponentControls'
      ? creaturesControlledBy(state, opponentOf(controller)).map((object) => object.oid)
      : state.battlefield
          .filter((oid) => controllerOf(state, oid) === opponentOf(controller))
          .filter((oid) => !hasCardType(state, oid, 'land'));
  return candidates
    .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
    .map((oid): Target => ({ kind: 'permanent', oid }));
}

/**
 * Targets legal for each effect in a list, parallel to it.
 *
 * Written over an effect list rather than over a card because an activated
 * ability chooses targets from exactly the same spaces a spell does (CR
 * 601.2c), off the same board, at the same priority window, and a triggered
 * ability chooses from them too, one moment earlier in its own life (CR
 * 603.3d). One function means a spell, an activation and a trigger cannot come
 * to different conclusions about where `destroyPermanent` may point, which is
 * the property that lets `activationOptions` and `triggerTargetOptions` reuse
 * `castOptions`' shape verbatim.
 */
export function targetChoicesForEffects(
  state: GameState,
  effects: readonly Effect[],
  controller: PlayerId,
  source?: ProtectionSource,
): readonly (readonly (Target | null)[])[] {
  return effects.map((effect) => {
    const restriction = hasTarget(effect) ? targetRestrictionOf(effect.target) : null;
    const filter = hasTarget(effect) ? targetFilterOf(effect.target) : null;
    const excludedSource =
      hasTarget(effect) && effect.target.excludeSource === true && typeof source === 'string' ? source : null;
    const excludedName = effect.kind === 'exileTarget' ? (effect.sameNameCohort?.excludedName ?? null) : null;
    // Applied to the assembled space rather than inside each branch: every
    // branch that can produce a creature produces it the same way, and a filter
    // per branch is four chances to forget one. A slot with no restriction and
    // no filter gets the identity, so nothing that existed before this change
    // moves.
    //
    // The two narrowings are one pass rather than two because they are one
    // question — CR 601.2c chooses a target that answers everything the spell
    // printed, and CR 608.2b rechecks all of it — and `isTargetStillLegal`
    // applies the same pair in the same order at the other end.
    const narrow = (targets: readonly (Target | null)[]): readonly (Target | null)[] =>
      restriction === null && filter === null && excludedSource === null && excludedName === null
        ? targets
        : targets.filter(
            (target) =>
              target === null ||
              (target.kind === 'player'
                ? restriction === null || satisfiesTargetRestriction(state, target.player, restriction)
                : target.kind !== 'permanent' ||
                  (target.oid !== excludedSource &&
                    (excludedName === null || characteristicsOf(state, target.oid).name !== excludedName) &&
                    (restriction === null || satisfiesTargetRestriction(state, target.oid, restriction)) &&
                    (filter === null || satisfiesTargetFilter(state, target.oid, filter)))),
          );
    if (isSpellTargetEffect(effect)) {
      // "Counter target spell" is what the card says, and a triggered ability
      // is not a spell (CR 113.7a). Offering one would be a card whose text and
      // behavior disagree, which is the failure this vocabulary exists to stop.
      //
      // `spellFilter` narrows *which* spell, and it is read here rather than
      // through `narrow` above because this branch produces `spell` targets and
      // that one refuses everything that is not a permanent: a spell on the
      // stack is not on the battlefield and has no entry in the layer walk, so
      // the two spaces are answered by two functions on purpose.
      const spellFilter = effect.spellFilter;
      return state.stack
        .filter((entry) => entry.ability === null)
        .filter((entry) =>
          effect.kind === 'counterSpell' &&
          'spellSelection' in effect &&
          effect.spellSelection === 'targetSpellYouDontControl'
            ? entry.controller !== controller
            : effect.kind === 'copySpell' && effect.spellSelection === 'targetSpellYouControl'
              ? entry.controller === controller
              : true,
        )
        .filter((entry) => spellFilter === undefined || spellSatisfiesFilter(state, entry.oid, spellFilter))
        .map((entry): Target => ({ kind: 'spell', oid: entry.oid }));
    }
    // Every effect that carries no `TargetSpec` at all aims at nobody, and this
    // reads that off the shape rather than off a list of kind names.
    // `counterSpell` is already returned above because it is the one effect
    // that chooses without a spec (`effectChoosesTarget`'s docblock, `@mtg/dsl`),
    // so what reaches here without a `target` field genuinely has no slot: a
    // token creation, a scry, a mana ability (CR 605.1a: it chooses nothing and
    // the color is chosen on the activation, not here), a shuffle, a reveal, a
    // graveyard exile, a search.
    // A `||` chain of kind names would have to grow with the vocabulary and
    // fails silently when it does not — the missing kind falls into the switch
    // below and reads `.target` off an effect that has none.
    if (!hasTarget(effect)) return [null];
    if (isMultipleTargetSpec(effect.target) || isTargetedFight(effect)) {
      // A plural target slot (`count` or `anyNumber`)
      // is chosen through `Action.multiTargets`, a side channel parallel to
      // this per-slot `Target | null` enumeration — see `StackEntry
      // .multiTargets`' docblock for why it stayed a side channel instead of
      // widening `Target` itself. This function only answers what a single
      // `targets[i]` slot may hold, and "no single target" is the only
      // correct answer for a plural slot regardless of how many candidates
      // are on the board: returning the individual creature list here would
      // make castability depend on there being at least one legal creature,
      // defeating the "up to" wording `mtg-kg44` was filed to make castable
      // with zero.
      return [null];
    }
    const creatures = creaturesOnBattlefield(state)
      .filter((object) => source === undefined || canBeTargetedBy(state, object.oid, source, controller))
      .map((object): Target => ({ kind: 'permanent', oid: object.oid }));
    const players = targetablePlayers(state, controller, restriction);
    const creatureOids = new Set(creatures.map((target) => (target?.kind === 'permanent' ? target.oid : '')));
    const planeswalkers = state.battlefield
      .filter((oid) => hasCardType(state, oid, 'planeswalker') && !creatureOids.has(oid))
      .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
      .map((oid): Target => ({ kind: 'permanent', oid }));
    const battles = state.battlefield
      .filter((oid) => hasCardType(state, oid, 'battle') && !creatureOids.has(oid))
      .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
      .map((oid): Target => ({ kind: 'permanent', oid }));
    // Read through `hasCardType` rather than off `object.card.kind`, so an
    // Equipment a layer-4 effect animated is still an artifact and a card whose
    // printed type a continuous effect changed is what it currently is. Both
    // types in one list because the printed card is one card: "target artifact
    // or enchantment" is one selector, and a permanent that is somehow both
    // appears once because `battlefield` is walked once.
    const artifactsAndEnchantments = state.battlefield
      .filter((oid) => hasCardType(state, oid, 'artifact') || hasCardType(state, oid, 'enchantment'))
      .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
      .map((oid): Target => ({ kind: 'permanent', oid }));
    switch (effect.target.kind) {
      case 'noTarget':
        return [null];
      case 'targetCreature':
        return narrow(creatures);
      case 'targetCreatureYouControl':
        // CR 601.2c chooses targets as the spell or ability is put on the
        // stack, so "you control" is read off the board at this moment and
        // rechecked at resolution by `isTargetStillLegal`. Control is the layer
        // system's answer, not the object's owner: a creature stolen this turn
        // is a creature you control and its owner's is not.
        return narrow(
          creaturesControlledBy(state, controller)
            .filter(
              (object) => source === undefined || canBeTargetedBy(state, object.oid, source, controller),
            )
            .map((object): Target => ({
              kind: 'permanent',
              oid: object.oid,
            })),
        );
      case 'targetPlayer':
        return players;
      case 'targetOpponent':
        // CR 115.4. A two-player game has exactly one opponent, so this slot
        // offers that player or nobody when a live rule such as hexproof makes
        // them illegal; it never widens the cast enumeration beyond one choice.
        return players.filter(
          (target) => target.kind === 'player' && target.player === opponentOf(controller),
        );
      case 'triggeringCreature':
        // Filled from the triggering event; it is not a CR 115 choice.
        return [];
      case 'triggeringPlayer':
        // Filled from the triggering event; it is not a CR 115 choice.
        return [];
      case 'targetCreatureDefendingPlayerControls':
        // CR 506.2's defending player, and the kernel knows who that is without
        // being told, for the reason `targetOpponent` two cases down is cheaper
        // than it looks. The DSL refuses this kind anywhere but a `selfAttacks`
        // trigger, so by construction the ability is on the stack because its
        // source is attacking; the source's controller is therefore the
        // attacking player, and in a two-player game the defending player is
        // that player's one opponent — whether the attack was declared against
        // the player or against a planeswalker, since the planeswalker's
        // controller is the same person (`combat.ts`'s `isLegalDefender`).
        // `controller` here is the entry's controller, which for a trigger is
        // CR 603.3a's "who controlled the source as it triggered", so the read
        // survives the source dying to a first-strike blocker before the
        // ability resolves.
        //
        // Retaining the defending player on `StackEntry.triggerContext` instead
        // was the alternative, and it would buy nothing here: it stores a value
        // that is already derivable and adds a second trigger-context arm that
        // the replay log schema, `planResolution` and `read-log.ts` would each
        // have to grow. It becomes the right answer the day this kernel seats
        // more than two players, and so does `targetOpponent`'s row.
        return narrow(
          creaturesControlledBy(state, opponentOf(controller))
            .filter(
              (object) => source === undefined || canBeTargetedBy(state, object.oid, source, controller),
            )
            .map((object): Target => ({ kind: 'permanent', oid: object.oid })),
        );
      case 'targetCreatureYouDontControl':
        // The exact complement of `targetCreatureYouControl`, read at the same
        // moment and rechecked the same way, and in a two-player game the
        // complement of "you control" is "the one opponent controls" — the
        // reason `targetOpponent` is one choice rather than a list. It differs
        // from `targetCreatureDefendingPlayerControls` in where it is legal
        // rather than in what it enumerates: the defending-player kind is
        // refused outside a `selfAttacks` trigger, and this one is refused
        // outside a body-source effect, so no card can print both.
        return narrow(
          creaturesControlledBy(state, opponentOf(controller))
            .filter(
              (object) => source === undefined || canBeTargetedBy(state, object.oid, source, controller),
            )
            .map((object): Target => ({ kind: 'permanent', oid: object.oid })),
        );
      case 'targetCreatureOpponentControls':
        return narrow(opponentPermanentCandidates(state, effect.target.kind, controller, source));
      case 'targetNonlandPermanentOpponentControls':
        return narrow(opponentPermanentCandidates(state, effect.target.kind, controller, source));
      case 'targetNonlandPermanentYouDontControl':
        return narrow(
          state.battlefield
            .filter((oid) => !hasCardType(state, oid, 'land'))
            .filter((oid) => controllerOf(state, oid) !== controller)
            .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
            .map((oid): Target => ({ kind: 'permanent', oid })),
        );
      case 'targetPermanentYouNeitherOwnNorControl':
        return narrow(
          state.battlefield
            .filter((oid) => controllerOf(state, oid) !== controller)
            .filter((oid) => tryObject(state, oid)?.owner !== controller)
            .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
            .map((oid): Target => ({ kind: 'permanent', oid })),
        );
      case 'targetArtifactOrEnchantment':
        // `narrow` now, where before this kind skipped it. The restriction half
        // is still inapplicable — `restrictionFitsTargetKind` refuses one on any
        // kind whose space is not the creature one — but a filter is legal here
        // (`filterFitsTargetKind` admits every object-only kind), so a slot that
        // says "target black enchantment" has to be narrowed rather than
        // silently widened back to the whole space.
        return narrow(artifactsAndEnchantments);
      case 'targetArtifactYouDontControl':
        return narrow(
          state.battlefield
            .filter((oid) => hasCardType(state, oid, 'artifact'))
            .filter((oid) => controllerOf(state, oid) !== controller)
            .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
            .map((oid): Target => ({ kind: 'permanent', oid })),
        );
      case 'targetPermanent':
        // Every permanent on the battlefield, which is the widest object space
        // this vocabulary names and the one the filter exists to cut down.
        // Assembled from `battlefield` directly rather than from the three lists
        // above: those are three overlapping selections and a union of them
        // would have to dedupe an artifact creature, which is exactly the card
        // that made this lane necessary.
        return narrow(
          state.battlefield
            .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
            .map((oid): Target => ({ kind: 'permanent', oid })),
        );
      case 'targetPlayerOrPlaneswalker':
        // Two spaces at once, the way `anyTarget` is, and no `narrow` for the
        // reason `targetPlayer` skips it: `filterFitsTargetKind` and
        // `restrictionFitsTargetKind` both refuse a slot that draws from a
        // player, so a spec reaching here carries neither.
        return effect.kind === 'dealDamage' && effect.opponentPlayerOrPlaneswalkerOnly === true
          ? [
              ...players.filter(
                (target) => target.kind === 'player' && target.player === opponentOf(controller),
              ),
              ...planeswalkers,
            ]
          : [...players, ...planeswalkers];
      case 'targetCardInYourGraveyard':
        if (!canGraveyardCardsBeTargeted(state)) return [];
        return state.players[controller].graveyard
          .filter((oid) => filter === null || graveyardCardSatisfiesFilter(state, oid, filter))
          .map((oid): Target => ({ kind: 'card', oid }));
      case 'targetCardInAGraveyard':
        if (!canGraveyardCardsBeTargeted(state)) return [];
        return graveyardMembers(state, 'each')
          .filter((oid) => filter === null || graveyardCardSatisfiesFilter(state, oid, filter))
          .map((oid): Target => ({ kind: 'card', oid }));
      case 'targetCardInOpponentsGraveyard':
        if (!canGraveyardCardsBeTargeted(state)) return [];
        return graveyardMembers(state, opponentOf(controller))
          .filter((oid) => filter === null || graveyardCardSatisfiesFilter(state, oid, filter))
          .map((oid): Target => ({ kind: 'card', oid }));
      case 'anyTarget':
        return [...players, ...creatures, ...planeswalkers, ...battles];
      case 'selfCreature':
      case 'selfPermanent':
      case 'enchantedCreature':
      case 'equippedCreature':
        // `[null]`, `noTarget`'s own placeholder, and deliberately not the `[]`
        // `triggeringCreature` returns three cases up. That kind is refused on
        // every activated ability (`checkSelfCreatureTarget`'s sibling gate has
        // no such limit here), so its empty slot never reaches
        // `targetChoicesForActivation`'s `cartesian` product — but the two
        // source-body kinds are legal there, and `cartesian` over an empty slot
        // yields zero tuples for the *whole* ability, not just this slot, which
        // would make an activated ability printing one of them un-activatable.
        // One dummy choice keeps the product non-empty; `entry.ability.sourceOid`
        // is where `planResolution` reads the real referent, so what this slot
        // holds is never read as data. `selfPermanent` (`mtg-rji`) shares the
        // arm outright: an artifact's `{2}: put a Trisigil counter on this
        // permanent` is exactly the activated shape this dummy exists for.
        return [null];
      case 'thatCreature':
      case 'thatPlayer':
      case 'thatCreaturesController':
      case 'thatPlayerOrPlaneswalkerController':
      case 'chosenPlayer':
        // `[null]` for the reason the two source-body kinds one case up return
        // it, and this is the arm the whole lane turns on (`mtg-nhyv.75`).
        // Before it, a card that printed "that creature" carried an ordinary
        // `targetCreature` slot, this function enumerated the whole creature
        // space for it, and `cartesian` paired every choice with every choice
        // the earlier slot made — so a Stabbing Pain offered four casts on a
        // two-creature board, half of them shrinking one creature and tapping
        // another, and a Chandra's Outrage offered two on a one-creature board,
        // one of them burning the caster. One dummy choice collapses the
        // product back to the single option-set the printed card has.
        //
        // Not `[]`, which is what `triggeringCreature` returns: an empty slot
        // makes `cartesian` yield zero tuples for the whole object, so a card
        // printing a back-reference would be uncastable rather than castable
        // one way. `planResolution` fills the real referent from
        // `entry.targets[referentSourceIndex(...)]`, so what this slot holds is
        // never read as data — the same contract the source-body arm has.
        return [null];
      default:
        return assertNever(effect.target.kind, 'targetChoicesForEffects');
    }
  });
}

/**
 * The individually legal generic targets for one plural slot — `[]` for an
 * effect that carries no such slot.
 *
 * Creature members receive the same restriction-and-filter narrowing as an
 * ordinary creature slot; player members are the currently targetable seats
 * the ordinary `targetPlayer` slot exposes. Separate from
 * `targetChoicesForEffects` because
 * that function's contract is
 * one `Target | null` per slot and a plural slot's own answer to that
 * question is always `[null]` (see its inline comment there) — the list of
 * *candidates* the side-channel choice draws from is a different question,
 * asked only by `castOptions` when it builds `Action.multiTargets`
 * combinations.
 */
export function multipleTargetCandidates(
  state: GameState,
  effect: Effect,
  controller: PlayerId,
  source?: ProtectionSource,
  position = 0,
): readonly Target[] {
  if (isTargetedFight(effect)) {
    const targetController = position === 0 ? controller : opponentOf(controller);
    return creaturesControlledBy(state, targetController)
      .filter((object) => source === undefined || canBeTargetedBy(state, object.oid, source, controller))
      .map((object): Target => ({ kind: 'permanent', oid: object.oid }));
  }
  if (!hasTarget(effect) || !isMultipleTargetSpec(effect.target)) return [];
  if (effect.kind === 'exileTarget' && effect.creatureBattlefieldOrGraveyard === true) {
    const battlefield = creaturesOnBattlefield(state)
      .filter((object) => object.oid !== source)
      .filter((object) => source === undefined || canBeTargetedBy(state, object.oid, source, controller))
      .map((object): Target => ({ kind: 'permanent', oid: object.oid }));
    const graveyards = canGraveyardCardsBeTargeted(state)
      ? graveyardMembers(state, 'each')
          .filter((oid) => graveyardCardSatisfiesFilter(state, oid, effect.target.filter!))
          .map((oid): Target => ({ kind: 'card', oid }))
      : [];
    return [...battlefield, ...graveyards];
  }
  if (effect.target.kind === 'targetPlayer') {
    return targetablePlayers(state, controller, targetRestrictionOf(effect.target));
  }
  if (effect.target.kind === 'anyTarget') {
    const creatures = creaturesOnBattlefield(state)
      .filter((object) => source === undefined || canBeTargetedBy(state, object.oid, source, controller))
      .map((object): Target => ({ kind: 'permanent', oid: object.oid }));
    const creatureOids = new Set(creatures.map((target) => (target.kind === 'permanent' ? target.oid : '')));
    const planeswalkers = state.battlefield
      .filter((oid) => hasCardType(state, oid, 'planeswalker') && !creatureOids.has(oid))
      .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
      .map((oid): Target => ({ kind: 'permanent', oid }));
    const battles = state.battlefield
      .filter((oid) => hasCardType(state, oid, 'battle') && !creatureOids.has(oid))
      .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
      .map((oid): Target => ({ kind: 'permanent', oid }));
    return [...targetablePlayers(state, controller), ...creatures, ...planeswalkers, ...battles];
  }
  if (effect.target.kind === 'targetCreatureOpponentControls') {
    return opponentPermanentCandidates(state, effect.target.kind, controller, source);
  }
  if (effect.target.kind === 'targetNonlandPermanentOpponentControls') {
    return opponentPermanentCandidates(state, effect.target.kind, controller, source);
  }
  if (effect.target.kind === 'targetNonlandPermanentYouDontControl') {
    return state.battlefield
      .filter((oid) => !hasCardType(state, oid, 'land'))
      .filter((oid) => controllerOf(state, oid) !== controller)
      .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
      .map((oid): Target => ({ kind: 'permanent', oid }));
  }
  if (effect.target.kind === 'targetPermanentYouNeitherOwnNorControl') {
    return state.battlefield
      .filter((oid) => controllerOf(state, oid) !== controller)
      .filter((oid) => tryObject(state, oid)?.owner !== controller)
      .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
      .map((oid): Target => ({ kind: 'permanent', oid }));
  }
  if (effect.target.kind === 'targetArtifactYouDontControl') {
    return state.battlefield
      .filter((oid) => hasCardType(state, oid, 'artifact'))
      .filter((oid) => controllerOf(state, oid) !== controller)
      .filter((oid) => source === undefined || canBeTargetedBy(state, oid, source, controller))
      .map((oid): Target => ({ kind: 'permanent', oid }));
  }
  if (effect.target.kind !== 'targetCreature') return [];
  const restriction = targetRestrictionOf(effect.target);
  const filter = targetFilterOf(effect.target);
  return creaturesOnBattlefield(state)
    .filter((object) => source === undefined || canBeTargetedBy(state, object.oid, source, controller))
    .filter(
      (object) =>
        (restriction === null || satisfiesTargetRestriction(state, object.oid, restriction)) &&
        (filter === null || satisfiesTargetFilter(state, object.oid, filter)),
    )
    .map((object): Target => ({ kind: 'permanent', oid: object.oid }));
}

/**
 * The target slots one activation chooses from.
 *
 * An ordinary ability chooses one per printed effect, which is what the action
 * carries and what `validateActivation` rechecks. An equip ability prints no
 * effect at all and chooses exactly one target anyway (CR 702.6b), so no
 * `TargetSpec` on it says where from and this function is where the space is
 * decided. `targetCreatureYouControl` draws from the same space and does not
 * replace this: it is a mode an *effect* names, and an equip ability has no
 * effect to name it on.
 */
export function targetChoicesForActivation(
  state: GameState,
  ability: ActivatedAbility,
  controller: PlayerId,
  sourceOid?: ObjectId,
  mode: number | null = null,
): readonly (readonly (Target | null)[])[] {
  if (!isAttachingAbility(ability)) {
    return targetChoicesForEffects(state, effectsForActivatedAbility(ability, mode), controller, sourceOid);
  }
  return [
    creaturesControlledBy(state, controller)
      .filter(
        (object) => sourceOid === undefined || canBeTargetedBy(state, object.oid, sourceOid, controller),
      )
      .map((object): Target => ({
        kind: 'permanent',
        oid: object.oid,
      })),
  ];
}

/**
 * Targets legal for each effect of a card being cast, parallel to `effects`.
 *
 * A modal card (CR 700.2) throws here rather than answering, and that is the
 * whole of the mode handling this function needs. Its flat effect list is empty
 * by construction, so a walk over it returns zero slots and
 * `everySlotHasAChoice` reads zero slots as "every slot has a choice" — a modal
 * card reported castable while aiming at nothing, which is the shape of silent
 * wrong answer this vocabulary exists to make impossible. Nothing inside the
 * kernel arrives here with one: `castOptions` picks the mode first and hands the
 * chosen branch to `targetChoicesForEffects` above, reaching this function only
 * on the Aura arm, and `checkEffects` refuses `modes` on a permanent, so an Aura
 * cannot be modal. This is the exported boundary, for a caller that did not come
 * through that path, and `effectsFor` is what refuses — the same error a mode
 * read with no mode chosen raises anywhere else.
 */
export function targetChoicesFor(
  state: GameState,
  card: Card,
  controller: PlayerId,
  sourceOid?: ObjectId,
): readonly (readonly (Target | null)[])[] {
  if (isAuraCard(card)) {
    const source = sourceOid ?? card;
    return [
      state.battlefield
        .filter((oid) => isLegalAuraHost(state, card, oid) && canBeTargetedBy(state, oid, source, controller))
        .map((oid): Target => ({ kind: 'permanent', oid })),
    ];
  }
  return targetChoicesForEffects(state, effectsFor(card, null), controller, sourceOid ?? card);
}

/**
 * True when every slot this list needs has at least one legal choice.
 *
 * The one shape of "there is nothing to aim at". A cast whose card fails it is
 * not offered (the player simply cannot cast it), and a triggered ability that
 * fails it is *removed from the stack* rather than asked (CR 603.3d), which is
 * the one place the same predicate produces two different rules.
 */
export function everySlotHasAChoice(choices: readonly (readonly (Target | null)[])[]): boolean {
  return choices.every((slot) => slot.length > 0);
}
