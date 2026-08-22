/**
 * Attachment: which permanent an Equipment is attached to, and what being
 * attached is worth.
 *
 * Four rules and no subsystem, which is Decision 12 of
 * the set design document ("attachment is for the named weapons
 * only, roughly eight cards") written as code.
 *
 *  - CR 702.6b: `Equip [cost]` attaches its source to target creature you
 *    control, at sorcery speed. `legal.ts` enumerates and refuses it; the
 *    attaching itself is `attachTo` below, called when the ability resolves.
 *  - CR 613: what an equipped creature gets is one `ContinuousEffect` per
 *    printed modification, each with `affects` naming that creature and each
 *    built by `effectForModification` — the same function a printed static
 *    ability goes through. There is no attachment-aware branch anywhere in the
 *    layer walk, and that is the whole reason this file is short. A weapon
 *    granting a keyword *and* a stat bonus therefore registers a layer-6 record
 *    and a layer-7c one, and the walk applies them in that order whatever order
 *    the card listed them in, because `computeAll` iterates `LAYER_ORDER` and
 *    never `state.continuous`.
 *  - CR 701.3c: attaching to a new permanent unattaches from the old one, so
 *    `attachTo` starts by unattaching.
 *  - CR 301.5c and 704.5m: an Equipment attached to something that is not a
 *    creature it can legally be attached to becomes unattached and stays on the
 *    battlefield. `illegalAttachments` is the predicate; `sba.ts` runs it.
 *
 * ## Why the effect is rewritten rather than made dynamic
 *
 * `ObjectFilter` is evaluated against the characteristics computed so far and
 * is handed no state (`characteristics.ts`), so it cannot ask "whatever this
 * source is currently attached to". Registering a fresh record on each
 * attachment is the alternative, and it is also what CR 613.7d asks for: an
 * Equipment receives a new timestamp each time it becomes attached, which is
 * exactly what a record minted from `nextId` at that moment carries.
 *
 * ## Why no event is emitted when a weapon is equipped
 *
 * `registerStatics` emits none either: a continuous effect appearing because a
 * permanent's printed text says so is not a game event, and the replay already
 * carries the `activateAbility` that caused it, with its chosen target. The
 * unattachment does emit `continuousEffectsExpired`, because that is what
 * happened and the event already exists for it.
 */
import type { AttachingAbility, AuraModification, Card } from '@mtg/dsl';
import { isAuraCard, isStaticAuraModification } from '@mtg/dsl';
import { effectForModification } from './abilities';
import type { AbilityChangeEffect, ContinuousEffect, ControlEffect } from './continuous';
import { onlyObject } from './continuous';
import type { ObjectId, PlayerId } from './ids';
import { continuousEffectId } from './ids';
import { controllerOf, isCreatureObject } from './layers';
import { isProtectedFrom } from './keyword-abilities';
import type { GameObject, GameState } from './state';
import type { Trace } from './trace';
import { emit, putObject, withState } from './trace';

/**
 * Deliberately not `zones.getObject`: `zones.ts` clears an attachment on every
 * zone change and therefore imports this module, so reading the object record
 * directly is what keeps that a one-directional dependency instead of a cycle.
 * `layers.ts` does the same thing for the same reason.
 */
function objectAt(state: GameState, oid: ObjectId): GameObject {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`unknown game object: ${oid}`);
  return object;
}

/** What this permanent is attached to, or `undefined` when it is attached to nothing. */
export function attachmentOf(state: GameState, oid: ObjectId): ObjectId | undefined {
  return state.objects[oid]?.attachedTo;
}

/**
 * The same object attached to nothing.
 *
 * The one owner of dropping the key rather than writing `undefined` into it:
 * `exactOptionalPropertyTypes` treats those as different objects, and a stored
 * `undefined` would canonicalize as a field that a state written before
 * attachment existed does not have.
 */
export function detached(object: GameObject): GameObject {
  if (object.attachedTo === undefined) return object;
  const { attachedTo: _attached, ...rest } = object;
  return rest;
}

/** Effects one source registered that end when its attachment does. */
function attachmentEffects(state: GameState, equipment: ObjectId): readonly ContinuousEffect[] {
  return state.continuous.filter(
    (effect) => effect.sourceOid === equipment && effect.duration === 'whileAttached',
  );
}

/**
 * CR 301.5c: the Equipment becomes unattached and remains on the battlefield.
 *
 * A no-op when it was attached to nothing and registered nothing, so every
 * caller can call it unconditionally — the state-based action sweep, the second
 * equip of the same weapon, and `attachTo` itself.
 */
export function unattach(trace: Trace, equipment: ObjectId): Trace {
  const object = objectAt(trace.state, equipment);
  const expired = attachmentEffects(trace.state, equipment);
  if (object.attachedTo === undefined && expired.length === 0) return trace;
  const state: GameState = {
    ...putObject(trace.state, detached(object)),
    continuous: trace.state.continuous.filter((effect) => !expired.includes(effect)),
  };
  const next = withState(trace, state);
  if (expired.length === 0) return next;
  return emit(next, { type: 'continuousEffectsExpired', ids: expired.map((effect) => effect.id) });
}

/**
 * CR 701.3a: the Equipment becomes attached to the creature, and CR 701.3c
 * unattaches it from whatever it was attached to before.
 *
 * The timestamps and the effect ids come from `nextId` at this moment, which is
 * CR 613.7d's "a new timestamp each time it becomes attached". One board can
 * currently tell: layer 6 orders a grant against a "loses all abilities" by
 * timestamp, so a weapon equipped after the removal keeps granting and one
 * stamped when it entered would not. Layer 7c cannot tell, because both P/T
 * modifications DSL v1 expresses are additive.
 *
 * A clause with two modifications mints one id and one timestamp per record,
 * the way `staticEffectsFor` does for a permanent entering with two static
 * abilities. Consecutive rather than shared, because an id has to be unique and
 * the two are minted from the same counter; consecutive timestamps a moment
 * apart order the same way a shared one would against anything registered
 * before or after the equip, and the two records are in different layers, so
 * nothing compares them to each other.
 *
 * Registration order is the card's printed order and it decides nothing. Which
 * record applies first is `LAYER_ORDER` in `layers.ts`, so a granted keyword
 * (layer 6) lands before a stat bonus (layer 7c) even on a card that prints the
 * bonus first.
 */
export function attachTo(
  trace: Trace,
  equipment: ObjectId,
  host: ObjectId,
  ability: AttachingAbility,
): Trace {
  const dropped = unattach(trace, equipment);
  let counter = dropped.state.nextId;
  const effects: ContinuousEffect[] = [];
  for (const modification of ability.attach.modifications) {
    effects.push(
      effectForModification(modification, {
        id: continuousEffectId(counter),
        timestamp: counter,
        sourceOid: equipment,
        duration: 'whileAttached',
        affects: onlyObject(host),
        // CR 611.2c: no `AttachingAbility` in the DSL carries a condition, so an
        // equip clause's effects are always unconditional.
        enabledWhile: null,
      }),
    );
    counter += 1;
  }
  const attached: GameObject = { ...objectAt(dropped.state, equipment), attachedTo: host };
  const state: GameState = {
    ...putObject(dropped.state, attached),
    nextId: counter,
    continuous: [...dropped.state.continuous, ...effects],
  };
  return withState(dropped, state);
}

/** Whether this card's bounded Aura restriction permits this host right now. */
export function isLegalAuraHost(state: GameState, aura: Card, host: ObjectId): boolean {
  if (!isAuraCard(aura)) return false;
  const object = state.objects[host];
  return object !== undefined && object.zone === 'battlefield' && isCreatureObject(state, host);
}

/**
 * Resolves a creature Aura onto its chosen host. Static changes reuse the same
 * continuous-effect compiler as Equipment; combat restrictions stay on the
 * card and are queried from the attachment relation.
 */
export function attachAuraTo(trace: Trace, auraOid: ObjectId, host: ObjectId): Trace {
  const source = objectAt(trace.state, auraOid);
  if (!isAuraCard(source.card)) throw new Error(`${source.card.name} is not an Aura`);
  const dropped = unattach(trace, auraOid);
  let counter = dropped.state.nextId;
  const effects: ContinuousEffect[] = [];
  for (const modification of source.card.aura.modifications) {
    const common = {
      id: continuousEffectId(counter),
      timestamp: counter,
      sourceOid: auraOid,
      duration: 'whileAttached' as const,
      affects: onlyObject(host),
      // CR 611.2c: `AuraModificationSchema` carries no condition either, so an
      // Aura's granted effects are unconditional for the same reason an equip
      // clause's are.
      enabledWhile: null,
    };
    if (isStaticAuraModification(modification)) {
      effects.push(effectForModification(modification, common));
    } else if (modification.kind === 'grantLandwalk') {
      const effect: AbilityChangeEffect = {
        ...common,
        kind: 'abilityChange',
        layer: '6',
        addKeywords: [],
        addKeywordAbilities: [{ kind: 'landwalk', landType: modification.landType }],
        removeKeywords: [],
        removeAll: false,
      };
      effects.push(effect);
    } else if (modification.kind === 'gainControl') {
      // CR 613.1b, and the layer walk needed nothing for it: `ControlEffect`
      // has existed since `continuous.ts` was written and `controllerOf` is
      // already the one reader every control-sensitive question in the kernel
      // goes through. What was missing was a card that could say it.
      //
      // The controller is read once, here, and that is a known bound rather
      // than the rule: Magic's "you" on Mind Control means the Aura's
      // controller continuously, so an effect that took control of the *Aura*
      // would move the creature too, and this record would not follow. Nothing
      // in this vocabulary takes control of an enchantment - `gainControl` is
      // an Aura clause and an Aura is not a legal host for one - so the case
      // is unreachable from any card the DSL can build today, and a record
      // that re-derived its controller every layer walk would be a second
      // mechanism for a case no card reaches.
      const effect: ControlEffect = {
        ...common,
        kind: 'control',
        layer: '2',
        controller: controllerOf(dropped.state, auraOid),
      };
      effects.push(effect);
    } else {
      continue;
    }
    counter += 1;
  }
  const attached: GameObject = { ...objectAt(dropped.state, auraOid), attachedTo: host };
  return withState(dropped, {
    ...putObject(dropped.state, attached),
    nextId: counter,
    continuous: [...dropped.state.continuous, ...effects],
  });
}

/** True when a battlefield Aura attached to `host` prints this restriction. */
export function hasAuraModification(
  state: GameState,
  host: ObjectId,
  kind: AuraModification['kind'],
): boolean {
  return state.battlefield.some((oid) => {
    const source = state.objects[oid];
    return (
      source !== undefined &&
      source.attachedTo === host &&
      isAuraCard(source.card) &&
      source.card.aura.modifications.some((modification) => modification.kind === kind)
    );
  });
}

/**
 * Whether a permanent is a legal thing for this player to equip.
 *
 * CR 702.6b names a creature its controller controls, and both halves are read
 * through the layer system: an animated artifact is a legal host and a creature
 * whose type was stripped is not, and a control-change effect moves the answer
 * with the permanent. One owner, because the enumeration, the legality check
 * and the resolution recheck (CR 608.2b) all have to agree about it.
 */
export function isLegalHost(
  state: GameState,
  controller: PlayerId,
  host: ObjectId,
  sourceOid?: ObjectId,
): boolean {
  const object = state.objects[host];
  if (object === undefined || object.zone !== 'battlefield') return false;
  return (
    isCreatureObject(state, host) &&
    controllerOf(state, host) === controller &&
    (sourceOid === undefined || !isProtectedFrom(state, host, sourceOid))
  );
}

/**
 * Every Equipment on the battlefield whose attachment has become illegal.
 *
 * CR 704.5m is one predicate over the host and one over the Equipment itself.
 * The host must still be there and must still be a creature, which is CR 301.5c
 * ("a permanent that stops being a creature") and the dead-creature case
 * together: both are "the thing it is attached to is not a creature on the
 * battlefield", asked through the layer system rather than the printed card.
 * Control is deliberately not part of it — an Equipment stays attached to a
 * creature whose control changed, and only the equip ability names a
 * controller.
 *
 * The Equipment being a creature itself is CR 301.5e, and it is here rather
 * than only in the activation check because a layer-4 effect can animate a
 * weapon that is already attached, which no activation runs through.
 */
export function illegalAttachments(state: GameState): readonly ObjectId[] {
  return state.battlefield.filter((oid) => {
    const source = state.objects[oid];
    if (source === undefined) return false;
    const host = attachmentOf(state, oid);
    if (isAuraCard(source.card)) {
      return (
        host === undefined || !isLegalAuraHost(state, source.card, host) || isProtectedFrom(state, host, oid)
      );
    }
    if (host === undefined) return false;
    if (isCreatureObject(state, oid)) return true;
    const object = state.objects[host];
    return (
      object === undefined ||
      object.zone !== 'battlefield' ||
      !isCreatureObject(state, host) ||
      isProtectedFrom(state, host, oid)
    );
  });
}
