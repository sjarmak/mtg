/**
 * CR 613.8: dependency ordering inside a layer.
 *
 * ## Attribution
 *
 * The pass below is a *design* ported from Argentum (MIT,
 * <https://github.com/wingedsheep/argentum-engine>),
 * `docs/continuous-effect-dependency-system.md`, which is the reference design
 * this ADR names for exactly this problem. XMage (MIT,
 * <https://github.com/magefree/mage>) solves it a different way — each effect
 * declares `dependencyTypes` / `dependentToTypes` sets and dependency is a set
 * intersection — and that alternative is why this file computes the relation
 * instead of declaring it; see "Why counterfactual" below. No code was copied
 * from either project.
 *
 * ## The rule
 *
 * CR 613.8a. Effect A *depends on* effect B when all three hold:
 *   (a) they apply in the same layer and sublayer;
 *   (b) applying B first would change what A applies to, or what A does to any
 *       of the things it applies to, or A's text or existence;
 *   (c) neither is from a characteristic-defining ability, or both are.
 * Otherwise A is independent of B.
 *
 * CR 613.8b. An effect that depends on others applies after all of them.
 * Repeat the check after each application, because applying one effect can
 * dissolve or create a dependency.
 *
 * CR 613.8c. If dependencies form a loop, ignore them all and use timestamp
 * order for the effects in the loop.
 *
 * ## Why counterfactual rather than declared
 *
 * XMage's declared-dependency-type approach is fast and needs no re-evaluation,
 * but it is a hand-maintained approximation: every new effect kind has to
 * remember to declare which characteristic classes it reads and writes, and a
 * missed declaration is a silent wrong answer that only shows up on an exotic
 * board. Clause (b) of 613.8a is *literally* a counterfactual — "would applying
 * the other change what this one does" — and because `continuous.ts` makes an
 * effect's behavior a pure function of the characteristics computed so far, we
 * can just evaluate it. The signature of an effect is the set of changes it
 * would make; compute it with and without the other effect applied and compare.
 *
 * The cost is O(n^2) signature computations for the n effects in one layer,
 * with n being the number of continuous effects sharing a layer on one
 * battlefield. The fast paths matter more than the asymptotics: a layer with
 * one effect skips the pass entirely, which is every layer in a slice game.
 */
import type { CharacteristicMap, Characteristics, LayerContext } from './characteristics';
import { affectedByEffect, applyEffect, applyEffectTo } from './characteristics';
import type { ContinuousEffect } from './continuous';
import { isCharacteristicDefining } from './continuous';
import type { ObjectId } from './ids';
import { canonicalJson } from '@mtg/dsl';

/**
 * Stable ordering for effects the rules leave interchangeable: timestamp first
 * (CR 613.7), then id, so a tie can never depend on array order.
 */
function byTimestamp(a: ContinuousEffect, b: ContinuousEffect): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * What this effect *applies to* and what it *does*, as a comparable value.
 *
 * Two knobs, matching the two halves of 613.8a clause (b), and the split
 * between them is the whole correctness of this test:
 *
 *  - **What it applies to** is read from `evaluated`, the board as it stands in
 *    the branch being tested. If applying the other effect changed the set, the
 *    signature changes and the dependency is real.
 *  - **What it does** is computed against inputs taken from `base` — the board
 *    *before* either effect ran — so it measures the effect's operation rather
 *    than the accumulated difference. Only `evaluated` is used for the things
 *    an effect computes from the board (a characteristic-defining count, a copy
 *    source), so an operation whose parameters really do move still shows up.
 *
 * Holding the inputs fixed is what keeps "loses all abilities" independent of
 * "gains vigilance". Applying the grant first changes what the removal
 * *observably strips*, but not what it does: set the ability list to empty,
 * either way. Under the rules those two resolve by timestamp, and comparing
 * observed deltas instead of operations would wrongly force the removal last.
 */
function signatureOf(base: LayerContext, evaluated: LayerContext, effect: ContinuousEffect): string {
  const affected = affectedByEffect(evaluated, effect);
  const changes: string[] = [];
  for (const oid of affected) {
    const input = base.map.get(oid) ?? evaluated.map.get(oid);
    if (input === undefined) continue;
    const output = applyEffectTo(input, effect, evaluated);
    const delta = diff(oid, input, output);
    if (delta !== null) changes.push(delta);
  }
  // The affected set is part of the signature even where nothing changed:
  // "applies to X and does nothing" and "does not apply to X" are different
  // facts under clause (b).
  return JSON.stringify([affected, changes]);
}

/** A canonical description of what changed, or `null` when nothing did. */
function diff(oid: ObjectId, before: Characteristics, after: Characteristics): string | null {
  const parts: string[] = [];
  if (before.name !== after.name) parts.push(`name=${after.name}`);
  if (before.power !== after.power) parts.push(`p${after.power - before.power}`);
  if (before.toughness !== after.toughness) parts.push(`t${after.toughness - before.toughness}`);
  if (before.controller !== after.controller) parts.push(`ctl=${after.controller}`);
  pushListDiff(parts, 'kw', before.keywords, after.keywords);
  pushListDiff(
    parts,
    'kwa',
    before.keywordAbilities.map((ability) => canonicalJson(ability)),
    after.keywordAbilities.map((ability) => canonicalJson(ability)),
  );
  pushListDiff(parts, 'col', before.colors, after.colors);
  pushListDiff(parts, 'typ', before.cardTypes, after.cardTypes);
  pushListDiff(parts, 'sub', before.subtypes, after.subtypes);
  pushListDiff(parts, 'sup', before.supertypes, after.supertypes);
  return parts.length === 0 ? null : `${oid}:${parts.join(',')}`;
}

function pushListDiff(
  parts: string[],
  label: string,
  before: readonly string[],
  after: readonly string[],
): void {
  const added = after.filter((value) => !before.includes(value));
  const removed = before.filter((value) => !after.includes(value));
  if (added.length > 0) parts.push(`+${label}:${[...added].sort().join('|')}`);
  if (removed.length > 0) parts.push(`-${label}:${[...removed].sort().join('|')}`);
}

/** CR 613.8a: does `effect` depend on `other` given this board? */
function dependsOn(context: LayerContext, effect: ContinuousEffect, other: ContinuousEffect): boolean {
  if (effect.id === other.id) return false;
  if (effect.layer !== other.layer) return false;
  if (isCharacteristicDefining(effect) !== isCharacteristicDefining(other)) return false;
  const afterOther: LayerContext = { ...context, map: applyEffect(context, other) };
  return signatureOf(context, context, effect) !== signatureOf(context, afterOther, effect);
}

/**
 * Orders the effects of one layer per CR 613.8, returning them in the order
 * they should be applied.
 *
 * The loop re-derives dependencies against the *current* partial board after
 * each application (613.8b's "check again"), so an effect whose dependency
 * dissolved once its predecessor applied is free to go next.
 */
export function orderLayer(
  start: LayerContext,
  effects: readonly ContinuousEffect[],
): readonly ContinuousEffect[] {
  if (effects.length < 2) return effects;

  const remaining = [...effects].sort(byTimestamp);
  const ordered: ContinuousEffect[] = [];
  let context = start;

  while (remaining.length > 0) {
    const index = remaining.findIndex(
      (candidate) => !remaining.some((other) => dependsOn(context, candidate, other)),
    );
    if (index === -1) {
      // CR 613.8c: every remaining effect is in a dependency loop. Ignore the
      // dependencies and finish in timestamp order.
      ordered.push(...remaining);
      return ordered;
    }
    const [next] = remaining.splice(index, 1);
    if (next === undefined) throw new Error('orderLayer: splice returned nothing');
    ordered.push(next);
    context = { ...context, map: applyEffect(context, next) };
  }
  return ordered;
}

/**
 * The dependency relation over one layer, for tests and for explaining an
 * ordering. Keys and values are effect ids: `graph.get(a)` is everything `a`
 * depends on, so `a` applies after all of them.
 */
export function dependencyGraph(
  context: LayerContext,
  effects: readonly ContinuousEffect[],
): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, readonly string[]>();
  for (const effect of effects) {
    graph.set(
      effect.id,
      effects.filter((other) => dependsOn(context, effect, other)).map((other) => other.id),
    );
  }
  return graph;
}

/** Ordering used when no dependency applies; exported so tests can contrast. */
export function timestampOrder(effects: readonly ContinuousEffect[]): readonly ContinuousEffect[] {
  return [...effects].sort(byTimestamp);
}

export type { CharacteristicMap };
