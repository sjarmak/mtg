/**
 * Static abilities, end to end: a printed CR 113 ability becomes continuous
 * effects, those effects are resolved by the CR 613 layer walk that was already
 * here, and they exist exactly while their source is on the battlefield.
 *
 * The point of most of these assertions is *which machinery answered*. A lord
 * that buffs could be a lord the layer system resolved or a special case
 * somebody wrote beside it, and the two are indistinguishable from `powerOf`
 * alone — so the effects are read back through `effectsApplyingTo`, which
 * reports the CR 613 application order, and one test makes the buff depend on a
 * type-changing effect, which only comes out right if `orderLayer`'s CR 613.8
 * dependency pass is what is doing the ordering.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, PlayerId, ReduceResult } from '@mtg/kernel';
import {
  controllerOf,
  effectsApplyingTo,
  eventsOfType,
  hasKeyword,
  isOnBattlefield,
  powerOf,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { creature, instant, keywordAnthem, lands, MOUNTAIN, PLAINS, tribalLord } from './cards';
import { apply, handOidOf, oidOf, oidsOf, playCombat } from './helpers';
import { controlledBy as controlChange, onlyObject, retype, withContinuous } from './continuous-helpers';

const MERFOLK_LORD = tribalLord(
  'Merfolk Tidecaller',
  'Merfolk',
  { power: 1, toughness: 1 },
  { cost: { generic: 2 } },
);
const MERFOLK_ELDER = tribalLord('Merfolk Elder', 'Merfolk', { power: 2, toughness: 0 });
const MERFOLK_GUARD = creature('Merfolk Guard', 2, 2, { subtypes: ['Merfolk'] });
const HUMAN_SCOUT = creature('Vantia Scout', 2, 2, { subtypes: ['Human'] });
const BANNER = keywordAnthem('Banner of the Goddess', 'vigilance', { generic: 2 });
const UNMAKE = instant('Unmake', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
  generic: 1,
});

function myLands(card: typeof MOUNTAIN, count: number) {
  return lands(card, count).map((land) => ({ card: land, controller: 0 as const }));
}

/** Casts the named card from player 0's hand and lets it resolve. */
function castAndResolve(start: ReduceResult, name: string): ReduceResult {
  const oid = handOidOf(start.state, 0, name);
  const cast = apply(start, { type: 'castSpell', player: 0, oid, targets: [] });
  const priority = cast.state.turn.priority;
  if (priority === null) throw new Error('nobody has priority after the cast');
  return apply(apply(cast, { type: 'passPriority', player: priority }), {
    type: 'passPriority',
    player: 1,
  });
}

/** Every effect currently applying to a permanent, as `layer:source` pairs. */
function sourcesApplyingTo(state: GameState, oid: ObjectId): readonly string[] {
  return effectsApplyingTo(state, oid).map((effect) => `${effect.layer}:${effect.sourceOid}`);
}

/**
 * The battlefield object with this name under this controller.
 *
 * Every scope in the vocabulary is a scope over *your* permanents, so the tests
 * that prove a scope reaches the right things need the same card under both
 * seats, and then `oidOf` is ambiguous by construction.
 */
function oidControlledBy(state: GameState, controller: PlayerId, name: string): ObjectId {
  const found = state.battlefield.find(
    (oid) => state.objects[oid]?.controller === controller && state.objects[oid]?.card.name === name,
  );
  if (found === undefined) throw new Error(`seat ${controller} controls no ${name}`);
  return found;
}

describe('a lord cast in a seeded game', () => {
  const start = scenario({
    seed: 'static/lord',
    battlefield: [{ card: MERFOLK_GUARD, controller: 0 }, ...myLands(MOUNTAIN, 3)],
    hands: [[MERFOLK_LORD, UNMAKE], []],
  });
  const resolved = castAndResolve(start, 'Merfolk Tidecaller');
  const guard = oidOf(resolved.state, 'Merfolk Guard');
  const lord = oidOf(resolved.state, 'Merfolk Tidecaller');

  it('does not buff before it has resolved', () => {
    expect(powerOf(start.state, oidOf(start.state, 'Merfolk Guard'))).toBe(2);
    expect(start.state.continuous).toEqual([]);
  });

  it('registers its static effect the moment it enters the battlefield', () => {
    expect(isOnBattlefield(resolved.state, lord)).toBe(true);
    expect(powerOf(resolved.state, guard)).toBe(3);
    expect(toughnessOf(resolved.state, guard)).toBe(3);
  });

  it('resolves it through the CR 613 layer system rather than a parallel path', () => {
    // One effect, in layer 7c, sourced from the lord: the same record shape a
    // `pumpUntilEndOfTurn` produces, ordered by the same walk.
    expect(sourcesApplyingTo(resolved.state, guard)).toEqual([`7c:${lord}`]);
    expect(resolved.state.continuous.length).toBe(1);
    expect(resolved.state.continuous[0]?.duration).toBe('whileOnBattlefield');
  });

  it('does not buff itself, because the scope says "other"', () => {
    expect(powerOf(resolved.state, lord)).toBe(2);
    expect(sourcesApplyingTo(resolved.state, lord)).toEqual([]);
  });

  it('drops the effect when the source leaves, and says so in the log', () => {
    const killed = apply(resolved, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(resolved.state, 0, 'Unmake'),
      targets: [{ kind: 'permanent', oid: lord }],
    });
    const priority = killed.state.turn.priority;
    if (priority === null) throw new Error('nobody has priority');
    const done = apply(apply(killed, { type: 'passPriority', player: priority }), {
      type: 'passPriority',
      player: 1,
    });

    expect(isOnBattlefield(done.state, lord)).toBe(false);
    expect(powerOf(done.state, guard)).toBe(2);
    expect(toughnessOf(done.state, guard)).toBe(2);
    expect(done.state.continuous).toEqual([]);
    const expired = eventsOfType(done.events, 'continuousEffectsExpired');
    expect(expired.flatMap((event) => event.ids).length).toBe(1);
  });
});

describe('a lord placed by the scenario builder', () => {
  /**
   * `scenario`'s `addObject` writes battlefield objects straight into the state
   * rather than through `moveObject`, so unless the builder runs the same
   * compiler this lord registers nothing — and every assertion about statics
   * built on a scenario would pass for the wrong reason.
   */
  const built = scenario({
    seed: 'static/scenario',
    battlefield: [
      { card: MERFOLK_LORD, controller: 0 },
      { card: MERFOLK_GUARD, controller: 0 },
      { card: HUMAN_SCOUT, controller: 0 },
      { card: MERFOLK_GUARD, controller: 1 },
    ],
  });

  it('registers the same effect a cast lord would', () => {
    const state = built.state;
    expect(state.continuous.length).toBe(1);
    expect(state.continuous[0]?.layer).toBe('7c');
    expect(state.continuous[0]?.sourceOid).toBe(oidOf(state, 'Merfolk Tidecaller'));
  });

  it("buffs the controller's other creatures of that subtype and nothing else", () => {
    const state = built.state;
    expect(powerOf(state, oidControlledBy(state, 0, 'Merfolk Guard'))).toBe(3);
    // Wrong subtype: unbuffed.
    expect(powerOf(state, oidControlledBy(state, 0, 'Vantia Scout'))).toBe(2);
    // Right subtype, wrong controller: unbuffed.
    expect(powerOf(state, oidControlledBy(state, 1, 'Merfolk Guard'))).toBe(2);
  });
});

describe('two lords', () => {
  const built = scenario({
    seed: 'static/stacking',
    battlefield: [
      { card: MERFOLK_LORD, controller: 0 },
      { card: MERFOLK_ELDER, controller: 0 },
      { card: MERFOLK_GUARD, controller: 0 },
    ],
  });

  it('stack on the creature they share and on each other', () => {
    const state = built.state;
    expect(powerOf(state, oidOf(state, 'Merfolk Guard'))).toBe(2 + 1 + 2);
    expect(toughnessOf(state, oidOf(state, 'Merfolk Guard'))).toBe(2 + 1 + 0);
    // Each lord excludes itself and catches the other.
    expect(powerOf(state, oidOf(state, 'Merfolk Tidecaller'))).toBe(2 + 2);
    expect(powerOf(state, oidOf(state, 'Merfolk Elder'))).toBe(2 + 1);
  });

  /**
   * Two records, two identities. Both halves are invisible to `powerOf`, whose
   * sum is the same whether the two effects are told apart or not, and both are
   * load-bearing the moment anything else touches them. A shared id makes
   * `continuousEffectsExpired` name an effect that two permanents registered,
   * and lets a later `pumpUntilEndOfTurn` mint one that collides with a lord's.
   * A shared timestamp discards the CR 613.7 order the layer walk applies in.
   */
  it('are told apart: distinct ids, and timestamps in the order they entered', () => {
    const [first, second] = built.state.continuous;
    expect(built.state.continuous.length).toBe(2);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(first.id).not.toBe(second.id);
    expect(second.timestamp).toBeGreaterThan(first.timestamp);
  });
});

describe('a static ability against the rest of CR 613', () => {
  /**
   * CR 613.8: whether the lord applies to a permanent can depend on what layer 4
   * did to that permanent. `dependency.ts` computes that relation rather than
   * declaring it, and this is the assertion that a compiled static ability sits
   * inside that computation instead of beside it.
   */
  it('catches a permanent another effect turned into its subtype', () => {
    const built = scenario({
      seed: 'static/dependency',
      battlefield: [
        { card: MERFOLK_LORD, controller: 0 },
        { card: HUMAN_SCOUT, controller: 0 },
      ],
    });
    const scout = oidOf(built.state, 'Vantia Scout');
    expect(powerOf(built.state, scout)).toBe(2);

    const retyped = withContinuous(built.state, [retype(onlyObject(scout), { addSubtypes: ['Merfolk'] })]);
    expect(powerOf(retyped, scout)).toBe(3);
  });
});

describe("a static ability whose source's control changes mid-game", () => {
  /**
   * The bug this proves fixed. A first version of `staticFilterFor`
   * (`abilities.ts`) baked `controllerOf(state, source)` into the filter's
   * `controller` field at registration time — the moment the lord entered —
   * and nothing ever re-baked it, so a lord that changed hands (an Act of
   * Treason effect, a mind-control aura) kept buffing its *original*
   * controller's board forever, including after that controller no longer
   * controlled the lord itself. `ObjectFilter.controllerIsSource`
   * (`continuous.ts`) replaces the baked value with a live lookup:
   * `characteristics.ts`'s `resolveFilter` reads the source's *current*
   * controller off `context.map` on every layer walk, the same live-read
   * pattern `enabledWhile`/`conditionHolds` already used. Layer 2 (control)
   * always resolves before layer 7 (P/T) in `LAYER_ORDER` regardless of
   * timestamp, so the walk that computes the lord's own scope always sees the
   * post-control-change controller.
   */
  it('retargets the buff to the new controller and stops buffing the old one', () => {
    const built = scenario({
      seed: 'static/control-change',
      battlefield: [
        { card: MERFOLK_LORD, controller: 0 },
        { card: MERFOLK_GUARD, controller: 0 },
        { card: MERFOLK_GUARD, controller: 1 },
      ],
    });
    const state = built.state;
    const lord = oidOf(state, 'Merfolk Tidecaller');
    const mine = oidControlledBy(state, 0, 'Merfolk Guard');
    const theirs = oidControlledBy(state, 1, 'Merfolk Guard');

    // Before any control change: the lord buffs only its own controller's Guard.
    expect(powerOf(state, mine)).toBe(3);
    expect(powerOf(state, theirs)).toBe(2);

    // Something else seizes control of the lord itself (layer 2, sourced from
    // a distinct object so it does not touch the lord's own registered static).
    const changed = withContinuous(state, [controlChange(onlyObject(lord), 1, { ts: 100 })]);
    expect(controllerOf(changed, lord)).toBe(1);

    expect(powerOf(changed, theirs)).toBe(3);
    expect(powerOf(changed, mine)).toBe(2);
  });
});

describe('a keyword-granting static', () => {
  // Both seats field the same creature: `creaturesYouControl` is the one scope
  // whose controller filter no other test can see, because the lord scenarios
  // all use `otherCreaturesYouControl`.
  const start = scenario({
    seed: 'static/anthem',
    battlefield: [
      { card: HUMAN_SCOUT, controller: 0 },
      { card: HUMAN_SCOUT, controller: 1 },
      ...myLands(PLAINS, 3),
    ],
    hands: [[BANNER], []],
  });
  const resolved = castAndResolve(start, 'Banner of the Goddess');

  it('grants nothing before the artifact resolves', () => {
    expect(hasKeyword(start.state, oidControlledBy(start.state, 0, 'Vantia Scout'), 'vigilance')).toBe(false);
  });

  it('grants the keyword in layer 6 once the artifact is on the battlefield', () => {
    const scout = oidControlledBy(resolved.state, 0, 'Vantia Scout');
    expect(hasKeyword(resolved.state, scout, 'vigilance')).toBe(true);
    expect(sourcesApplyingTo(resolved.state, scout)).toEqual([
      `6:${oidOf(resolved.state, 'Banner of the Goddess')}`,
    ]);
  });

  it("stops at the controller: the opponent's identical creature is untouched", () => {
    const theirs = oidControlledBy(resolved.state, 1, 'Vantia Scout');
    expect(hasKeyword(resolved.state, theirs, 'vigilance')).toBe(false);
    expect(sourcesApplyingTo(resolved.state, theirs)).toEqual([]);
  });

  it('is the real keyword: the granted attacker does not tap', () => {
    const combat = scenario({
      seed: 'static/anthem-combat',
      battlefield: [
        { card: BANNER, controller: 0 },
        { card: HUMAN_SCOUT, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const attacker = oidOf(combat.state, 'Vantia Scout');
    expect(hasKeyword(combat.state, attacker, 'vigilance')).toBe(true);
    const attacked = playCombat(combat, { attackers: [attacker] });
    expect(attacked.state.objects[attacker]?.tapped).toBe(false);
  });
});

describe('a static conditional on `enabledWhile` (CR 611.2c)', () => {
  /**
   * "Other Merfolk you control get +1/+1 as long as you control three or more
   * Merfolk" — the corpus's own shape (module docblock on `condition.ts`), built
   * straight from `AbilityInput` rather than through `tribalLord`, since the
   * threshold is what makes this ability different from every other lord in
   * this file.
   */
  const CONDITIONAL_LORD = creature('Merfolk Matriarch', 2, 2, {
    subtypes: ['Merfolk'],
    abilities: [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Merfolk',
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
        enabledWhile: { kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 3 },
      },
    ],
  });

  it('registers the effect on entry whether or not the condition holds yet', () => {
    // Two Merfolk total (the Matriarch and one Guard): below the threshold.
    const built = scenario({
      seed: 'static/conditional-below',
      battlefield: [
        { card: CONDITIONAL_LORD, controller: 0 },
        { card: MERFOLK_GUARD, controller: 0 },
      ],
    });
    const state = built.state;
    const guard = oidOf(state, 'Merfolk Guard');
    expect(state.continuous.length).toBe(1);
    expect(state.continuous[0]?.enabledWhile).toEqual({
      kind: 'controlsSubtype',
      subtype: 'Merfolk',
      atLeast: 3,
    });
    // Registered, but inert: `effectsApplyingTo` — the same report the layer
    // walk and CR 613.8's dependency pass both read — sees nothing applying.
    expect(powerOf(state, guard)).toBe(2);
    expect(toughnessOf(state, guard)).toBe(2);
    expect(sourcesApplyingTo(state, guard)).toEqual([]);
  });

  it('turns on once the count reaches the threshold', () => {
    // Three Merfolk total (the Matriarch and two Guards): at the threshold.
    const built = scenario({
      seed: 'static/conditional-at',
      battlefield: [
        { card: CONDITIONAL_LORD, controller: 0 },
        { card: MERFOLK_GUARD, controller: 0 },
        { card: MERFOLK_GUARD, controller: 0 },
      ],
    });
    const state = built.state;
    const lord = oidOf(state, 'Merfolk Matriarch');
    const [firstGuard, secondGuard] = oidsOf(state, 'Merfolk Guard');
    if (firstGuard === undefined || secondGuard === undefined) throw new Error('expected two guards');

    expect(powerOf(state, firstGuard)).toBe(3);
    expect(toughnessOf(state, firstGuard)).toBe(3);
    expect(powerOf(state, secondGuard)).toBe(3);
    expect(sourcesApplyingTo(state, firstGuard)).toEqual([`7c:${lord}`]);
    // The scope still says "other": the Matriarch never buffs itself, holding
    // or not.
    expect(powerOf(state, lord)).toBe(2);
    expect(sourcesApplyingTo(state, lord)).toEqual([]);
  });

  it("does not count an opponent's Merfolk toward the controller's own threshold", () => {
    const built = scenario({
      seed: 'static/conditional-opponent',
      battlefield: [
        { card: CONDITIONAL_LORD, controller: 0 },
        { card: MERFOLK_GUARD, controller: 0 },
        { card: MERFOLK_GUARD, controller: 1 },
        { card: MERFOLK_GUARD, controller: 1 },
      ],
    });
    const state = built.state;
    // Player 0 controls only two Merfolk (the Matriarch and one Guard); the
    // opponent's two Merfolk do not help clear player 0's own threshold.
    expect(powerOf(state, oidControlledBy(state, 0, 'Merfolk Guard'))).toBe(2);
  });
});
