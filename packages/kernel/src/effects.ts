/**
 * Resolution of the pinned spell-effect primitives.
 *
 * `EFFECT_EXECUTION` is one declaration per primitive — how CR 608.2b rechecks
 * its target, and what resolving it does — mapped over the whole of
 * `AnyEffectKind`. The moment the DSL grows a primitive this file fails to
 * compile, which is the co-design invariant enforced by the type system rather
 * than by discipline; it was two `switch`es with `assertNever` defaults, which
 * enforced the same thing at twice the cost of adding one.
 */
import type {
  AnyEffectKind,
  Card,
  CounterKind,
  CountFilter,
  Effect,
  EffectScope,
  PlayerScope,
  PumpAmount,
  TargetedEffect,
  TargetFilter,
  TargetKind,
  TargetSpec,
} from '@mtg/dsl';
import {
  assertNever,
  EFFECT_SCOPE_SUBJECT,
  hasTarget,
  isGrantableKeywordAbilityKind,
  isLiteralAmount,
  isReferentTarget,
  isSourceBodyOnlyTarget,
  requiresDistinctTarget,
  targetFilterOf,
  targetRestrictionOf,
} from '@mtg/dsl';
import type { ContinuousEffect } from './continuous';
import { addCounters, ANY_PERMANENT, counterCount, objectFilter } from './continuous';
import { selectMatching } from './characteristics';
import type { ObjectId, PlayerId } from './ids';
import { continuousEffectId, opponentOf, preventionEffectId } from './ids';
import {
  controllerOf,
  derivedCharacteristics,
  hasCardType,
  hasKeyword,
  isCreatureObject,
  powerOf,
} from './layers';
import { canBeTargetedBy, type ProtectionSource } from './keyword-abilities';
import { satisfiesTargetRestriction } from './target-restrictions';
import { satisfiesTargetFilter, spellSatisfiesFilter } from './target-filter';
import type { GameState, ResolutionTally, Target } from './state';
import { apnapOrder, NOTHING_TALLIED } from './state';
import type { Trace } from './trace';
import { emit, withState } from './trace';
import type { DamageInstance } from './damage';
import { applyDamage, gainLife } from './damage';
import { loseLife, setLife } from './life';
import type { ReplacementEffect } from './replacement-effects';
import { addManaToPool } from './mana';
import { graveyardMembers, printedFilter, selectPrinted } from './zone-filter';
import { destroyPermanent, sacrificePermanent } from './destruction';
import {
  createToken,
  drawCards,
  exileGraveyard,
  holdTapped,
  isOnBattlefield,
  millCards,
  moveObject,
  putOnLibrary,
  revealTopCards,
  shuffleGraveyardIntoLibrary,
  shuffleLibrary,
  tapObject,
  tryObject,
  untapObject,
} from './zones';

/** Structural equality of two chosen targets. */
/**
 * Are these the same target?
 *
 * Exported for `legal.ts`, which needs it to check that a sequenced answer to a
 * trigger's targets repeats the slots already settled rather than rewriting
 * them.
 */
export function sameTarget(a: Target, b: Target): boolean {
  switch (a.kind) {
    case 'player':
      return b.kind === 'player' && a.player === b.player;
    case 'permanent':
    case 'spell':
      return b.kind === a.kind && a.oid === b.oid;
    default:
      return assertNever(a, 'sameTarget');
  }
}

/**
 * Does this target still answer the printed targeting mode?
 *
 * `chooser` is who is asking, and only the controller-restricted kind reads it.
 * CR 608.2b rechecks a target's legality as the spell or ability resolves,
 * against the same restrictions it was chosen under, so "you control" has to
 * mean the same player at both moments — the one who put the object on the
 * stack, not whoever controls the target now.
 */
function matchesTargetKind(
  state: GameState,
  wanted: TargetKind,
  target: Target | null,
  chooser: PlayerId,
): boolean {
  if (wanted === 'noTarget') return target === null;
  if (wanted === 'triggeringCreature') {
    return target !== null && target.kind === 'permanent' && isOnBattlefield(state, target.oid);
  }
  if (isSourceBodyOnlyTarget(wanted)) {
    // The slot never carries a real target — `target-choices.ts` fills it with
    // the same `null` placeholder `noTarget` uses, because the referent is the
    // ability's own source and not a choice submitted alongside the action.
    // `planResolution`'s dedicated source-body branch (`stack.ts`) resolves the
    // actual referent off `entry.ability.sourceOid` and never reaches this
    // function; this arm only answers `validateActivation` and
    // `validateTriggerTargets`, which walk every effect through it before that
    // branch runs. Unlike `triggeringCreature` above, this arm requires
    // `target === null` rather than a live permanent, because unlike that
    // kind's retained event object, this slot's placeholder never becomes a
    // real `Target` at any point in its life.
    //
    // Both members answer here identically, and that is the point of asking
    // the list: `selfPermanent` (`mtg-rji`) differs from `selfCreature` only
    // in the noun its oracle text prints and in which card types may carry it,
    // and neither of those is a fact the kernel's target machinery reads.
    return target === null;
  }
  if (isReferentTarget(wanted)) {
    // The third retained referent, and it answers exactly as the source-body
    // arm above does and for the same reason: the slot carries the `null`
    // placeholder `target-choices.ts` fills it with, because what it names was
    // chosen by an earlier slot of the same list rather than submitted
    // alongside the action. `planResolution`'s own referent branch (`stack.ts`)
    // reads that earlier slot and projects the controller when the phrase asks
    // for one, and never reaches this function; this arm answers `validateCast`
    // and `validateActivation`, which walk every slot through it before any
    // resolution happens. `mtg-nhyv.75`.
    return target === null;
  }
  if (target === null || target.kind === 'spell') return false;
  const legalCreature =
    target.kind === 'permanent' && isOnBattlefield(state, target.oid) && isCreatureObject(state, target.oid);
  if (wanted === 'targetPlayer') return target.kind === 'player';
  // CR 115.4. Opponency is a relation to the chooser, and the chooser is the
  // player who put the object on the stack — the same reading
  // `targetCreatureYouControl` takes below, and for the same CR 608.2b reason.
  if (wanted === 'targetOpponent') return target.kind === 'player' && target.player !== chooser;
  if (wanted === 'targetCreature') return legalCreature;
  if (wanted === 'targetCreatureDefendingPlayerControls') {
    // The CR 608.2b recheck of the space `targetChoicesForEffects` enumerated,
    // and it is written as the same derivation rather than a second one: the
    // defending player is the chooser's one opponent (see that function for why
    // that is exact rather than approximate), so a creature that changed hands
    // after the trigger went on the stack has stopped being a legal target.
    return legalCreature && target.kind === 'permanent' && controllerOf(state, target.oid) !== chooser;
  }
  if (wanted === 'targetCreatureYouControl') {
    // Layer 2's answer, so a creature that changed hands after the ability went
    // on the stack has stopped being a legal target and CR 608.2b drops it.
    return legalCreature && target.kind === 'permanent' && controllerOf(state, target.oid) === chooser;
  }
  if (wanted === 'targetCreatureYouDontControl') {
    // Layer 2's answer negated, which is the whole difference from the arm
    // above: a creature that changed hands after the trigger went on the stack
    // has stopped being a legal target, in either direction. The comparison is
    // against `chooser` rather than against "an opponent" for the CR 608.2b
    // reason the two arms around it give, and in a two-player game the two
    // readings coincide.
    return legalCreature && target.kind === 'permanent' && controllerOf(state, target.oid) !== chooser;
  }
  if (wanted === 'targetArtifactOrEnchantment') {
    // The CR 608.2b recheck of the third space `targetChoicesForEffects`
    // enumerates, asked the same way that enumeration asks it: through
    // `hasCardType`, so a permanent whose types a continuous effect changed is
    // what it currently is rather than what it was printed as. Without this arm
    // the kind fell through to the `anyTarget` line below, which admits a
    // creature, a player and a planeswalker and refuses an artifact — so the
    // kernel offered a Disenchant its target and then refused the cast.
    return (
      target.kind === 'permanent' &&
      isOnBattlefield(state, target.oid) &&
      (hasCardType(state, target.oid, 'artifact') || hasCardType(state, target.oid, 'enchantment'))
    );
  }
  const legalPlaneswalker =
    target.kind === 'permanent' &&
    isOnBattlefield(state, target.oid) &&
    hasCardType(state, target.oid, 'planeswalker');
  if (wanted === 'targetPermanent') {
    // The widest object space, so the kind itself asks only "is it still a
    // permanent" — CR 110.1, an object on the battlefield. Everything that
    // narrows it is in the slot's filter, and `isTargetStillLegal` rechecks
    // that separately, so this arm stays true when a Bramblegrip's noncreature
    // filter is the thing that stopped matching. Splitting them that way is
    // what lets the filter recheck read one function that the enumeration also
    // reads.
    return target.kind === 'permanent' && isOnBattlefield(state, target.oid);
  }
  if (wanted === 'targetPlayerOrPlaneswalker') {
    // Lava Axe's space (CR 115.1: "target player or planeswalker"). Written as
    // its own arm rather than left to fall through to `anyTarget` below,
    // because that line also admits a creature, and a Lava Axe pointed at a
    // Grizzly Bears is a card whose text and behavior disagree.
    return target.kind === 'player' || legalPlaneswalker;
  }
  return target.kind === 'player' || legalCreature || legalPlaneswalker;
}

/** True when no slot before `index` already chose `target`. */
function isFreshTarget(targets: readonly (Target | null)[], index: number, target: Target): boolean {
  for (let earlier = 0; earlier < index; earlier += 1) {
    const chosen = targets[earlier];
    if (chosen !== undefined && chosen !== null && sameTarget(chosen, target)) return false;
  }
  return true;
}

/**
 * Is the target chosen for slot `index` still a legal target right now?
 *
 * The whole tuple is passed rather than the one target because a `distinct`
 * slot is legal only relative to what the same spell already chose (CR 601.2c
 * is about one instance of "target"; this is the "another target creature"
 * template). Slot legality is therefore not a per-slot question, and callers
 * that ask it per-slot would enforce half the rule.
 *
 * `chooser` is the player who chose the tuple, which one targeting mode needs
 * and the rest ignore. It is a parameter rather than something read off the
 * board because the board no longer knows: an ability resolves with its source
 * already sacrificed, which is exactly Fuse, so "the controller of the
 * permanent this effect came from" has no answer by the time CR 608.2b asks.
 */
export function isTargetStillLegal(
  state: GameState,
  effect: Effect,
  targets: readonly (Target | null)[],
  index: number,
  chooser: PlayerId,
  source?: ProtectionSource,
): boolean {
  const target = targets[index] ?? null;
  const recheck: TargetRecheck = EFFECT_EXECUTION[effect.kind].recheck;
  switch (recheck) {
    case 'untargeted':
      return true;
    case 'spellOnStack': {
      // Still on the stack, and still a spell: a counter aimed at an object
      // that has become a triggered ability's entry has no legal target.
      if (
        target === null ||
        target.kind !== 'spell' ||
        !state.stack.some((e) => e.oid === target.oid && e.ability === null)
      ) {
        return false;
      }
      // CR 608.2b again, for the half of "target creature spell" that is not
      // the word "spell". A spell's characteristics are its printed ones plus
      // whatever is copiable about it; nothing in this vocabulary changes them
      // while it is on the stack, so the recheck can only fail on the object
      // having stopped being a spell — which the lines above already caught.
      // It is written anyway because the day a vocabulary member does change a
      // spell's type, the recheck that was never written is the bug.
      const spellFilter = effect.kind === 'counterSpell' ? effect.spellFilter : undefined;
      return spellFilter === undefined || spellSatisfiesFilter(state, target.oid, spellFilter);
    }
    case 'printedMode': {
      // Unreachable: `EffectExecution.recheck` only admits `printedMode` for a
      // primitive whose effect carries a `target`, so this narrowing always
      // succeeds. It is written rather than asserted because the type that
      // proves it is on the declaration and the narrowing is needed here.
      if (!hasTarget(effect)) return true;
      if (!isLegalSingleObject(state, effect, target, chooser, source)) return false;
      if (target === null || !requiresDistinctTarget(effect.target)) return true;
      return isFreshTarget(targets, index, target);
    }
    default:
      return assertNever(recheck, 'isTargetStillLegal');
  }
}

/**
 * The CR 608.2b recheck for one candidate object against a printed slot's
 * kind, restriction and filter — everything `isTargetStillLegal`'s
 * `'printedMode'` branch checked inline except the `distinct` half, which is
 * a fact about a *slot* relative to its siblings rather than about one
 * object, and so belongs to that caller and not to this one.
 *
 * Extracted for `survivingMultipleTargets`, which rechecks every member of a
 * `TargetSpec.count` slot ("up to two target creatures", `mtg-kg44`) through
 * the exact rule a single-target slot is rechecked by, rather than a second,
 * hand-copied version of it that could drift. `distinct` never reaches a
 * counted slot at all — `checkTargetCount` (`@mtg/dsl`) refuses the
 * combination — so there is nothing that caller is missing by skipping it.
 */
function isLegalSingleObject(
  state: GameState,
  effect: TargetedEffect,
  target: Target | null,
  chooser: PlayerId,
  source?: ProtectionSource,
): boolean {
  if (!matchesTargetKind(state, effect.target.kind, target, chooser)) return false;
  if (
    source !== undefined &&
    target?.kind === 'permanent' &&
    !canBeTargetedBy(state, target.oid, source, chooser)
  ) {
    return false;
  }
  // CR 608.2b rechecks every restriction the spell printed, not only the
  // one the kind carries: a creature that grew past "power 3 or less" after
  // being targeted is no longer a legal target, and the spell fizzles.
  const restriction = targetRestrictionOf(effect.target);
  if (
    restriction !== null &&
    target?.kind === 'permanent' &&
    !satisfiesTargetRestriction(state, target.oid, restriction)
  ) {
    return false;
  }
  // And every filter, for the same reason and through the same function
  // `targetChoicesForEffects` enumerated with. A creature that stopped
  // attacking after Divine Verdict targeted it is no longer a legal target
  // (CR 506.4), and a permanent a continuous effect turned black is no
  // longer a legal Doom Blade target — both fall out of asking the layer
  // walk rather than the printed card.
  const filter = targetFilterOf(effect.target);
  if (filter !== null && target?.kind === 'permanent' && !satisfiesTargetFilter(state, target.oid, filter)) {
    return false;
  }
  return true;
}

/**
 * CR 608.2b's partial-survivor half of a `TargetSpec.count` slot ("up to two
 * target creatures", `mtg-kg44`): every chosen member is rechecked
 * independently, and whichever are still legal are the ones the effect
 * applies to. The slot itself is never all-or-nothing the way
 * `isTargetStillLegal`'s boolean contract is — a spell that tapped one
 * legal creature and one that has since left the battlefield still taps the
 * one that remains, the same way "destroy target artifact or enchantment.
 * You gain 4 life" keeps its life gain when the artifact is gone.
 *
 * `stack.ts`'s `planResolution` is the only caller: it needs the survivors
 * themselves to fold into `tapPermanent`'s apply, a different question than
 * "is this slot still legal", the one every submission-time validator in
 * `legal.ts` asks through `isTargetStillLegal`. Two functions rather than one
 * overloaded to answer both, because a boolean and a filtered list are not
 * the same contract and validating code that only wants the boolean should
 * not have to discard a list to get it.
 */
export function survivingMultipleTargets(
  state: GameState,
  effect: TargetedEffect,
  members: readonly ObjectId[],
  chooser: PlayerId,
  source?: ProtectionSource,
): readonly ObjectId[] {
  return members.filter((oid) =>
    isLegalSingleObject(state, effect, { kind: 'permanent', oid }, chooser, source),
  );
}

/** True when every `distinct` slot in `targets` avoids the earlier slots' targets. */
export function honoursDistinctSlots(
  effects: readonly Effect[],
  targets: readonly (Target | null)[],
): boolean {
  return effects.every((effect, index) => {
    if (!hasTarget(effect) || !requiresDistinctTarget(effect.target)) return true;
    const target = targets[index] ?? null;
    return target === null || isFreshTarget(targets, index, target);
  });
}

function playerTarget(target: Target | null, fallback: PlayerId): PlayerId {
  return target !== null && target.kind === 'player' ? target.player : fallback;
}

function permanentTarget(target: Target | null): ObjectId | null {
  return target !== null && target.kind === 'permanent' ? target.oid : null;
}

/**
 * The group a one-shot scope names, read once, in zone order.
 *
 * Three decisions live in this function and none is a default.
 *
 * CR 609.2: an effect that affects a group affects the group as it was when the
 * spell resolved. The list is therefore computed before the first `moveObject`
 * and never recomputed — which matters because the moves themselves change the
 * zone list, and a re-derived filter would walk a shrinking array while indexing
 * it. It also settles what a creature that stops being a creature mid-resolution
 * does, which is nothing: it is in the set or it is not.
 *
 * Zone order, because `selectMatching` preserves it and both `state.battlefield`
 * and a player's `hand` are themselves deterministic — appended in the order
 * objects arrived. Replay is the whole record in this engine (seed plus choice
 * list), so an effect that reached several objects has to reach them in an order
 * derived from state rather than from a set's iteration order or a controller's
 * hand.
 *
 * **Which zone is the scope's to say**, which is the whole reason this is a
 * vocabulary and not a filter. A scope over the battlefield asks the layer
 * system what a permanent currently *is*, so a creature by way of a layer-4
 * effect is taken. A scope over a hand or a graveyard cannot: nothing in the
 * layer system applies to a card off the battlefield or the stack (CR 611.2c),
 * so the only honest answer there is the printed card type — and reading the
 * derived characteristics of an object that has none would silently return an
 * empty group. The graveyard arm reuses `zone-filter.ts`'s `graveyardMembers` /
 * `selectPrinted` rather than repeating the hand arm's inline filter, because
 * that module exists precisely to be the printed-values-only path a
 * non-battlefield zone gets; the hand arm predates it and is left as its own
 * inline filter to keep this change to the zone the bead measured.
 *
 * Exported because the sim's targeting policy scores a sweep by summing what it
 * would score each member at, and a policy that derived the group a second way
 * could value a sweep the resolution does not perform.
 */
export function objectsInEffectScope(
  state: GameState,
  scope: EffectScope,
  player: PlayerId,
  filter?: TargetFilter,
): readonly ObjectId[] {
  switch (scope) {
    case 'creaturesThatPlayerControls':
      return selectMatching(state.battlefield, derivedCharacteristics(state), {
        ...ANY_PERMANENT,
        cardTypes: ['creature'],
        controller: player,
      });
    case 'creatureCardsInPlayerHand':
      return state.players[player].hand.filter((oid) => tryObject(state, oid)?.card.kind === 'creature');
    case 'creatureCardsInPlayerGraveyard':
      return selectPrinted(
        state,
        graveyardMembers(state, player),
        printedFilter({ cardTypes: ['creature'] }),
      );
    case 'allPermanents':
    case 'permanentsYouControl':
    case 'permanentsOpponentsControl':
      return selectMatching(
        state.battlefield,
        derivedCharacteristics(state),
        scope === 'allPermanents'
          ? ANY_PERMANENT
          : {
              ...ANY_PERMANENT,
              controller: scope === 'permanentsYouControl' ? player : opponentOf(player),
            },
      ).filter((oid) => filter === undefined || satisfiesTargetFilter(state, oid, filter));
    default:
      return assertNever(scope, 'objectsInEffectScope');
  }
}

/**
 * The player a scope reads its group off.
 *
 * `EFFECT_SCOPE_SUBJECT` is the table, and this is the one place that consults
 * it: the three older scopes name a targeted player and the three space scopes
 * name the resolving controller, so "which player" is a property of the scope
 * rather than of the primitive using it. `null` means the sentence has no
 * subject to read — a targeted-player scope whose target slot resolved to
 * nothing — and every caller treats that as the empty group, which is what a
 * spell whose only target was removed does anyway (CR 608.2b).
 *
 * `opponentsControl` reduces to one opponent inside `objectsInEffectScope`
 * rather than here, because that is where the seat count lives: `opponentOf` is
 * the two-player identity this kernel is built on, and a multiplayer kernel
 * changes that function and nothing in this file.
 */
function effectScopeSubject(
  scope: EffectScope,
  target: Target | null,
  controller: PlayerId,
): PlayerId | null {
  if (EFFECT_SCOPE_SUBJECT[scope] === 'resolvingController') return controller;
  return target !== null && target.kind === 'player' ? target.player : null;
}

/**
 * The group a scoped effect reaches, however it reads it.
 *
 * One function for both halves of the vocabulary, and that is the point:
 * enumeration (the sim's targeting policy), resolution (every arm below) and
 * the group a continuous effect is built over all call this, so a sweep is
 * priced against the objects it actually hits. Two derivations of one group is
 * two chances for the score and the resolution to disagree.
 *
 * Fixed here, once, at resolution: CR 609.2 says the set of objects a
 * resolution affects is determined when it resolves and does not change as the
 * resolution proceeds, so callers that then move or destroy members work down
 * this list rather than re-reading the board between steps.
 */
export function scopedGroup(
  state: GameState,
  scope: EffectScope,
  filter: TargetFilter | undefined,
  target: Target | null,
  controller: PlayerId,
): readonly ObjectId[] {
  const subject = effectScopeSubject(scope, target, controller);
  return subject === null ? [] : objectsInEffectScope(state, scope, subject, filter);
}

/**
 * "Exile all creatures target opponent controls", and every other sentence
 * shaped like it: one step, performed once per member of a scoped group.
 *
 * Three primitives run through here now — the scoped exile it was written for,
 * a scoped `putCounters` and `returnFromGraveyard` — and the shared part is
 * everything except which step to take. Hoisting `step` out is what keeps the
 * per-member recheck below from being written three times, each with its own
 * chance to forget it.
 *
 * The player is the target and the objects are not (CR 115.1), so hexproof and
 * shroud on the bodies are irrelevant and there is one choice to record for the
 * whole sweep. Each move goes through `moveObject` one at a time rather than
 * through a batch primitive, which is what keeps every consequence exile already
 * has — no death trigger, dropped continuous effects, CR 400.7's new object —
 * true of each member without a second implementation of any of them. The hand
 * scope needs no arm of its own here for exactly that reason: `moveObject`'s
 * switches are total over `ZoneId`, so a card leaving a hand is already a case
 * it handles.
 *
 * `tryObject` is rechecked per member because a member can leave between moves:
 * an Aura or Equipment attached to an exiled creature does not follow it, but a
 * token that ceased to exist would already be gone, and re-reading is cheaper
 * than reasoning about which.
 */
function overEffectScope(
  trace: Trace,
  scope: EffectScope,
  filter: TargetFilter | undefined,
  target: Target | null,
  controller: PlayerId,
  step: (current: Trace, oid: ObjectId) => Trace,
): Trace {
  const group = scopedGroup(trace.state, scope, filter, target, controller);
  return group.reduce(
    (current, oid) => (tryObject(current.state, oid) === undefined ? current : step(current, oid)),
    trace,
  );
}

/**
 * The bodies one until-end-of-turn continuous effect reaches: the permanent it
 * targeted, or the group its scope reads off a player, or the region of the
 * board its scope names outright.
 *
 * Split out rather than inlined because the arms that call it build one
 * continuous effect either way, and the only thing the three forms disagree
 * about is the list. One list covers all of them, because `onlyObject(oid)` is
 * spelled `objectFilter({ oids: [oid] })` and a one-member group builds exactly
 * that.
 *
 * Two primitives ask it — the layer-7c pump and the layer-6 keyword grant — and
 * that is the point rather than a coincidence: they are the same sentence in
 * two layers, Overrun prints both halves at once over one group, and a second
 * derivation of the group would be a second chance for the pump and the grant
 * on one card to reach different creatures.
 */
function continuousEffectGroup(
  effect: EffectOf<'pumpUntilEndOfTurn'> | EffectOf<'grantKeywordUntilEndOfTurn'>,
  ctx: { readonly trace: Trace; readonly target: Target | null; readonly controller: PlayerId },
): readonly ObjectId[] {
  if (effect.scope === undefined) {
    const oid = permanentTarget(ctx.target);
    return oid === null ? [] : [oid];
  }
  return scopedGroup(ctx.trace.state, effect.scope, effect.scopeFilter, ctx.target, ctx.controller);
}

/**
 * The seats a player sweep names, in the order they act.
 *
 * A `switch` over the vocabulary rather than a direct call, for the reason
 * every other table in this file is total: `PLAYER_SCOPES` grew its second
 * member the day a card said "each opponent" (Liliana's Specter, M11 104), and
 * this stopped compiling then rather than silently dealing that card every
 * player's cards.
 *
 * Both arms walk APNAP (CR 101.4) rather than seat order, and `eachOpponent`
 * filters that order rather than calling `opponentOf`: the two agree at two
 * seats and only one of them keeps agreeing at three, and the order is what a
 * replay depends on — two players drawing off their own libraries is two draws
 * against one RNG stream.
 *
 * Exported because the two discards are performed by the interruptible
 * resolution runner rather than by `EFFECT_EXECUTION.apply` (`scry.ts`), and a
 * second derivation of "which seats" there would be a second chance for the
 * printed line and the performed one to disagree.
 */
export function playersInSweep(
  state: GameState,
  scope: PlayerScope,
  controller: PlayerId,
): readonly PlayerId[] {
  switch (scope) {
    case 'eachPlayer':
      return apnapOrder(state);
    case 'eachOpponent':
      return apnapOrder(state).filter((player) => player !== controller);
    default:
      return assertNever(scope, 'playersInSweep');
  }
}

function damageInstance(
  state: GameState,
  sourceOid: ObjectId,
  controller: PlayerId,
  target: Target,
  amount: number,
  sourceCard?: Card,
): DamageInstance | null {
  const deathtouch = isOnBattlefield(state, sourceOid) && hasKeyword(state, sourceOid, 'deathtouch');
  const lifelink = isOnBattlefield(state, sourceOid) && hasKeyword(state, sourceOid, 'lifelink');
  if (target.kind === 'player') {
    return {
      sourceOid,
      ...(sourceCard === undefined ? {} : { sourceCard }),
      controller,
      recipient: { kind: 'player', player: target.player },
      amount,
      deathtouch,
      lifelink,
      combat: false,
    };
  }
  if (target.kind === 'spell') return null;
  return {
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
    controller,
    recipient: { kind: 'permanent', oid: target.oid },
    amount,
    deathtouch,
    lifelink,
    combat: false,
  };
}

/**
 * Where one resolution began, so an effect can count what the resolution has
 * done so far.
 *
 * An index into `trace.events`, and it is an index rather than a running tally
 * because the events are the record. "The number of cards exiled this way" is a
 * question about a span of the log, and the span's start is the only thing the
 * caller has to know; every arm that asks reads the same span the same way, and
 * nothing has to be threaded through the resolution loop and kept in step with
 * it.
 *
 * Zero is a legal mark and means "count the whole game", which is what a caller
 * with no resolution to speak of gets. `applyEffect` demands the parameter
 * rather than defaulting it, because a default here is a card that silently
 * counts the wrong span.
 *
 * The mark answers the span *within one reduction*, which is every resolution
 * that runs to completion. A resolution that stops to ask a question (CR
 * 701.18 scry) resumes in a later `reduce` against a fresh event log, so the
 * span before the pause is unreachable from any index — that half arrives as
 * a `ResolutionTally` banked on `PendingScry` and its siblings. Mark plus
 * tally, never one or the other.
 */
export type ResolutionMark = number;

/**
 * The number of *cards* this resolution has put into exile.
 *
 * Cards, not objects: a token that was exiled ceased to be anything a card
 * could count, and Magic's own wording is "cards exiled this way". The
 * distinction is real on this card — the sweep that fills the count takes
 * tokens too — so it is read off the object rather than off the event.
 *
 * Read here and by `tallyThrough` below, which is what banks the span's answer
 * on a pending record. One definition, so the tally carried across a pause and
 * the tally read after it count the same thing.
 */
function exiledSince(trace: Trace, since: ResolutionMark): number {
  let count = 0;
  for (let index = since; index < trace.events.length; index += 1) {
    const event = trace.events[index];
    if (event === undefined || event.type !== 'zoneChanged' || event.to !== 'exile') continue;
    if (trace.state.objects[event.oid]?.token === true) continue;
    count += 1;
  }
  return count;
}

/**
 * How many permanents `controller` controls match `filter` right now.
 *
 * `@mtg/dsl`'s `CountFilterSchema` cannot import `ObjectFilter` — `@mtg/dsl`
 * has zero dependencies and `@mtg/kernel` depends on it, never the other way
 * — so this is the one place a DSL-authored `CountFilter` becomes a kernel
 * `ObjectFilter`: `undefined` becomes `null` ("no constraint") and
 * `controller` is supplied by the caller rather than carried on the filter,
 * matching `CountFilterSchema`'s own docblock (this DSL never counts an
 * opponent's side). `objectsInEffectScope` makes the identical translation
 * for `EffectScope`.
 */
function countMatching(state: GameState, filter: CountFilter, controller: PlayerId): number {
  return selectMatching(
    state.battlefield,
    derivedCharacteristics(state),
    objectFilter({
      cardTypes: filter.cardTypes ?? null,
      subtypes: filter.subtypes ?? null,
      controller,
    }),
  ).length;
}

/**
 * How many of the permanents a filter names are carrying one of the named
 * counters.
 *
 * Two questions against two sources, and they are asked separately because
 * they have to be: the filter is answered by `matchesFilter` off derived
 * characteristics, and a counter is not a derived characteristic — layer 7d
 * derives P/T *from* the counters, so the map cannot be asked for its own
 * input (`characteristics.ts`'s `conditionHolds` docblock argues it at
 * length). The counters therefore come straight off `state.objects`, which is
 * where they are stored.
 *
 * `some`, not `every`: a permanent carrying two of the named kinds is one
 * permanent, and this counts permanents.
 */
function countWithCounter(
  state: GameState,
  filter: CountFilter,
  counters: readonly CounterKind[],
  controller: PlayerId,
): number {
  const matching = selectMatching(
    state.battlefield,
    derivedCharacteristics(state),
    objectFilter({
      cardTypes: filter.cardTypes ?? null,
      subtypes: filter.subtypes ?? null,
      controller,
    }),
  );
  return matching.filter((oid) => {
    const object = state.objects[oid];
    if (object === undefined) return false;
    return counters.some((kind) => counterCount(object.counters, kind) > 0);
  }).length;
}

/**
 * How many lands with one basic land type are on the battlefield.
 *
 * A second entry point into `selectMatching` rather than a `controller`
 * argument on `countMatching` above, because the two questions differ in
 * exactly the field a `CountFilter` does not have: `landsWithSubtype` carries
 * `whose`, and `CountFilter` is by decision always "you control"
 * (`CountFilterSchema`'s docblock). Widening the shared helper would have made
 * the side a parameter of every count in the file and left one caller passing
 * a value the DSL shape it translates cannot express.
 *
 * The subtype goes into the same `subtypes` slot a `countMatching` would use,
 * so a basic Swamp is counted through `derivedCharacteristics` exactly as a
 * Zombie is — `characteristics.ts` folds `basicLandType` into the derived
 * subtypes — and a CR 613 layer-4 effect that makes a Mountain into a Swamp
 * moves the count, which is the answer the rules give.
 */
function countLandsWithSubtype(state: GameState, subtype: string, controller: PlayerId | null): number {
  return selectMatching(
    state.battlefield,
    derivedCharacteristics(state),
    objectFilter({ cardTypes: ['land'], subtypes: [subtype], controller }),
  ).length;
}

/**
 * How much damage this resolution has dealt so far — "the damage dealt this
 * way".
 *
 * `exiledSince`'s sibling, and it reads the *events* rather than re-deriving
 * the printed figure on purpose: `damagePrevented` and the CR 614
 * `multiplyDamage` replacement both rewrite what actually happens, and a
 * `damageDealt` event is emitted with the amount that survived both. Summing
 * the events is therefore the only reading that keeps Corrupt's two clauses
 * equal to each other under a Furnace of Rath or a prevention shield.
 *
 * `exiledSince`'s pre-pause half is banked on the pending record and so is this
 * one: both are fields of the same `ResolutionTally`, which is what lets "deal
 * damage, scry 2, then deal damage equal to the damage dealt this way" print.
 * `@mtg/dsl` used to refuse that card by name (`DAMAGE_TALLY_ACROSS_PAUSE`)
 * because the field did not exist; it does now, and the rule is gone.
 */
function damageDealtSince(trace: Trace, since: ResolutionMark): number {
  let total = 0;
  for (const event of trace.events.slice(since)) {
    if (event.type !== 'damageDealt') continue;
    total += event.amount;
  }
  return total;
}

/**
 * What the resolution has done, banked half plus the half this reduction can
 * see.
 *
 * The one function `scry.ts` calls when it banks a tally at a pause, so the two
 * fields cannot fall out of step with each other or with the two `…Since`
 * readers above: adding a third resolution-scoped amount means a field on
 * `ResolutionTally` and a line here, and nothing at any of the pausing sites.
 */
export function tallyThrough(trace: Trace, since: ResolutionMark, before: ResolutionTally): ResolutionTally {
  return {
    exiled: before.exiled + exiledSince(trace, since),
    damage: before.damage + damageDealtSince(trace, since),
  };
}

/**
 * The greatest power among the permanents `filter` names, or 0 when it names
 * none.
 *
 * Power is read off `derivedCharacteristics`, so it is the number after the
 * whole CR 613 walk — an Overwhelming Stampede cast while a lord is out reads
 * the pumped figure, which is the answer the rules give. CR 107.3's reading of
 * a greatest-value quantity over an empty set is 0, and that is what an empty
 * battlefield returns here rather than `-Infinity`.
 */
function greatestPowerAmong(state: GameState, filter: CountFilter, controller: PlayerId): number {
  const map = derivedCharacteristics(state);
  const matching = selectMatching(
    state.battlefield,
    map,
    objectFilter({
      cardTypes: filter.cardTypes ?? null,
      subtypes: filter.subtypes ?? null,
      controller,
    }),
  );
  let greatest = 0;
  for (const oid of matching) {
    const power = map.get(oid)?.power ?? 0;
    if (power > greatest) greatest = power;
  }
  return greatest;
}

/**
 * A printed quantity, resolved against the game as it stands.
 *
 * The evaluation point is the moment the effect applies, not the moment the
 * spell was cast or put on the stack: an effect that counts what an earlier
 * effect of the same spell did has to see that work, which is the whole shape
 * of "exile all creatures … then deal damage equal to the number exiled".
 *
 * `controller` is who the amount counts relative to. For `countMatching` it
 * is the caster, per `CountFilterSchema`'s "always you control" rule; for
 * `cardsInGraveyard` it resolves the `'you'` case — `@mtg/dsl`'s
 * `CardsInGraveyardSchema` docblock names this exact hand-off, since the
 * schema cannot carry a `PlayerId` without `@mtg/dsl` depending on
 * `@mtg/kernel`. `since` has no role for either: a graveyard's size and a
 * board count are both read fresh at the moment of evaluation, never a span
 * of the trace since resolution began the way `exiledThisResolution` reads
 * one (CR 611.2c — nothing continuous reaches a graveyard, so there is no
 * earlier value to diff against there either).
 */
export function evaluateAmount(
  trace: Trace,
  amount: PumpAmount,
  since: ResolutionMark,
  controller: PlayerId,
  before: ResolutionTally = NOTHING_TALLIED,
): number {
  if (isLiteralAmount(amount)) return amount;
  switch (amount.kind) {
    case 'exiledThisResolution':
      return before.exiled + exiledSince(trace, since);
    case 'cardsInGraveyard':
      return graveyardMembers(trace.state, amount.whose === 'each' ? 'each' : controller).length;
    case 'countMatching':
      return countMatching(trace.state, amount.filter, controller);
    case 'countWithCounter':
      return countWithCounter(trace.state, amount.filter, amount.counters, controller);
    case 'countMatchingOpponent':
      // `opponentOf` is total in a two-player game, which is the whole of the
      // translation: the DSL says "your opponents" because that is what a card
      // prints, and this engine has exactly one of them.
      return countMatching(trace.state, amount.filter, opponentOf(controller));
    case 'landsWithSubtype':
      return countLandsWithSubtype(trace.state, amount.subtype, amount.whose === 'each' ? null : controller);
    case 'greatestPowerAmong':
      return greatestPowerAmong(trace.state, amount.among, controller);
    case 'damageDealtThisResolution':
      return before.damage + damageDealtSince(trace, since);
    case 'ratePer':
      // CR 609.2 in one multiplication. The count is read here, once, at the
      // moment the effect applies, and the number that leaves this function is
      // a plain integer with no memory of what it counted — which is exactly
      // what makes Mutilate's -1/-1 per Swamp stop moving when the Swamps do.
      // A rate that wanted to keep re-reading the board would not be an amount
      // at all; it would be `statBonusPer`, whose value the layer walk
      // recomputes on every pass.
      return amount.rate * evaluateAmount(trace, amount.each, since, controller, before);
    case 'chosenX':
      // The chosen X is a fact about the spell that is resolving, not about the
      // board `evaluateAmount` sees — it lives on the (already-popped)
      // `StackEntry` and is surfaced through `ApplyContext.number`, which
      // special-cases this kind before ever reaching here. A direct call
      // (outside effect application, e.g. from a policy that has no context)
      // is a caller bug, not a value this function can honestly produce.
      throw new Error('chosen-X amount resolved outside effect application; use ApplyContext.number');
    default:
      return assertNever(amount, 'evaluateAmount');
  }
}

/**
 * How CR 608.2b rechecks one primitive's target as it resolves.
 *
 * A mode rather than a per-kind branch, because it is not a per-kind fact:
 * eleven of the thirteen primitives recheck identically, and the old `switch`
 * wrote them as an eleven-label arm that a twelfth primitive had to be added to
 * by hand. A new primitive now names an existing mode; only one that rechecks in
 * a genuinely new way adds a branch to `isTargetStillLegal`.
 */
type TargetRecheck =
  /** The printed targeting mode, plus the `distinct` rule where the slot asks. */
  | 'printedMode'
  /** Still on the stack and still a spell (CR 608.2b for a counter). */
  | 'spellOnStack'
  /** Nothing is targeted, so nothing can have become illegal. */
  | 'untargeted';

/** The one effect the union carries for a given kind. */
type EffectOf<K extends AnyEffectKind> = Extract<Effect, { readonly kind: K }>;

/** Everything one resolution needs that is not the effect itself. */
interface ApplyContext {
  readonly trace: Trace;
  readonly sourceOid: ObjectId;
  readonly controller: PlayerId;
  readonly target: Target | null;
  readonly since: ResolutionMark;
  /** The resolving spell's chosen X, or `null` for an ability or a fixed cost. */
  readonly x: number | null;
  /**
   * A printed quantity, resolved against the game as it stands at `trace`.
   *
   * `PumpAmount` rather than `Amount` because one slot in the vocabulary — the
   * pump's two stat deltas — also admits a rate, and a rate is resolved here
   * for the same reason every other computed amount is: this is the single
   * point at which a printed quantity becomes a number, and a caller that had
   * to reach past it would be reading the board on its own clock.
   */
  readonly number: (amount: PumpAmount) => number;
  /**
   * Surviving members of a `TargetSpec.count` slot ("up to two target
   * creatures"), added for `mtg-kg44`. `undefined` for every ordinary
   * single-target or targetless effect; `target` stays `null` for a counted
   * slot regardless, so a row that does not read this field sees the
   * targetless case it already handles rather than a silently wrong single
   * target. Only `tapPermanent`'s row reads it today — see
   * `TARGET_COUNT_EFFECT_KINDS` in `@mtg/dsl`.
   */
  readonly multiTarget?: readonly ObjectId[];
}

/**
 * What the kernel does with one effect primitive: how its target is rechecked,
 * and what resolving it does to the game.
 *
 * One declaration per primitive rather than two `switch`es over the same
 * discriminant in this file, for the reason `@mtg/dsl`'s `counters.ts` gives at
 * its own `DECLARATIONS`. The two facts arrive together — a primitive that
 * targets is a primitive whose target is rechecked — and splitting them made
 * adding one two edits a reader had to know to make in two places.
 *
 * `recheck` is `printedMode` only where the effect has a printed target, and
 * that is stated in the type rather than in a comment: for a kind carrying no
 * `target`, the conditional below removes `printedMode` from what the row may
 * say, so `counterSpell` cannot claim the mode that would read a field it does
 * not have.
 */
interface EffectExecution<K extends AnyEffectKind = AnyEffectKind> {
  readonly recheck: EffectOf<K> extends { readonly target: TargetSpec }
    ? TargetRecheck
    : Exclude<TargetRecheck, 'printedMode'>;
  readonly apply: (effect: EffectOf<K>, ctx: ApplyContext) => Trace;
}

/**
 * Every primitive the kernel runs. Mapped over the whole union, so a primitive
 * added to `@mtg/dsl` that the kernel cannot run is a compile error here — the
 * co-design invariant, enforced by the type system exactly as the `assertNever`
 * defaults it replaces enforced it.
 */
export type EffectExecutionTable = { readonly [K in AnyEffectKind]: EffectExecution<K> };

/**
 * One row with the caller's kind unknown: the union of the rows, not
 * `EffectExecution<AnyEffectKind>`. `apply`'s parameter is contravariant, so the
 * widened row is a type no row satisfies. `recheck` reads straight off it.
 */
type EffectExecutionRow = EffectExecutionTable[AnyEffectKind];

export const EFFECT_EXECUTION: EffectExecutionTable = {
  dealDamage: {
    recheck: 'printedMode',
    // `scope` turns the same primitive into a sweeper, and this is the one of
    // the four that does *not* go through `overEffectScope`. CR 120.3: damage
    // one source deals to several objects at once is dealt simultaneously, and
    // `applyDamage` already takes a list precisely so it can do that — it
    // aggregates lifelink into one life gain and checks protection per
    // recipient. Looping one instance at a time would deal a sweeper's damage
    // in N separate events and gain life N times, which is a different card.
    apply: (effect, ctx) => {
      const amount = ctx.number(effect.amount);
      const instance = (target: Target): DamageInstance | null =>
        damageInstance(ctx.trace.state, ctx.sourceOid, ctx.controller, target, amount);
      if (effect.scope !== undefined) {
        const group = scopedGroup(
          ctx.trace.state,
          effect.scope,
          effect.scopeFilter,
          ctx.target,
          ctx.controller,
        );
        const instances = group
          .map((oid) => instance({ kind: 'permanent', oid }))
          .filter((made): made is DamageInstance => made !== null);
        return instances.length === 0 ? ctx.trace : applyDamage(ctx.trace, instances);
      }
      if (ctx.target === null) return ctx.trace;
      const single = instance(ctx.target);
      return single === null ? ctx.trace : applyDamage(ctx.trace, [single]);
    },
  },
  fight: {
    recheck: 'printedMode',
    // CR 701.12a: each creature deals damage equal to its power to the other.
    // Three things about that sentence are load-bearing here.
    //
    // Both, or neither (CR 701.12c). If either creature has left the
    // battlefield or has stopped being a creature by the time the effect would
    // happen, no damage is dealt at all — not "the survivor still swings". The
    // recheck above catches the *target* leaving, because a fight names one;
    // it cannot catch the *source* leaving, because the source is not a target
    // and nothing rechecks it. So this arm asks about both bodies itself.
    //
    // Simultaneously (CR 120.3). The two instances go to `applyDamage` in one
    // call rather than two, which is what makes a 2/2 and a 2/2 trade: state-
    // based actions are checked once, after both are marked, so each has been
    // dealt lethal damage when the check runs. Two calls would kill the target,
    // then look for a creature that is no longer there to deal damage back.
    //
    // Each source is itself. `damageInstance` reads deathtouch and lifelink off
    // the object dealing that instance, so the target's deathtouch kills the
    // source and the source's lifelink gains its own controller life, without
    // either being special-cased. A 0-power fighter deals no damage rather than
    // an instance of zero: `applyDamage` skips a non-positive amount.
    apply: (_effect, ctx) => {
      const oid = permanentTarget(ctx.target);
      if (oid === null) return ctx.trace;
      const state = ctx.trace.state;
      const bothFight =
        isOnBattlefield(state, ctx.sourceOid) &&
        isCreatureObject(state, ctx.sourceOid) &&
        isOnBattlefield(state, oid) &&
        isCreatureObject(state, oid);
      if (!bothFight) return ctx.trace;
      const dealt = damageInstance(
        state,
        ctx.sourceOid,
        ctx.controller,
        { kind: 'permanent', oid },
        powerOf(state, ctx.sourceOid),
      );
      const struckBack = damageInstance(
        state,
        oid,
        controllerOf(state, oid),
        { kind: 'permanent', oid: ctx.sourceOid },
        powerOf(state, oid),
      );
      const instances = [dealt, struckBack].filter((made): made is DamageInstance => made !== null);
      return instances.length === 0 ? ctx.trace : applyDamage(ctx.trace, instances);
    },
  },
  destroyPermanent: {
    recheck: 'printedMode',
    // `scope` turns the same primitive into a one-sided wrath, through the same
    // per-member runner the scoped exile takes and for the same reason: each
    // body goes through `destroyPermanent` one at a time, so regeneration, the
    // `permanentDestroyed` event and every death trigger stay true of each
    // member without a second implementation of any of them. The members are
    // not targets (CR 115.1), so hexproof on a body is irrelevant here and the
    // one choice recorded for the whole sweep is which player it read.
    apply: (effect, ctx) => {
      if (effect.scope !== undefined) {
        return overEffectScope(
          ctx.trace,
          effect.scope,
          effect.scopeFilter,
          ctx.target,
          ctx.controller,
          (current, oid) => destroyPermanent(current, oid, 'destroyEffect'),
        );
      }
      const oid = permanentTarget(ctx.target);
      if (oid === null) return ctx.trace;
      return destroyPermanent(ctx.trace, oid, 'destroyEffect');
    },
  },
  exileTarget: {
    recheck: 'printedMode',
    // CR 701.20. `destroyPermanent` above with one word changed, and the word
    // is all of it: `moveObject` is the kernel's only zone-movement primitive,
    // its switches are already total over `ZoneId`, and CR 400.7's status
    // reset, the unattachment and `continuousEffectsExpired` come with it. No
    // `permanentDestroyed` event, because nothing was destroyed — exile is
    // reported by the `zoneChanged` the move emits.
    //
    // Two consequences are already right without being asked for. No death
    // trigger fires, because `selfDies` is derived from a battlefield-to-
    // graveyard move alone (`triggers.ts`), which is what makes this the answer
    // to a set built on dying being good. And an exiled token is not swept
    // again by the ceased-tokens state-based action, because exile is in that
    // sweep's skip list (`sba.ts`).
    //
    // `scope` turns the same primitive into a sweep. What changes is which
    // object the target names — the player rather than the permanent — and that
    // is why the group can be larger than one and can contain bodies a targeted
    // spell could not touch.
    apply: (effect, ctx) => {
      if (effect.scope !== undefined) {
        return overEffectScope(
          ctx.trace,
          effect.scope,
          undefined,
          ctx.target,
          ctx.controller,
          (current, oid) => moveObject(current, oid, 'exile'),
        );
      }
      const oid = permanentTarget(ctx.target);
      if (oid === null || tryObject(ctx.trace.state, oid) === undefined) return ctx.trace;
      return moveObject(ctx.trace, oid, 'exile');
    },
  },
  pumpUntilEndOfTurn: {
    recheck: 'printedMode',
    // `scope` turns the combat trick into Overrun, and this arm is the third
    // shape a sweep takes in this table — neither the per-member runner the
    // zone moves use nor the batched instance list damage uses, but **one**
    // continuous effect over a group.
    //
    // CR 609.2 is why it is one: an effect that affects a group affects the
    // group as it was when the spell resolved, so the members are read once and
    // frozen into the filter's `oids`. A creature that arrives later is not
    // pumped and a creature that leaves takes nothing with it, which is what a
    // per-member effect list would also give — but this way there is a single
    // timestamp, a single layer-7c entry and a single id for
    // `continuousEffectsExpired` to name at end of turn.
    //
    // The event stays one per affected object, because it is a narration event
    // ("X gets +3/+3 in layer 7c") and there is no wording for a group in the
    // replay log's schema. They share the effect's id, which is the truth: one
    // effect, several bodies.
    apply: (effect, ctx) => {
      const group = continuousEffectGroup(effect, ctx);
      if (group.length === 0) return ctx.trace;
      const id = continuousEffectId(ctx.trace.state.nextId);
      // CR 613.4c, layer 7c: modifies P/T without setting it. This is the one
      // continuous effect DSL v0 can emit, and it goes into the same list, in
      // the same layer, as every effect the kernel-level constructs in the
      // tests build — there is no second mechanism for it.
      const continuousEffect: ContinuousEffect = {
        id,
        kind: 'ptMod',
        layer: '7c',
        affects: objectFilter({ oids: [...group] }),
        power: ctx.number(effect.power),
        toughness: ctx.number(effect.toughness),
        duration: 'endOfTurn',
        timestamp: ctx.trace.state.nextId,
        sourceOid: ctx.sourceOid,
        // CR 611.2c: no DSL effect can print a condition on a pump; that is a
        // static ability's vocabulary (`enabledWhile`), not a resolved effect's.
        enabledWhile: null,
      };
      const state: GameState = {
        ...ctx.trace.state,
        nextId: ctx.trace.state.nextId + 1,
        continuous: [...ctx.trace.state.continuous, continuousEffect],
      };
      const pumped = group.reduce(
        (current, oid) =>
          emit(current, {
            type: 'continuousEffectAdded',
            id,
            targetOid: oid,
            power: continuousEffect.power,
            toughness: continuousEffect.toughness,
            layer: '7c',
          }),
        withState(ctx.trace, state),
      );
      // The keyword rider (`@mtg/dsl`'s `PUMP_KEYWORD_FIELD`), and it is a
      // second continuous effect rather than a wider first one: layer 6 and
      // layer 7c are different layers (CR 613.1f, CR 613.4c) and a
      // `ContinuousEffect` names exactly one. Two records, one resolution, one
      // chosen body — which is the whole of what the rider buys over writing a
      // pump and a grant side by side, since two *effects* would be two target
      // slots and two independently chosen creatures.
      //
      // Written over `group` rather than over `group[0]`, so the bodies the
      // keyword reaches are derived exactly once and cannot disagree with the
      // bodies the pump reached. The validator refuses the rider beside a
      // `scope`, so `group` is one body in every card that can reach here; this
      // arm does not restate that rule, because a kernel restating a
      // vocabulary rule is a second place for it to be wrong.
      const keyword = effect.keyword;
      if (keyword === undefined) return pumped;
      const keywordId = continuousEffectId(pumped.state.nextId);
      const granted: ContinuousEffect = {
        id: keywordId,
        kind: 'abilityChange',
        layer: '6',
        affects: objectFilter({ oids: [...group] }),
        addKeywords: [keyword],
        addKeywordAbilities: [],
        removeKeywords: [],
        removeAll: false,
        duration: 'endOfTurn',
        timestamp: pumped.state.nextId,
        sourceOid: ctx.sourceOid,
        enabledWhile: null,
      };
      const withKeyword = withState(pumped, {
        ...pumped.state,
        nextId: pumped.state.nextId + 1,
        continuous: [...pumped.state.continuous, granted],
      });
      return group.reduce(
        (current, oid) =>
          emit(current, {
            type: 'keywordGranted',
            id: keywordId,
            targetOid: oid,
            keyword,
            layer: '6',
          }),
        withKeyword,
      );
    },
  },
  drawCards: {
    recheck: 'printedMode',
    // `players` turns the same primitive into Temple Bell: it names everybody at
    // the table instead of one player, so the target slot goes unread and the
    // seats are walked in APNAP order (CR 101.4). Order is not cosmetic here --
    // two players drawing off their own libraries is two `drawCards` calls
    // against one RNG stream, so a kernel that walked seat order rather than
    // turn order would deal different cards on an odd turn than on an even one.
    apply: (effect, ctx) => {
      const count = ctx.number(effect.count);
      if (effect.players === undefined) {
        return drawCards(ctx.trace, playerTarget(ctx.target, ctx.controller), count);
      }
      return playersInSweep(ctx.trace.state, effect.players, ctx.controller).reduce(
        (current, player) => drawCards(current, player, count),
        ctx.trace,
      );
    },
  },
  gainLife: {
    recheck: 'printedMode',
    apply: (effect, ctx) =>
      gainLife(ctx.trace, playerTarget(ctx.target, ctx.controller), ctx.number(effect.amount), false),
  },
  revealHand: {
    recheck: 'printedMode',
    // CR 701.16a: showing the cards is the whole effect, and it is over the
    // moment it is done. One event carrying what was shown, and no state — a
    // `revealed` flag would be a lasting property the rules do not have, and
    // `seatEvent` letting this through unredacted is what makes the reveal a
    // reveal rather than a note in one player's log.
    apply: (_effect, ctx) => {
      const { target, trace } = ctx;
      if (target === null || target.kind !== 'player') return trace;
      return emit(trace, {
        type: 'handRevealed',
        player: target.player,
        oids: [...trace.state.players[target.player].hand],
      });
    },
  },
  // CR 701.19 is applied by the interruptible resolution runner, not by this
  // table — scrying involves a choice (order the top cards) that has to
  // suspend resolution and wait on a player, which `EFFECT_EXECUTION.apply`'s
  // synchronous `(effect, ctx) => Trace` signature cannot express. This row
  // exists so a `scry` primitive still type-checks against the table's total
  // map over `AnyEffectKind`; reaching `apply` here is a caller bug.
  scry: {
    recheck: 'untargeted',
    apply: () => {
      throw new Error('scry must be applied through the interruptible resolution runner');
    },
  },
  counterSpell: {
    recheck: 'spellOnStack',
    // CR 706.11: a copy has no last known information and cannot go to a
    // graveyard, because a copy is never in any zone the game tracks (it just
    // ceases to exist when it leaves the stack). `copiedSpell` is how a copy
    // is told apart from a countered original at this point: the original
    // still resolves the ordinary way (moved to its owner's graveyard), the
    // copy is simply removed from the stack.
    apply: (_effect, ctx) => {
      const { target, trace } = ctx;
      if (target === null || target.kind !== 'spell') return trace;
      const countered = emit(trace, { type: 'spellCountered', oid: target.oid, by: ctx.sourceOid });
      const entry = countered.state.stack.find((candidate) => candidate.oid === target.oid);
      if (entry?.copiedSpell !== undefined) {
        return withState(countered, {
          ...countered.state,
          stack: countered.state.stack.filter((candidate) => candidate.oid !== target.oid),
        });
      }
      return moveObject(countered, target.oid, 'graveyard');
    },
  },
  createToken: {
    recheck: 'untargeted',
    apply: (effect, ctx) => {
      let current = ctx.trace;
      const count = ctx.number(effect.count);
      for (let index = 0; index < count; index += 1) {
        current = createToken(current, ctx.controller, effect.token);
      }
      return current;
    },
  },
  tapPermanent: {
    recheck: 'printedMode',
    // "Tap all creatures target opponent controls", through the same runner the
    // scoped exile and the scoped destroy take. `tapObject` already no-ops on a
    // permanent that is tapped, so the sweep needs no arm for a board that is
    // half tapped already.
    //
    // The rider swaps the runner rather than adding a second pass, because the
    // hold has to reach a permanent the sweep found already tapped and a second
    // pass over the same scope would have to re-derive the group. `holdTapped`
    // is `tapObject` with that one difference and it says so.
    apply: (effect, ctx) => {
      const tap = effect.doesNotUntap === true ? holdTapped : tapObject;
      if (effect.scope !== undefined) {
        return overEffectScope(ctx.trace, effect.scope, effect.scopeFilter, ctx.target, ctx.controller, tap);
      }
      // A `TargetSpec.count` slot ("up to two target creatures", `mtg-kg44`)
      // resolves through `ctx.multiTarget` rather than `ctx.target`, which
      // `planResolution` leaves `null` for a counted slot — see
      // `ApplyContext.multiTarget`'s docblock. Each surviving member (CR
      // 608.2b already filtered these in `stack.ts`) is tapped in turn.
      if (ctx.multiTarget !== undefined) {
        let current = ctx.trace;
        for (const oid of ctx.multiTarget) {
          current = tap(current, oid);
        }
        return current;
      }
      const oid = permanentTarget(ctx.target);
      return oid === null ? ctx.trace : tap(ctx.trace, oid);
    },
  },
  returnToHand: {
    recheck: 'printedMode',
    apply: (_effect, ctx) => {
      const oid = permanentTarget(ctx.target);
      if (oid === null || tryObject(ctx.trace.state, oid) === undefined) return ctx.trace;
      return moveObject(ctx.trace, oid, 'hand');
    },
  },
  millCards: {
    recheck: 'printedMode',
    apply: (effect, ctx) =>
      millCards(ctx.trace, playerTarget(ctx.target, ctx.controller), ctx.number(effect.count)),
  },
  putCounters: {
    recheck: 'printedMode',
    // `scope` turns the same primitive into a sweeper, exactly as it does one
    // row up on `exileTarget`: unscoped it counts out counters onto the
    // permanent it named, scoped it reads a group off the *player* it named or
    // off a region of the board and does the same thing to every member.
    // `placeCounters` is one function rather than an inlined body and a loop, so
    // the group arm cannot drift from the single arm in what it does to an
    // object or in what it reports.
    //
    // The `scopeFilter` is passed through rather than dropped, which is what
    // makes Steel Overseer's own board readable at all: `permanentsYouControl`
    // names the region and the filter names the bodies, and an `undefined` here
    // would put a +1/+1 counter on every land the caster controls.
    apply: (effect, ctx) => {
      const count = ctx.number(effect.count);
      if (effect.scope !== undefined) {
        return overEffectScope(
          ctx.trace,
          effect.scope,
          effect.scopeFilter,
          ctx.target,
          ctx.controller,
          (current, oid) => placeCounters(current, oid, effect.counter, count),
        );
      }
      const oid = permanentTarget(ctx.target);
      return oid === null ? ctx.trace : placeCounters(ctx.trace, oid, effect.counter, count);
    },
  },
  returnFromGraveyard: {
    recheck: 'printedMode',
    // CR 400.7: each card leaves the graveyard and arrives on the battlefield as
    // a *new object*, and `moveObject` is what makes that true rather than
    // anything written here — it resets status, clears damage and counters,
    // marks the arrival summoning-sick and mints the arrival its enter-the-
    // battlefield triggers fire from. It is also what decides whose the creature
    // is: a card sitting in a graveyard is controlled by its owner, and
    // `moveObject` carries that controller onto the battlefield with it, so a
    // Blood Moon raises each player's dead for that player and needs no
    // control-changing machinery the DSL has no word for.
    //
    // The identity consequence is the one worth naming out loud, because
    // something outside the kernel reads it: an object's *copy number* is fixed
    // when the object comes into existence, and `@mtg/ui` paints a basic land's
    // illustration off it. A reanimated card is a new object with a new copy
    // number, which is the same answer CR 400.7 gives and the same answer a
    // replay of the game will give again.
    //
    // The `'hand'` arm is the same move with the destination changed, and the
    // CR 400.7 sentence above is why it needs no other difference: a card that
    // arrives in a hand is a new object there too, and every consequence the
    // battlefield arm spells out is `moveObject`'s rather than this row's.
    apply: (effect, ctx) =>
      overEffectScope(ctx.trace, effect.scope, undefined, ctx.target, ctx.controller, (current, oid) =>
        moveObject(current, oid, effect.destination === 'hand' ? 'hand' : 'battlefield'),
      ),
  },
  addMana: {
    recheck: 'untargeted',
    // The mana goes to `ctx.controller`, which is the ability's controller for
    // an activation and the caster for a ritual — CR 106.4's pool is per
    // player, and "add mana to target player's pool" is not a sentence Magic
    // prints, so there is no target to recheck.
    //
    // **Position zero is the color, and it is not a shortcut.** `produces` is a
    // choice list, and by the time an effect reaches here the choice is made:
    // `activateManaSource` narrows the list to the one color the activation
    // named before calling `applyEffect`, and `validate/mana-ability.ts`
    // refuses a spell that prints more than one color, because a resolving
    // spell has nobody to ask. So a list of one is what arrives on every path
    // — the empty case is unreachable through `CardEffectSchema`'s `min(1)`
    // and is handled rather than asserted, because `noUncheckedIndexedAccess`
    // is right that an array index is not a guarantee.
    //
    // No tap here. A ritual has nothing to turn sideways, and an ability's
    // source was tapped as its cost was paid; `addManaToPool` is the half of
    // `produceMana` that is only the mana, split out for exactly this.
    apply: (effect, ctx) => {
      const color = effect.produces[0];
      if (color === undefined) return ctx.trace;
      const amount = ctx.number(effect.amount);
      if (amount <= 0) return ctx.trace;
      return addManaToPool(ctx.trace, ctx.controller, ctx.sourceOid, color, amount);
    },
  },
  shuffleLibrary: {
    recheck: 'untargeted',
    // The one shuffle primitive, which is what keeps a game reproducible from
    // its seed: `shuffleLibrary` draws from `GameState.rng` and puts the
    // advanced generator back, so the shuffle is part of the position rather
    // than something that happened to it (`zones.ts` and `rng.ts` argue it).
    apply: (_effect, ctx) => shuffleLibrary(ctx.trace, ctx.controller),
  },
  revealTopCards: {
    recheck: 'untargeted',
    // Untargeted for the reason the DSL factory gives — it is always the
    // controller's own library — and `ctx.controller` is where that word comes
    // from, the same place `shuffleLibrary` above reads it.
    apply: (effect, ctx) => revealTopCards(ctx.trace, ctx.controller, effect.count),
  },
  putOnLibrary: {
    recheck: 'printedMode',
    apply: (effect, ctx) => {
      const oid = permanentTarget(ctx.target);
      if (oid === null || !isOnBattlefield(ctx.trace.state, oid)) return ctx.trace;
      return putOnLibrary(ctx.trace, oid, effect.position);
    },
  },
  exileGraveyard: {
    recheck: 'untargeted',
    // `'each'` is two calls rather than one pass over a merged list, because a
    // graveyard is a per-player array and merging them would invent an order
    // between two seats that no rule states. Owner order — this player, then
    // the other — is the order `players` is in, which is derived from the
    // position and therefore reproduces on replay.
    apply: (effect, ctx) => {
      const opponent = opponentOf(ctx.controller);
      if (effect.whose === 'you') return exileGraveyard(ctx.trace, ctx.controller);
      if (effect.whose === 'opponent') return exileGraveyard(ctx.trace, opponent);
      return exileGraveyard(exileGraveyard(ctx.trace, ctx.controller), opponent);
    },
  },
  shuffleGraveyardIntoLibrary: {
    recheck: 'untargeted',
    // The source is looked up rather than assumed to still be on the
    // battlefield: an ability whose cost sacrificed its own permanent resolves
    // with the object already in a graveyard, and Elixir's does not, so the one
    // thing this may not do is decide where the source is. `tryObject` returns
    // undefined for an object that has stopped existing at all — a token that
    // paid a cost and left as a state-based action — and the effect then does
    // the graveyard half alone rather than throwing on a card that printed a
    // legal sentence.
    apply: (effect, ctx) => {
      const extra =
        effect.includeSelf === true && tryObject(ctx.trace.state, ctx.sourceOid) !== undefined
          ? ctx.sourceOid
          : null;
      return shuffleGraveyardIntoLibrary(ctx.trace, ctx.controller, extra);
    },
  },
  // CR 701.19 is applied by the interruptible resolution runner for `scry`'s
  // stated reason, one row of this table over: choosing which card a search
  // finds is a decision a player owes mid-resolution, and
  // `EFFECT_EXECUTION.apply`'s synchronous `(effect, ctx) => Trace` signature
  // has nowhere to put a question. This row exists so the primitive still
  // type-checks against the table's total map over `AnyEffectKind`; reaching
  // `apply` here is a caller bug.
  searchLibrary: {
    recheck: 'untargeted',
    apply: () => {
      throw new Error('searchLibrary must be applied through the interruptible resolution runner');
    },
  },
  // CR 701.8's two discards are applied by the interruptible resolution runner
  // for the reason the two rows above give, with one addition: the choice is
  // owed by a seat that is not always the resolution's controller.
  // `chooseDiscard` asks the controller about the *opponent's* hand, so the
  // question cannot even be phrased inside `EFFECT_EXECUTION.apply`, whose
  // `ctx` names one controller and one target and has nowhere to put the
  // asymmetry. Both rows recheck `printedMode` rather than `untargeted`,
  // because unlike a scry or a search these effects do name a target and CR
  // 115.7 must be able to find it illegal — a discard whose player has left the
  // game does nothing, and `applyResolutionEffects` reads that as a null
  // target and moves on. Reaching `apply` here is a caller bug.
  discardCards: {
    recheck: 'printedMode',
    apply: () => {
      throw new Error('discardCards must be applied through the interruptible resolution runner');
    },
  },
  chooseDiscard: {
    recheck: 'printedMode',
    apply: () => {
      throw new Error('chooseDiscard must be applied through the interruptible resolution runner');
    },
  },
  // CR 701.17's edict, applied by the interruptible resolution runner for
  // `discardCards`' exact reason one row up: which of the target player's own
  // creatures leaves is that player's choice (CR 601.2h's converse), never the
  // caster's, so the question cannot be answered inside `EFFECT_EXECUTION`'s
  // synchronous `(effect, ctx) => Trace` signature. `recheck: 'printedMode'`
  // for the identical reason `discardCards` reads it rather than
  // `'untargeted'`: this effect does name a target, and CR 115.7 must be able
  // to find it illegal — a card whose named player has left the game
  // sacrifices nothing. Reaching `apply` here is a caller bug.
  sacrificePermanent: {
    recheck: 'printedMode',
    apply: () => {
      throw new Error('sacrificePermanent must be applied through the interruptible resolution runner');
    },
  },
  // Life loss, and the reason it is not `dealDamage` with a smaller table row:
  // damage is prevented, redirected, doubled, marked until cleanup and stopped
  // by protection, and a drain is none of those (CR 119.3). `life.ts` says the
  // rest.
  //
  // `players` is Howling Banshee, and it is `drawCards`' arm exactly: the loss
  // names everybody at the table instead of one seat, so the target slot goes
  // unread and `playersInSweep` walks APNAP order (CR 101.4). Order costs
  // nothing to observe here — no life loss reads a library — but it is the
  // order the rules put these in, and a state-based check between the two
  // losses is what makes it observable the day one of the seats is at 3.
  loseLife: {
    recheck: 'printedMode',
    apply: (effect, ctx) => {
      const amount = ctx.number(effect.amount);
      if (effect.players === undefined) {
        return loseLife(ctx.trace, playerTarget(ctx.target, ctx.controller), amount);
      }
      return playersInSweep(ctx.trace.state, effect.players, ctx.controller).reduce(
        (current, player) => loseLife(current, player, amount),
        ctx.trace,
      );
    },
  },
  // CR 118.5. Untargeted, so the player is always the controller — `setLife`
  // itself decides which direction this is and which reason it reports.
  setLife: {
    recheck: 'untargeted',
    apply: (effect, ctx) => setLife(ctx.trace, ctx.controller, ctx.number(effect.amount)),
  },
  // Fog (CR 615.1), and the whole of it is one registered replacement effect.
  //
  // Every field of the trigger is the "any" null except `combatOnly`, because
  // the printed card filters nothing else: all combat damage, whoever deals it
  // and whoever it is dealt to. `duration: 'endOfTurn'` is what makes "this
  // turn" true — `cleanupTurnEffects` (`turn.ts`) already sweeps replacements
  // by that duration, so this row registers a shield and nothing has to
  // remember to take it down.
  //
  // `preventDamage` with `amount: 'all'` rather than a pool: `consume`
  // (`replacement.ts`) retires a numeric shield once it is spent, and a Fog is
  // not spent by the first creature through — it stops the whole combat damage
  // step and the second one too.
  preventCombatDamage: {
    recheck: 'untargeted',
    apply: (_effect, ctx) => {
      const state = ctx.trace.state;
      const shield: ReplacementEffect = {
        id: preventionEffectId(state.nextId),
        sourceOid: ctx.sourceOid,
        controller: ctx.controller,
        timestamp: state.nextId,
        duration: 'endOfTurn',
        selfReplacement: false,
        trigger: {
          kind: 'damage',
          toPlayer: null,
          toPermanent: null,
          fromSource: null,
          combatOnly: true,
        },
        modification: { kind: 'preventDamage', amount: 'all' },
      };
      return withState(ctx.trace, {
        ...state,
        replacements: [...state.replacements, shield],
        nextId: state.nextId + 1,
      });
    },
  },
  // Dawn Charm's first mode, and the row above with two fields swapped rather
  // than a new primitive. `toPermanent` names the target's own object id
  // instead of `preventCombatDamage`'s `null`, so `triggerMatches` only ever
  // fires the shield for damage aimed at this one object — an object id that
  // has since left the battlefield matches nothing, so a creature that dies
  // mid-turn takes its own shield down with it, nothing here has to notice.
  // `combatOnly: false` is the other swap: the printed line says "all damage",
  // not "all combat damage", so a burn spell is stopped exactly as a blocker's
  // damage would be. `recheck: 'printedMode'` (CR 608.2b) rather than
  // `preventCombatDamage`'s `untargeted`, because this row has a target to
  // recheck and the others beside it that do (`destroyPermanent`,
  // `exileTarget`) all read the same way.
  preventAllDamageToTarget: {
    recheck: 'printedMode',
    apply: (_effect, ctx) => {
      const oid = permanentTarget(ctx.target);
      if (oid === null) return ctx.trace;
      const state = ctx.trace.state;
      const shield: ReplacementEffect = {
        id: preventionEffectId(state.nextId),
        sourceOid: ctx.sourceOid,
        controller: ctx.controller,
        timestamp: state.nextId,
        duration: 'endOfTurn',
        selfReplacement: false,
        trigger: {
          kind: 'damage',
          toPlayer: null,
          toPermanent: oid,
          fromSource: null,
          combatOnly: false,
        },
        modification: { kind: 'preventDamage', amount: 'all' },
      };
      return withState(ctx.trace, {
        ...state,
        replacements: [...state.replacements, shield],
        nextId: state.nextId + 1,
      });
    },
  },
  // `chooseFromGraveyard` is applied by the interruptible resolution runner for
  // `searchLibrary`'s stated reason: which card comes out of a graveyard is a
  // decision a player owes mid-resolution, and `apply`'s synchronous
  // `(effect, ctx) => Trace` signature has nowhere to put a question. This row
  // exists so the primitive still type-checks against the table's total map
  // over `AnyEffectKind`; reaching `apply` here is a caller bug.
  //
  // `untargeted` rather than `printedMode`, and it is the accurate answer
  // rather than a shortcut: the effect names a graveyard through an enum and
  // has no `target` field at all, so CR 115.7 has nothing to find illegal. The
  // check that corresponds to a target recheck is done at the pause instead —
  // the runner reads the matching cards when it stops and declines to stop when
  // there are none.
  chooseFromGraveyard: {
    recheck: 'untargeted',
    apply: () => {
      throw new Error('chooseFromGraveyard must be applied through the interruptible resolution runner');
    },
  },
  grantKeywordUntilEndOfTurn: {
    recheck: 'printedMode',
    // `pumpUntilEndOfTurn`'s arm one layer up, with the arithmetic swapped for
    // an ability: one continuous effect, one id, `duration: 'endOfTurn'`, and
    // one narration event per body. The differences are the two the layers
    // care about — layer 6 rather than 7c (CR 613.1f), and a record
    // `abilities.ts` already knows how to build from a printed `grantKeyword`,
    // so a granted keyword reads identically to `hasKeyword` whichever half of
    // the DSL granted it.
    //
    // `scope` turns the combat trick into the second half of Overwhelming
    // Stampede, and the group is read by the same `continuousEffectGroup` the
    // pump reads: the permanent it targeted, or the region of the board its
    // scope names. `SCOPES_LEGAL_ON` admits one scope here and it is a space
    // one, so a scoped grant chooses nobody (CR 115.1) and the group is the
    // caster's creatures as the spell resolves.
    //
    // One continuous effect over the whole group rather than one per body, for
    // the reason the pump arm gives at length: CR 609.2 fixes the affected set
    // at resolution, so the members are read once and frozen into the filter's
    // `oids`. A creature that arrives afterward is not granted the keyword —
    // CR 611.2c, and the whole difference between a one-shot's continuous
    // effect and a printed lord's static — and a creature that leaves takes
    // nothing with it. One timestamp, one layer-6 entry, one id for
    // `continuousEffectsExpired` to name at end of turn.
    //
    // The event stays one per affected object, sharing the effect's id, which
    // is `pumpUntilEndOfTurn`'s arrangement and the truth: one effect, several
    // bodies, and no wording for a group in the replay log's schema.
    //
    // `removeAll: false` and an empty `removeKeywords`, said outright rather
    // than spread from a default, because a layer-6 record that removes
    // abilities is a different card and this file should not be the place
    // somebody discovers which way the flag was pointing.
    //
    // Which of the two lists the name lands in is `isGrantableKeywordAbilityKind`'s
    // decision, and it is the same call `abilities.ts` makes for the printed
    // static — one reader for one question, so Cleaver Riot's one-shot and a
    // lord's printed line cannot disagree about where double strike lives.
    // Writing it into `addKeywords` instead compiles and renders and exports,
    // and then every rule that consumes it reads the wrong list:
    // `hasKeywordAbility` is what `combat.ts` asks at the first-strike step and
    // what the CR 704.5g sweep asks, and neither looks at `keywords`.
    apply: (effect, ctx) => {
      const group = continuousEffectGroup(effect, ctx);
      if (group.length === 0) return ctx.trace;
      const id = continuousEffectId(ctx.trace.state.nextId);
      const granted = isGrantableKeywordAbilityKind(effect.keyword)
        ? { addKeywords: [], addKeywordAbilities: [{ kind: effect.keyword }] }
        : { addKeywords: [effect.keyword], addKeywordAbilities: [] };
      const continuousEffect: ContinuousEffect = {
        id,
        kind: 'abilityChange',
        layer: '6',
        affects: objectFilter({ oids: [...group] }),
        ...granted,
        removeKeywords: [],
        removeAll: false,
        duration: 'endOfTurn',
        timestamp: ctx.trace.state.nextId,
        sourceOid: ctx.sourceOid,
        // CR 611.2c, and `pumpUntilEndOfTurn`'s reason verbatim: a condition on
        // a grant is a static ability's vocabulary, not a resolved effect's.
        enabledWhile: null,
      };
      const state: GameState = {
        ...ctx.trace.state,
        nextId: ctx.trace.state.nextId + 1,
        continuous: [...ctx.trace.state.continuous, continuousEffect],
      };
      return group.reduce(
        (current, oid) =>
          emit(current, {
            type: 'keywordGranted',
            id,
            targetOid: oid,
            keyword: effect.keyword,
            layer: '6',
          }),
        withState(ctx.trace, state),
      );
    },
  },
  // The two turn-scoped CR 508/509 rules. Both write one record into
  // `state.turnCombatRules` (`state.ts` argues why that array exists rather
  // than a `ContinuousEffect` member or a duration on the static) and neither
  // emits an event, following `preventAllDamageToTarget` above: what changed is
  // a legality, and the log already shows the legality's consequence when the
  // declaration is made.
  //
  // `recheck: 'printedMode'` for both, the same answer `grantKeywordUntilEndOfTurn`
  // gives: each has a target, so CR 608.2b has something to find illegal, and a
  // creature that left the battlefield between announcement and resolution
  // should not pick up a rule.
  cantBeBlockedThisTurn: {
    recheck: 'printedMode',
    apply: (_effect, ctx) => {
      const oid = permanentTarget(ctx.target);
      if (oid === null) return ctx.trace;
      const state = ctx.trace.state;
      return withState(ctx.trace, {
        ...state,
        turnCombatRules: [
          ...state.turnCombatRules,
          { rule: 'cantBeBlockedThisTurn', sourceOid: ctx.sourceOid, subject: oid },
        ],
      });
    },
  },
  // `ctx.controller` is CR 109.5's "you" — the controller of the ability that
  // is resolving — and it is read here, once, rather than off the source later.
  // That is the whole reason `TurnCombatRule` stores a player instead of
  // deriving one: the requirement names whoever controlled the Siren when it
  // resolved, and a Siren that changes hands afterwards does not redirect it.
  attacksYouThisTurnIfAble: {
    recheck: 'printedMode',
    apply: (_effect, ctx) => {
      const oid = permanentTarget(ctx.target);
      if (oid === null) return ctx.trace;
      const state = ctx.trace.state;
      return withState(ctx.trace, {
        ...state,
        turnCombatRules: [
          ...state.turnCombatRules,
          {
            rule: 'attacksYouThisTurnIfAble',
            sourceOid: ctx.sourceOid,
            subject: oid,
            defender: ctx.controller,
          },
        ],
      });
    },
  },
  untapPermanent: {
    recheck: 'printedMode',
    // `untapObject` and nothing else. It no-ops on a permanent that is already
    // untapped, so an effect that arrives after somebody else untapped the
    // target reports nothing rather than emitting a second `permanentUntapped`
    // for a turn that never happened -- which is `tapObject`'s arrangement one
    // row down, read the other way.
    //
    // No sweep arm and no counted arm, because the schema offers neither: this
    // kind carries no `scope`, and `TARGET_COUNT_EFFECT_KINDS` names the tap
    // alone. Adding either here would be an arm nothing can reach, and an
    // unreachable arm is where the two definitions of an effect start to drift.
    apply: (_effect, ctx) => {
      const oid = permanentTarget(ctx.target);
      return oid === null ? ctx.trace : untapObject(ctx.trace, oid);
    },
  },
  // CR 701.17, and `sacrificePermanent` rather than `destroyPermanent` is the
  // whole of it: a sacrifice ignores indestructible and does not spend a
  // regeneration shield, because it raises no destroy event for either to
  // answer. `destruction.ts` states that at length beside the function that
  // does honor them.
  //
  // `permanentTarget` returns the source itself here. The schema admits only
  // `selfCreature` and `selfPermanent`, `planResolution` fills a source-body
  // target from the ability's own `sourceOid`, and it drops the effect outright
  // when the source has already left the battlefield -- so the `null` arm is
  // the ordinary CR 608.2b case of a subject that is no longer there, not a
  // card aimed somewhere unexpected.
  //
  // The sacrificing player is the permanent's controller, which CR 701.17a
  // fixes: no other player may sacrifice it. Read off the object rather than
  // taken from `ctx.controller` so a permanent that changed hands after its
  // ability triggered is still sacrificed by whoever holds it now.
  sacrificeSelf: {
    recheck: 'printedMode',
    apply: (_effect, ctx) => {
      const oid = permanentTarget(ctx.target);
      if (oid === null) return ctx.trace;
      return sacrificePermanent(ctx.trace, oid, controllerOf(ctx.trace.state, oid));
    },
  },
  // Diminish (M11 52), and the arm is `pumpUntilEndOfTurn`'s with one field
  // changed and one layer changed. That one layer is the entire card.
  //
  // CR 613.4b sets, CR 613.4c modifies, and they are applied in that order, so
  // `ptSet` over `ptMod` is not a spelling choice: a 5/5 given base 1/1 and
  // then +2/+2 is 3/3, and the same board written as a `-4/-4` `ptMod` is 3/3
  // only until something else touches the creature. A +1/+1 counter (7d) and a
  // `statBonusPer` static (7c) both apply *after* this record whatever its
  // timestamp, and both apply after a delta only when the timestamps happen to
  // fall that way. `packages/kernel/test/base-pt-layer.test.ts` measures the
  // boards the two spellings produce rather than asserting the layer.
  //
  // No `continuousEffectGroup` call: the kind carries no `scope`
  // (`@mtg/dsl`'s factory states why), so the group is the one permanent the
  // spell targeted or nothing at all.
  //
  // One `continuousEffectAdded` event, sharing the record's id, which is the
  // pump's arrangement. The `power` and `toughness` it carries are the base
  // values rather than deltas and the `layer` field is what says so — the
  // narrator branches on it (`@mtg/ui`'s `narrate.ts`), because "gets +1/+1"
  // is a false sentence about a layer-7b record.
  setBasePtUntilEndOfTurn: {
    recheck: 'printedMode',
    apply: (effect, ctx) => {
      const oid = permanentTarget(ctx.target);
      if (oid === null) return ctx.trace;
      const id = continuousEffectId(ctx.trace.state.nextId);
      const continuousEffect: ContinuousEffect = {
        id,
        kind: 'ptSet',
        layer: '7b',
        affects: objectFilter({ oids: [oid] }),
        power: effect.power,
        toughness: effect.toughness,
        duration: 'endOfTurn',
        timestamp: ctx.trace.state.nextId,
        sourceOid: ctx.sourceOid,
        // The pump arm's reason verbatim: a condition on a resolved effect is a
        // static ability's vocabulary, not a one-shot's.
        enabledWhile: null,
      };
      const state: GameState = {
        ...ctx.trace.state,
        nextId: ctx.trace.state.nextId + 1,
        continuous: [...ctx.trace.state.continuous, continuousEffect],
      };
      return emit(withState(ctx.trace, state), {
        type: 'continuousEffectAdded',
        id,
        targetOid: oid,
        power: continuousEffect.power,
        toughness: continuousEffect.toughness,
        // Read off the record rather than written again, which is what makes
        // the narration a fact about the record instead of a second claim
        // beside it: a rewrite of this arm that changed the layer and left the
        // literal behind would log a 7b set the game never wrote.
        layer: continuousEffect.layer,
      });
    },
  },
};

/**
 * Puts `count` counters of one kind on one object, and reports the move.
 *
 * The zone recheck is not belt-and-braces: `putCounters` may be aimed at a
 * permanent that has left the battlefield since the ability went on the stack,
 * and a counter on a card in a graveyard is a fact CR 611.2c gives no meaning
 * to.
 */
function placeCounters(trace: Trace, oid: ObjectId, kind: CounterKind, count: number): Trace {
  const object = tryObject(trace.state, oid);
  if (object === undefined || object.zone !== 'battlefield') return trace;
  const counters = addCounters(object.counters, kind, count);
  const state: GameState = {
    ...trace.state,
    objects: { ...trace.state.objects, [oid]: { ...object, counters } },
  };
  const placed = withState(trace, state);
  // `countersChanged` reports the +1/+1 and -1/-1 totals and nothing else,
  // so a kind that moves neither has nothing to say through it and stays
  // silent rather than emitting an event whose numbers did not move. The
  // event that names a counter kind is `mtg-bc2.132.8`'s follow-up, and it
  // is a change to the replay log schema in `@mtg/ui` as much as to this
  // file.
  if (
    counters.plusOnePlusOne === object.counters.plusOnePlusOne &&
    counters.minusOneMinusOne === object.counters.minusOneMinusOne
  ) {
    return placed;
  }
  return emit(placed, {
    type: 'countersChanged',
    oid,
    plusOnePlusOne: counters.plusOnePlusOne,
    minusOneMinusOne: counters.minusOneMinusOne,
  });
}

/**
 * Applies one resolved effect. Targets have already been rechecked.
 *
 * `x` is the spell's chosen X, read back off the `StackEntry` that resolved
 * (`readonly x: number | null` — `state.ts`'s docblock on the field says why
 * an ability never carries one). It never reaches `evaluateAmount`: a
 * `chosenX` `Amount` is answered here, in the closure, because the value is a
 * fact about which spell is resolving rather than a fact `evaluateAmount` can
 * derive from the board `trace.state` describes.
 *
 * `before` is what this resolution had already done when a scry or a search
 * paused it, and it is `NOTHING_TALLIED` for every resolution that was never
 * paused — which is every caller but `scry.ts`. See `ResolutionMark` for why
 * the mark cannot carry it.
 */
export function applyEffect(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  effect: Effect,
  target: Target | null,
  since: ResolutionMark,
  x: number | null = null,
  before: ResolutionTally = NOTHING_TALLIED,
  multiTarget?: readonly ObjectId[],
): Trace {
  const ctx: ApplyContext = {
    trace,
    sourceOid,
    controller,
    target,
    since,
    x,
    // `exactOptionalPropertyTypes` refuses an explicit `undefined` for an
    // optional field, so an absent `multiTarget` argument has to omit the key
    // rather than set it — the same conditional-spread shape the rest of this
    // file already uses for optional context fields.
    ...(multiTarget !== undefined ? { multiTarget } : {}),
    number: (amount) => {
      if (!isLiteralAmount(amount) && amount.kind === 'chosenX') {
        if (x === null) throw new Error('chosen-X amount resolved without an X spell value');
        return x;
      }
      return evaluateAmount(trace, amount, since, controller, before);
    },
  };
  const execution: EffectExecutionRow = EFFECT_EXECUTION[effect.kind];
  // The one assertion in this file. `EFFECT_EXECUTION` is keyed by the same
  // discriminant `effect` carries, so `execution` is by construction the row for
  // `effect.kind` and its `apply` takes exactly this effect; TypeScript cannot
  // correlate the two across an index lookup. Each row's `apply` is still
  // checked against its own effect shape at the definition site above, which is
  // where a mistake would actually be made.
  const run = execution.apply as (e: Effect, c: ApplyContext) => Trace;
  return run(effect, ctx);
}
