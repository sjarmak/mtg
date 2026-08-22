/**
 * The stack: putting spells on it, and resolving them LIFO.
 *
 * Targets are chosen when the spell is put on the stack and rechecked when it
 * resolves (CR 608.2b): a spell whose every target has become illegal doesn't
 * resolve at all, and an individual illegal target only skips its own effect.
 */
import type { AttachingAbility, Card, Effect } from '@mtg/dsl';
import {
  effectsFor,
  hasAbilityEffects,
  hasTarget,
  isAttachingAbility,
  isAuraCard,
  isOptionalTrigger,
  isPermanentCard,
  isReferentTarget,
  isRegenerationAbility,
  isSourceBodyOnlyTarget,
  referentSourceIndex,
  targetCountOf,
} from '@mtg/dsl';
import { attachAuraTo, attachTo, isLegalAuraHost, isLegalHost } from './attach';
import type { ObjectId, PlayerId } from './ids';
import { isTargetStillLegal, survivingMultipleTargets } from './effects';
import { applyResolutionEffects } from './scry';
import { abilityObjectId, copiedSpellObjectId } from './ids';
import { mayChooser } from './may-choice';
import { executePayment, planPayment } from './mana';
import { spellAwaitingUnless } from './unless-choice';
import type { AbilityOnStack, GameState, SourceCharacteristics, StackEntry, Target } from './state';
import type { Trace } from './trace';
import { emit, withState } from './trace';
import { withTurn } from './turn';
import { getObject, moveObject, tryObject } from './zones';
import { createRegenerationShield } from './destruction';
import { canBeTargetedBy } from './keyword-abilities';
import { controllerOf } from './layers';

export function topOfStack(state: GameState): StackEntry | undefined {
  return state.stack[state.stack.length - 1];
}

/**
 * Moves a card from hand onto the stack with its chosen targets, and its
 * chosen mode if it has one (CR 700.2), locked in.
 *
 * `mode` is `null` rather than `undefined` for the same reason `ability` is:
 * `StackEntry` is plain state that must `structuredClone` and fingerprint
 * cleanly, and `null` is this codebase's spelling for "fixed, and there is no
 * such choice on this card" (`state.ts`'s `attachedTo` states the same
 * convention). A non-modal card's entry always carries `mode: null`, which is
 * what lets `@mtg/dsl`'s `effectsFor(card, entry.mode)` read every spell's
 * effect list through one call, modal or not.
 */
export function pushSpell(
  trace: Trace,
  player: PlayerId,
  oid: ObjectId,
  targets: readonly (Target | null)[],
  mode: number | null,
  x: number | null,
  multiTargets?: Readonly<Record<number, readonly ObjectId[]>>,
): Trace {
  const moved = moveObject(trace, oid, 'stack');
  const object = getObject(moved.state, oid);
  const state: GameState = {
    ...moved.state,
    objects: { ...moved.state.objects, [oid]: { ...object, controller: player } },
    stack: [
      ...moved.state.stack,
      {
        oid,
        controller: player,
        targets,
        ...(multiTargets !== undefined ? { multiTargets } : {}),
        ability: null,
        mode,
        triggerContext: null,
        x,
        sourceCharacteristics: null,
      },
    ],
  };
  return emit(withState(moved, state), { type: 'spellCast', player, oid, targets, chosenX: x });
}

/**
 * Copies one instant or sorcery already on the stack.
 *
 * This is deliberately the state/event seam only: no DSL effect exposes it
 * yet. Copying is not casting, so no payment or `spellCast` event occurs; the
 * independent stack object retains the original targets and chosen X.
 */
export function copySpellOnStack(trace: Trace, originalOid: ObjectId): Trace {
  const original = trace.state.stack.find((entry) => entry.oid === originalOid);
  if (original === undefined || original.ability !== null) {
    throw new Error(`${originalOid} is not a spell on the stack`);
  }
  const sourceObject = original.copiedSpell === undefined ? tryObject(trace.state, original.oid) : undefined;
  const card = original.copiedSpell?.card ?? sourceObject?.card;
  if (card === undefined || (card.kind !== 'instant' && card.kind !== 'sorcery')) {
    throw new Error(`${originalOid} is not an instant or sorcery spell`);
  }
  const oid = copiedSpellObjectId(trace.state.nextId);
  const sourceOid = original.copiedSpell?.sourceOid ?? original.oid;
  const entry: StackEntry = {
    oid,
    controller: original.controller,
    targets: [...original.targets],
    ability: null,
    mode: original.mode,
    triggerContext: null,
    x: original.x,
    sourceCharacteristics: null,
    copiedSpell: { card, copiedFrom: original.oid, sourceOid },
  };
  const pushed = withState(trace, {
    ...trace.state,
    nextId: trace.state.nextId + 1,
    stack: [...trace.state.stack, entry],
  });
  return emit(pushed, {
    type: 'spellCopied',
    player: entry.controller,
    oid,
    copiedFrom: original.oid,
    targets: entry.targets,
    chosenX: entry.x,
  });
}

/**
 * Puts an activated ability on the stack as an object of its own (CR 113.7a).
 *
 * The id is minted from the same monotonic counter every other id comes from,
 * so an ability object can never collide with a card, and `ab7` in a log line
 * is visibly not a card. No `GameObject` is created: an ability on the stack is
 * an object without a card, which is why `resolveTop` branches on
 * `entry.ability` before it looks one up.
 *
 * The same shape `putTriggersOnStack` builds, with one difference that is the
 * whole of CR 601.2c: the targets were chosen by the player who activated it
 * and travel in the action, where a trigger's list is always empty.
 *
 * `abilityActivated` is emitted here rather than in the reducer for the reason
 * `spellCast` is emitted in `pushSpell`: the id the event reports is minted on
 * this line, and an event assembled anywhere else would be quoting a number it
 * had to be told.
 *
 * `x` is the value announced for the cost's `{X}` (CR 601.2b through CR
 * 602.2b), or `null` for the overwhelming majority of abilities, which print no
 * X. It arrives already paid: the reducer resolves it into the cost and charges
 * that before this function is reached, so the number banked here is a record
 * of what happened rather than a promise about what will. `applyResolution`
 * reads it back off the entry the same way it does for a cast spell, which is
 * why an activation needed no second field on `StackEntry`.
 */
export function pushAbility(
  trace: Trace,
  player: PlayerId,
  sourceOid: ObjectId,
  index: number,
  targets: readonly (Target | null)[],
  sourceCharacteristics: SourceCharacteristics,
  x: number | null,
): Trace {
  const state = trace.state;
  const oid = abilityObjectId(state.nextId);
  const entry: StackEntry = {
    oid,
    controller: player,
    targets,
    ability: { sourceOid, index },
    mode: null,
    triggerContext: null,
    x,
    sourceCharacteristics,
  };
  const pushed = withState(trace, {
    ...state,
    nextId: state.nextId + 1,
    stack: [...state.stack, entry],
  });
  return emit(pushed, {
    type: 'abilityActivated',
    player,
    oid,
    source: sourceOid,
    index,
    targets,
    chosenX: x,
  });
}

interface ResolutionPlan {
  readonly effects: readonly {
    readonly index: number;
    readonly effect: Effect;
    readonly target: Target | null;
    /** Surviving members for a counted slot; see `StackEntry.multiTargets`. */
    readonly multiTarget?: readonly ObjectId[];
  }[];
  readonly illegal: readonly { readonly index: number; readonly reason: string }[];
  readonly hadTargets: boolean;
  /**
   * Whether any one of those targets survived the recheck.
   *
   * Counted separately from `effects` because CR 608.2b asks about the word
   * "target" and not about the instruction list: "Destroy target artifact or
   * enchantment. You gain 4 life" keeps a life gain in `effects` whether or
   * not the artifact is still there, and a plan that read its own length would
   * conclude the spell still had something to do.
   */
  readonly keptTargets: boolean;
}

/**
 * Which of an object's effects still have a legal target, and which do not
 * (CR 608.2b). Written over an effect list because a spell's list and an
 * ability's are rechecked by identical rules — `isTargetStillLegal` never
 * learns which it is looking at, because the recorded target is all it needs.
 */
function planResolution(state: GameState, effects: readonly Effect[], entry: StackEntry): ResolutionPlan {
  const kept: {
    index: number;
    effect: Effect;
    target: Target | null;
    multiTarget?: readonly ObjectId[];
  }[] = [];
  const illegal: { index: number; reason: string }[] = [];
  let hadTargets = false;
  let keptTargets = false;
  for (const [index, effect] of effects.entries()) {
    if (hasTarget(effect) && effect.target.kind === 'triggeringCreature') {
      // Any retained referent answers the slot: `TriggerContext` exists only
      // for conditions that retain one, so the presence of a context is the
      // whole question and its `kind` is not read here.
      const context = entry.triggerContext;
      if (context === null) continue;
      const object = tryObject(state, context.triggeringCreature);
      if (object === undefined || object.zone !== 'battlefield') continue;
      kept.push({
        index,
        effect,
        target: { kind: 'permanent', oid: context.triggeringCreature },
      });
      continue;
    }
    if (hasTarget(effect) && isSourceBodyOnlyTarget(effect.target.kind)) {
      // Retained from the ability itself rather than from an event —
      // `entry.ability` is null only for a resolving spell, and a spell
      // cannot carry either of these kinds (`checkEffectTarget` refuses the
      // whole list), so the source is always present here in practice; the
      // `?.` is defensive rather than a documented escape hatch.
      //
      // One branch for both members, because what it does is read an oid and
      // check the object is still on the battlefield, and neither step asks
      // what card type that object has. `selfPermanent` (`mtg-rji`) needed no
      // kernel work at all beyond being named here: the CR 608.2b-shaped
      // fallback below — a source that has left the battlefield makes the
      // effect a no-op rather than an illegal one — is already the right
      // answer for a Trisigil artifact that got destroyed in response to its
      // own upkeep trigger.
      const sourceOid = entry.ability?.sourceOid;
      if (sourceOid === undefined) continue;
      const object = tryObject(state, sourceOid);
      if (object === undefined || object.zone !== 'battlefield') continue;
      kept.push({
        index,
        effect,
        target: { kind: 'permanent', oid: sourceOid },
      });
      continue;
    }
    if (hasTarget(effect) && isReferentTarget(effect.target.kind)) {
      // The third kind of retained referent, and the only one retained from
      // *this same effect list* (`mtg-nhyv.75`). Which slot it reads is derived
      // by `referentSourceIndex` (`@mtg/dsl`), the identical call
      // `checkReferentTargets` makes at validation time — so a card that
      // validated has exactly one earlier chooser here, and the two ends cannot
      // disagree about which slot the printed phrase names. The `null` guard is
      // defensive for the reason the source-body branch above has one: the
      // validator has already refused the shape that produces it.
      //
      // Nothing here touches `hadTargets` or `keptTargets`. A back-reference is
      // not a target (CR 115.1 — the caster chose one object, once), so CR
      // 608.2b must not count it: Chandra's Outrage has exactly one target, and
      // counting the referent as a second would make the spell resolve its
      // damage-to-controller half after the creature had left, which is the
      // opposite of what the rules and the printed card do.
      const sourceIndex = referentSourceIndex(effects, index);
      if (sourceIndex === null) continue;
      const chooser = effects[sourceIndex];
      if (chooser === undefined) continue;
      // The referent inherits the earlier slot's CR 608.2b verdict rather than
      // getting its own. If the chosen creature is no longer a legal target the
      // phrase has nothing to name, so the effect is dropped — and on a card
      // whose only target was that creature the spell has already fizzled by
      // the time this matters, because that slot's own recheck below is what
      // sets `keptTargets`.
      if (
        !isTargetStillLegal(
          state,
          chooser,
          entry.targets,
          sourceIndex,
          entry.controller,
          targetingSource(state, entry),
        )
      ) {
        continue;
      }
      const referred = entry.targets[sourceIndex] ?? null;
      if (referred === null) continue;
      if (effect.target.kind === 'thatCreaturesController') {
        // The one projection in this branch, and it lives here rather than in
        // the effect arms: `dealDamage` takes a `Target` and CR 120.3 lets that
        // be a player or an object, so filling the slot with the player is what
        // keeps "read the controller off this object" out of every primitive
        // that can name a person. A player-kind chooser cannot reach this arm —
        // `referentSourceSpace` asks for a creature slot — so a non-permanent
        // referent here is a validator bug rather than a case to guess at.
        if (referred.kind !== 'permanent') continue;
        kept.push({
          index,
          effect,
          target: { kind: 'player', player: controllerOf(state, referred.oid) },
        });
        continue;
      }
      kept.push({ index, effect, target: referred });
      continue;
    }
    if (hasTarget(effect) && targetCountOf(effect.target) !== null) {
      // A `TargetSpec.count` slot ("up to two target creatures", `mtg-kg44`)
      // is CR 608.2b's partial-survivor case: each chosen member is
      // rechecked on its own, and whichever survive are what the effect
      // applies to. It is never `illegal` here, even at zero survivors —
      // "nothing to tap" is the same shape `tapPermanent`'s apply already
      // gives a targetless call, not a fizzle for the illustrated log to
      // report as one.
      const members = entry.multiTargets?.[index] ?? [];
      if (members.length > 0) hadTargets = true;
      const survivors = survivingMultipleTargets(
        state,
        effect,
        members,
        entry.controller,
        targetingSource(state, entry),
      );
      if (survivors.length > 0) keptTargets = true;
      kept.push({ index, effect, target: null, multiTarget: survivors });
      continue;
    }
    const target = entry.targets[index] ?? null;
    if (target !== null) hadTargets = true;
    if (
      isTargetStillLegal(state, effect, entry.targets, index, entry.controller, targetingSource(state, entry))
    ) {
      kept.push({ index, effect, target });
      if (target !== null) keptTargets = true;
    } else {
      illegal.push({ index, reason: 'target is no longer legal' });
    }
  }
  return { effects: kept, illegal, hadTargets, keptTargets };
}

/** The characteristics a target sees from a spell or ability on the stack. */
function targetingSource(state: GameState, entry: StackEntry): ObjectId | Card | SourceCharacteristics {
  if (entry.copiedSpell !== undefined) return entry.copiedSpell.card;
  const sourceOid = entry.ability?.sourceOid;
  if (sourceOid === undefined) return entry.oid;
  if (state.objects[sourceOid]?.zone === 'battlefield') return sourceOid;
  return entry.sourceCharacteristics ?? sourceOid;
}

/**
 * Resolves an ability on the stack (CR 608.2m): its effects happen and then it
 * simply ceases to exist. There is no zone move, because an ability on the
 * stack was never in a zone anything else can hold.
 *
 * The printed text is read off the source's card at resolution, and the source
 * may have left the battlefield since — CR 608.2 resolves the ability anyway,
 * which is the whole point of a death trigger and of an activation the opponent
 * answered by killing the permanent. The case that does nothing is a source
 * whose printed ability carries no effects, which is a static; no DSL card can
 * put one on the stack, and it is a total lookup rather than a cast so that it
 * cannot become a crash if one ever can.
 *
 * Targets are rechecked here, and both kinds go through the same check for the
 * same reason. A trigger's list was chosen as it was put on the stack (CR
 * 603.3d) and an activation's when the player paid for it (CR 601.2c); CR
 * 608.2b removes the whole ability when every one of those targets has since
 * become illegal — the whole ability, so an instruction on the same ability
 * that named no target is removed with it rather than resolving alone.
 *
 * ## The one place resolution stops
 *
 * An optional trigger (CR 603.3b) asks its controller here, and the question is
 * asked *after* the target recheck rather than before it. An ability whose
 * every target has gone is removed by CR 608.2b before its controller is ever
 * asked anything, and asking first would offer a player a choice between two
 * identical futures — a "may" they can only answer wrong.
 *
 * Nothing is emitted at the stop and the entry stays exactly where it is, so
 * the answer resumes the resolution rather than repeating it: `resolveAnswered`
 * below is the same tail this function runs, reached from `reduce.ts` with the
 * answer in hand. That is what keeps `resolutionBegan` at one per resolution.
 */
function resolveAbility(trace: Trace, entry: StackEntry, ability: AbilityOnStack): Trace {
  const source = tryObject(trace.state, ability.sourceOid);
  const printed = source?.card.abilities[ability.index];
  if (printed !== undefined && isRegenerationAbility(printed)) {
    const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
    return createRegenerationShield(popStackEntry(began, entry.oid), ability.sourceOid, entry.controller);
  }
  if (printed === undefined || !hasAbilityEffects(printed)) {
    return popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
  }
  const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
  if (isAttachingAbility(printed)) return resolveAttach(began, entry, ability.sourceOid, printed);

  const plan = planResolution(trace.state, printed.effects, entry);
  if (isOptionalTrigger(printed) && !fizzled(plan)) return awaitOptionalTrigger(trace, entry);
  return applyResolution(began, entry, ability, plan);
}

/**
 * CR 608.2b: it had targets, and not one of them is legal any more.
 *
 * The rule is written over the targets rather than over the instructions, and
 * the difference is a whole spell: Solemn Offering's life gain names no target,
 * so a test that asked whether any instruction survived would resolve the gain
 * on a spell the rules never resolve at all.
 */
function fizzled(plan: ResolutionPlan): boolean {
  return plan.hadTargets && !plan.keptTargets;
}

/**
 * Hands the game back so the controller can answer a "you may".
 *
 * `priority` is left exactly as `onPass` set it. A resolution happens with
 * nobody holding priority, and the player who gets it afterwards (CR 117.3b, the
 * active player) is granted it by whoever finishes the resolution — which is
 * `reduce.ts`'s answer handler rather than `onPass`, since `onPass` is returning
 * early with the question outstanding.
 */
function awaitOptionalTrigger(trace: Trace, entry: StackEntry): Trace {
  return withState(
    trace,
    withTurn(trace.state, { awaiting: 'optionalTrigger', awaitingPlayer: entry.controller }),
  );
}

/**
 * The tail of an ability resolution: report the skipped effects, leave the
 * stack, and apply what is left.
 *
 * Split out so an optional trigger that was accepted runs the same code an
 * ordinary one does. A second copy would be a second set of rules about when
 * `effectSkipped` is emitted and when the entry leaves the stack.
 *
 * `entry.x` is passed where a hardcoded `null` used to be. That constant was
 * true for as long as no ability could announce an X, and `mtg-nhyv.17` made it
 * false: Silklash Spider's damage is a `chosenX` amount, `applyEffect` answers
 * one out of the value threaded here, and a `null` reaching it throws rather
 * than deals zero. A trigger still passes `null` and always will, because it
 * has no cost to announce anything against — the field says which, so this line
 * does not have to ask.
 */
function applyResolution(
  trace: Trace,
  entry: StackEntry,
  ability: AbilityOnStack,
  plan: ResolutionPlan,
): Trace {
  let current = trace;
  for (const skipped of plan.illegal) {
    current = emit(current, {
      type: 'effectSkipped',
      oid: entry.oid,
      index: skipped.index,
      why: skipped.reason,
    });
  }
  current = popStackEntry(current, entry.oid);
  // CR 608.2b takes the whole ability, so an instruction that named no target
  // does not happen either. The skips above are already the log of why.
  if (fizzled(plan)) return current;
  // Where this resolution starts in the event log. An effect that counts what
  // the resolution has already done ("the number of cards exiled this way")
  // reads the span from here, and it is taken after the skips and the pop so
  // that the span holds the effects and nothing else.
  return applyResolutionEffects(current, ability.sourceOid, entry.controller, plan.effects, entry.x, null);
}

/**
 * Finishes the resolution of the optional trigger on top of the stack, with the
 * answer its controller gave (CR 603.3b).
 *
 * Accepting resolves the ability exactly as a mandatory trigger resolves.
 * Declining removes it and says so: `triggerDeclined` is the record that the
 * ability was on the stack, was answered, and did nothing — a fact no other
 * event in the log carries, and the difference between a declined trigger and a
 * trigger that never fired.
 *
 * The plan is recomputed rather than carried across the stop, and it cannot have
 * moved: the only action the kernel will accept while this question stands is
 * the answer to it (`validateAction`), so no state change can have happened in
 * between.
 */
export function resolveAnswered(trace: Trace, accept: boolean): Trace {
  const entry = topOfStack(trace.state);
  const ability = entry?.ability;
  if (entry === undefined || ability === undefined || ability === null) return trace;
  if (!accept) {
    const declined = emit(trace, {
      type: 'triggerDeclined',
      oid: entry.oid,
      source: ability.sourceOid,
    });
    return popStackEntry(declined, entry.oid);
  }
  const printed = tryObject(trace.state, ability.sourceOid)?.card.abilities[ability.index];
  const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
  if (printed === undefined || !hasAbilityEffects(printed)) return popStackEntry(began, entry.oid);
  return applyResolution(began, entry, ability, planResolution(trace.state, printed.effects, entry));
}

/**
 * Resolves an equip ability (CR 702.6b): the source becomes attached to the
 * creature the player chose when they paid for it.
 *
 * The target is rechecked here for the reason every other target is (CR
 * 608.2b): the creature may have died, stopped being a creature or changed
 * hands while the ability waited, and an ability whose only target has become
 * illegal does not resolve. `isLegalHost` is the check the enumeration and
 * `validateActivation` already used, so all three agree by construction.
 *
 * The source is checked too, and that is not the same question: CR 701.3a
 * attaches a *permanent*, so a weapon that left the battlefield in response
 * attaches nothing. The skip is reported as `effectSkipped` at index 0 rather
 * than through a new event, because the attachment is this ability's only slot
 * and a replay reading "skipped, target is no longer legal" is exactly what
 * happened.
 */
function resolveAttach(
  trace: Trace,
  entry: StackEntry,
  sourceOid: ObjectId,
  ability: AttachingAbility,
): Trace {
  const target = entry.targets[0] ?? null;
  const host = target !== null && target.kind === 'permanent' ? target.oid : null;
  const source = tryObject(trace.state, sourceOid);
  const legal =
    host !== null &&
    source !== undefined &&
    source.zone === 'battlefield' &&
    isLegalHost(trace.state, entry.controller, host, sourceOid);
  if (!legal) {
    const skipped = emit(trace, {
      type: 'effectSkipped',
      oid: entry.oid,
      index: 0,
      why: 'target is no longer legal',
    });
    return popStackEntry(skipped, entry.oid);
  }
  return attachTo(popStackEntry(trace, entry.oid), sourceOid, host, ability);
}

/**
 * Resolves the top object of the stack. Permanent spells enter the
 * battlefield; instants and sorceries apply their effects and go to the
 * graveyard; a triggered ability runs its effects and stops existing.
 *
 * ## The one place a spell's resolution stops
 *
 * A "you may" spell (CR 601.2c) asks its named chooser here, mirroring
 * `resolveAbility`'s optional-trigger stop exactly (see its docblock): the
 * question is asked *after* the target recheck, because a spell whose every
 * target is gone fizzles under CR 608.2b before anyone is asked anything, and
 * `resolutionBegan` is not emitted for the pause — it is emitted once, either
 * here on an unconditional spell or in `resolveMayAnswered` when the answer
 * comes back "yes", so a "you may" spell's resolution starts exactly once
 * however it is answered.
 */
export function resolveTop(trace: Trace): Trace {
  const entry = topOfStack(trace.state);
  if (entry === undefined) return trace;
  if (entry.ability !== null) return resolveAbility(trace, entry, entry.ability);
  const object = entry.copiedSpell === undefined ? getObject(trace.state, entry.oid) : null;
  const card = entry.copiedSpell?.card ?? object?.card;
  if (card === undefined) throw new Error(`spell ${entry.oid} has no card`);

  const isPermanentSpell = isPermanentCard(card);
  if (isPermanentSpell) {
    if (object === null) throw new Error('a copied permanent spell is outside this stack primitive');
    if (isAuraCard(card)) {
      const target = entry.targets[0] ?? null;
      const legal =
        target !== null &&
        target.kind === 'permanent' &&
        isLegalAuraHost(trace.state, card, target.oid) &&
        canBeTargetedBy(trace.state, target.oid, entry.oid, entry.controller);
      if (!legal) {
        const fizzledTrace = emit(trace, { type: 'spellFizzled', oid: entry.oid });
        const popped = popStackEntry(fizzledTrace, entry.oid);
        return moveObject(popped, entry.oid, 'graveyard');
      }
      const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
      const popped = popStackEntry(began, entry.oid);
      const moved = moveObject(popped, entry.oid, 'battlefield');
      return attachAuraTo(moved, entry.oid, target.oid);
    }
    const current = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
    return moveObject(current, entry.oid, 'battlefield');
  }

  const plan = planResolution(trace.state, effectsFor(card, entry.mode), entry);
  if (!fizzled(plan)) {
    if (card.may !== undefined) return awaitMay(trace, mayChooser(card.may, entry.controller));
    const tolled = spellAwaitingUnless(trace.state);
    if (tolled !== null) return awaitUnless(trace, tolled.payer);
  }
  const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
  return finishSpellResolution(began, entry, plan);
}

/**
 * The tail of a spell resolution: fizzle outright if every targeted effect's
 * target is gone (CR 608.2b, checked first — a fizzled spell never gets to
 * ask its "you may" either), or report the skipped effects, leave the stack
 * and apply what remains.
 *
 * Split out so a "you may" spell that was accepted (`resolveMayAnswered`)
 * runs the same code an unconditional spell does, the reason
 * `applyResolution` is split out from `resolveAbility` for abilities.
 */
function finishSpellResolution(trace: Trace, entry: StackEntry, plan: ResolutionPlan): Trace {
  const isCopy = entry.copiedSpell !== undefined;
  if (fizzled(plan)) {
    const declared = emit(trace, { type: 'spellFizzled', oid: entry.oid });
    const popped = popStackEntry(declared, entry.oid);
    return isCopy ? popped : moveObject(popped, entry.oid, 'graveyard');
  }
  let current = trace;
  for (const skipped of plan.illegal) {
    current = emit(current, {
      type: 'effectSkipped',
      oid: entry.oid,
      index: skipped.index,
      why: skipped.reason,
    });
  }
  // The spell leaves the stack before its effects run, so a spell that copies
  // or counts the stack sees the same thing the rules say it sees.
  current = popStackEntry(current, entry.oid);
  return applyResolutionEffects(
    current,
    entry.oid,
    entry.controller,
    plan.effects,
    entry.x,
    isCopy ? null : entry.oid,
  );
}

/**
 * Hands the game back so the named chooser can answer a spell's "you may".
 * `awaitOptionalTrigger`'s shape, for a spell rather than a triggered
 * ability — see that function's docblock for why `priority` is left alone.
 *
 * Takes the chooser directly rather than an entry to read `controller` off
 * of, unlike `awaitOptionalTrigger`: CR 601.2c's chooser is not always the
 * spell's controller (an opponent-choice card asks the opponent), so the
 * caller has already resolved `card.may` through `mayChooser` by the time
 * this runs, and there is nothing left here to derive from the entry itself.
 */
function awaitMay(trace: Trace, chooser: PlayerId): Trace {
  return withState(trace, withTurn(trace.state, { awaiting: 'may', awaitingPlayer: chooser }));
}

/**
 * Hands the game back so the player a spell is aimed at can answer its toll
 * (CR 118.8). `awaitMay`'s shape, and it takes the payer for `awaitMay`'s
 * reason one step further: the seat is not on the card at all, it is read off
 * the entry's targets, so the caller has already resolved it through
 * `spellAwaitingUnless` and there is nothing here left to derive.
 */
function awaitUnless(trace: Trace, payer: PlayerId): Trace {
  return withState(trace, withTurn(trace.state, { awaiting: 'unless', awaitingPlayer: payer }));
}

/**
 * Finishes the resolution of the "you may" spell on top of the stack, with
 * the answer its chooser gave (CR 601.2c). Mirrors `resolveAnswered` exactly,
 * for a spell rather than a triggered ability: declining pops it with a
 * record that it was asked and said no (`spellDeclined`) and sends it to the
 * graveyard — a spell, unlike an ability, was always a card in a zone, so
 * unlike `triggerDeclined` this has a zone to move to. Accepting resolves it
 * exactly as an unconditional spell resolves. Both arms read the card and the
 * departure zone past `entry.copiedSpell` first, for `resolveTop`'s reason: a
 * copy has no object in the table and no graveyard to be sent to.
 *
 * `player` is passed in rather than recomputed, because it was already
 * validated against the pending decision's chooser before this is called
 * (`validateAction`'s generic `decision.player !== action.player` guard); a
 * second `mayChooser` call here would only recompute a fact already checked.
 *
 * The plan is recomputed rather than carried across the stop, and it cannot
 * have moved, for the reason `resolveAnswered` gives: the only action the
 * kernel will accept while this question stands is the answer to it.
 */
export function resolveMayAnswered(trace: Trace, player: PlayerId, accept: boolean): Trace {
  const entry = topOfStack(trace.state);
  if (entry === undefined) return trace;
  if (!accept) {
    const declined = emit(trace, { type: 'spellDeclined', oid: entry.oid, player });
    const popped = popStackEntry(declined, entry.oid);
    return entry.copiedSpell === undefined ? moveObject(popped, entry.oid, 'graveyard') : popped;
  }
  const card = entry.copiedSpell?.card ?? getObject(trace.state, entry.oid).card;
  const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
  const plan = planResolution(trace.state, effectsFor(card, entry.mode), entry);
  return finishSpellResolution(began, entry, plan);
}

/**
 * Finishes the resolution of the tolled spell on top of the stack, with the
 * answer its payer gave (CR 118.8).
 *
 * `resolveMayAnswered`'s shape, and the two answers land the two ways that
 * function's do. Declining runs the spell exactly as an untolled spell runs,
 * which is the whole point of the clause: the toll bought nothing, so the
 * printed effect happens. Paying charges the mana, records `unlessPaid` and
 * sends the card to the graveyard without a `resolutionBegan` — the same
 * choice `resolveMayAnswered` makes for a declined "you may", and for the same
 * reason: `resolutionBegan` is the marker that a spell's effects are about to
 * run, and here they are not.
 *
 * The plan and the payer are both recomputed rather than carried across the
 * stop. `resolveMayAnswered`'s reason covers the plan (the only action the
 * kernel accepts while the question stands is the answer to it), and the payer
 * needs it more, not less: `validateUnless` re-derives the same seat from the
 * same board, so an agent holding a stale decision cannot pay a toll on behalf
 * of a player who is no longer the one being charged.
 *
 * A payment plan that comes back `null` throws rather than silently resolving
 * the spell. `spellAwaitingUnless` refuses to ask a player who cannot pay, and
 * nothing between the question and the answer can change what they can pay, so
 * a `null` here is a broken invariant and not a player who ran out of mana.
 */
export function resolveUnlessAnswered(trace: Trace, player: PlayerId, pay: boolean): Trace {
  const entry = topOfStack(trace.state);
  if (entry === undefined) return trace;
  // `entry.copiedSpell` first, for `resolveTop`'s reason: a copied spell has no
  // object in the table, and a copy prints the toll the original printed.
  const card = entry.copiedSpell?.card ?? getObject(trace.state, entry.oid).card;
  if (!pay) {
    const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
    const plan = planResolution(trace.state, effectsFor(card, entry.mode), entry);
    return finishSpellResolution(began, entry, plan);
  }
  const clause = card.unless;
  if (clause === undefined) throw new Error(`spell ${entry.oid} prints no "unless" clause to pay`);
  const payment = planPayment(trace.state, player, clause.cost);
  if (payment === null) throw new Error(`${player} cannot pay the toll on ${entry.oid}`);
  const paid = executePayment(trace, player, clause.cost, payment);
  const recorded = emit(paid, { type: 'unlessPaid', oid: entry.oid, player });
  const popped = popStackEntry(recorded, entry.oid);
  // A copy is not a card and has no graveyard to go to; it ceases to exist
  // where a real spell is moved (CR 707.10), which is `finishSpellResolution`'s
  // `isCopy` branch said once more for the path that never reaches it.
  return entry.copiedSpell === undefined ? moveObject(popped, entry.oid, 'graveyard') : popped;
}

/**
 * Removes an entry from the stack list. The object keeps `zone: 'stack'` until
 * `moveObject` places it, so the move still reports the right origin zone.
 */
function popStackEntry(trace: Trace, oid: ObjectId): Trace {
  return withState(trace, {
    ...trace.state,
    stack: trace.state.stack.filter((entry) => entry.oid !== oid),
  });
}
