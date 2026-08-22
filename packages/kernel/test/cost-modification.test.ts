/**
 * Cost modification, end to end: CR 601.2f's printed cost reduction and CR
 * 601.2b's X, both flowing through `effectiveManaCost` — the single seam
 * `canPay`, `planPayment`, `castOptions`, `validateCast` and `onCastSpell` all
 * read instead of `card.manaCost` directly.
 *
 * The point of most of these assertions is *which machinery answered*, the
 * same way `static-abilities.test.ts` reads its lord back through
 * `effectsApplyingTo` rather than trusting `powerOf` alone: a card that costs
 * less could be a special case bolted onto `castOptions`, or it could be
 * `state.costModifiers` doing the work, and `effectiveManaCost` plus the
 * `costModifiers` array itself is how these tests tell the two apart.
 */
import { describe, expect, it } from 'vitest';
import type { CastableCard, Card } from '@mtg/dsl';
import { isCastable } from '@mtg/dsl';
import type { Action } from '@mtg/kernel';
import {
  canPay,
  effectiveManaCost,
  eventsOfType,
  isOnBattlefield,
  legalActions,
  maxPayableX,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { creature, costReducer, creatureCostReducer, instant, lands, MOUNTAIN, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

/**
 * `creature`/`instant`/`sorcery` return the whole `Card` union (they go
 * through `@mtg/dsl`'s `parseCard`, which cannot know the kind ahead of the
 * schema it validates against), so a module-level fixture that reads
 * `.manaCost` — every cost-modification assertion below does — needs the
 * narrowing `isCastable` gives, done once here rather than at each call site.
 */
function castable(card: Card): CastableCard {
  if (!isCastable(card)) throw new Error(`fixture "${card.name}" is not a castable card`);
  return card;
}

const BEAR = castable(creature('Grizzly Bear', 2, 2, { cost: { generic: 2 } }));
const ZAP = castable(
  instant('Zap', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }], { R: 1 }),
);
const WRATH = castable(
  sorcery('Wrath', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
    generic: 4,
  }),
);
const SHATTER = castable(
  sorcery('Shatter', [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } }], {
    generic: 2,
  }),
);
const XBOLT = castable(
  instant('X-Bolt', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }], {
    hasX: true,
    R: 1,
  }),
);

/**
 * An artifact creature: two card types on one type line (CR 205.1a), and the
 * only card whose `kind` is a worse answer than its printed types. It is here
 * because the cost seam used to compare a reduction's `cardType` against that
 * discriminant, so "artifact spells you cast cost {1} less" reduced the
 * noncreature half of a set's artifacts and skipped the other half.
 */
const JUGGERNAUT = castable(creature('Rolling Siege Engine', 5, 3, { cost: { generic: 4 }, artifact: true }));

const CREATURE_DISCOUNT = costReducer('Warden of Cheap Beasts', { amount: 1, cardType: 'creature' });
const ARTIFACT_DISCOUNT = costReducer('Foundry of Thrift', { amount: 1, cardType: 'artifact' });
const UNIVERSAL_DISCOUNT = costReducer('Font of Free Casting', { amount: 1, cardType: null });
const HUGE_DISCOUNT = costReducer('Overwhelming Largesse', { amount: 5, cardType: 'creature' });

function myLands(count: number) {
  return lands(MOUNTAIN, count).map((land) => ({ card: land, controller: 0 as const }));
}

describe('effectiveManaCost', () => {
  it('is the printed cost when nothing is registered', () => {
    const start = scenario({ seed: 'cost/baseline', battlefield: [], hands: [[BEAR], []] });
    expect(effectiveManaCost(start.state, 0, BEAR)).toStrictEqual(BEAR.manaCost);
  });

  it('reduces a matching spell type by the registered amount', () => {
    const start = scenario({
      seed: 'cost/scoped',
      battlefield: [{ card: CREATURE_DISCOUNT, controller: 0 }],
      hands: [[BEAR], []],
    });
    expect(effectiveManaCost(start.state, 0, BEAR).generic).toBe(1);
  });

  it('leaves an unmatched spell type untouched', () => {
    const start = scenario({
      seed: 'cost/unmatched',
      battlefield: [{ card: CREATURE_DISCOUNT, controller: 0 }],
      hands: [[ZAP], []],
    });
    expect(effectiveManaCost(start.state, 0, ZAP)).toStrictEqual(ZAP.manaCost);
  });

  it('an artifact-typed reduction reaches an artifact creature spell', () => {
    const start = scenario({
      seed: 'cost/artifact-creature',
      battlefield: [{ card: ARTIFACT_DISCOUNT, controller: 0 }],
      hands: [[JUGGERNAUT, BEAR], []],
    });
    // Both types on the type line, so the artifact reduction applies...
    expect(effectiveManaCost(start.state, 0, JUGGERNAUT).generic).toBe(3);
    // ...and a creature that is only a creature is left alone by it.
    expect(effectiveManaCost(start.state, 0, BEAR)).toStrictEqual(BEAR.manaCost);
  });

  it('a creature-typed reduction still reaches an artifact creature spell', () => {
    const start = scenario({
      seed: 'cost/artifact-creature-by-creature',
      battlefield: [{ card: CREATURE_DISCOUNT, controller: 0 }],
      hands: [[JUGGERNAUT], []],
    });
    expect(effectiveManaCost(start.state, 0, JUGGERNAUT).generic).toBe(3);
  });

  it('a null cardType reduces every spell type', () => {
    const start = scenario({
      seed: 'cost/universal',
      battlefield: [{ card: UNIVERSAL_DISCOUNT, controller: 0 }],
      hands: [[ZAP, WRATH], []],
    });
    expect(effectiveManaCost(start.state, 0, ZAP).generic).toBe(0);
    expect(effectiveManaCost(start.state, 0, WRATH).generic).toBe(3);
  });

  it('only reduces the cost for its own controller', () => {
    const start = scenario({
      seed: 'cost/controller',
      battlefield: [{ card: CREATURE_DISCOUNT, controller: 0 }],
      hands: [[], [BEAR]],
    });
    expect(effectiveManaCost(start.state, 1, BEAR)).toStrictEqual(BEAR.manaCost);
  });

  it('floors generic mana at zero rather than going negative', () => {
    const start = scenario({
      seed: 'cost/floor',
      battlefield: [{ card: HUGE_DISCOUNT, controller: 0 }],
      hands: [[BEAR], []],
    });
    expect(effectiveManaCost(start.state, 0, BEAR).generic).toBe(0);
  });

  it('stacks two registered reductions on the same spell', () => {
    const start = scenario({
      seed: 'cost/stack',
      battlefield: [
        { card: CREATURE_DISCOUNT, controller: 0 },
        { card: UNIVERSAL_DISCOUNT, controller: 0 },
      ],
      hands: [[BEAR], []],
    });
    expect(effectiveManaCost(start.state, 0, BEAR).generic).toBe(0);
  });

  it('registers the modifier as state, not a derived special case', () => {
    const start = scenario({
      seed: 'cost/registered-as-state',
      battlefield: [{ card: CREATURE_DISCOUNT, controller: 0 }],
      hands: [[BEAR], []],
    });
    expect(start.state.costModifiers.length).toBe(1);
    expect(start.state.costModifiers[0]?.amount).toBe(1);
    expect(start.state.costModifiers[0]?.cardType).toBe('creature');
  });
});

describe('a cost reducer cast in a seeded game', () => {
  it('drops out of state.costModifiers when its source leaves the battlefield', () => {
    // The creature twin of the artifact fixture: `WRATH` names
    // `targetCreature`, so the reducer it destroys has to be a body. The
    // artifact form is covered by the test below, which could not be written
    // when this one was.
    const reducer = creatureCostReducer('Grazing Warden', { amount: 1, cardType: 'creature' });
    const start = scenario({
      seed: 'cost/expiry',
      battlefield: [{ card: reducer, controller: 0 }, ...myLands(4)],
      hands: [[WRATH], []],
    });
    expect(start.state.costModifiers.length).toBe(1);

    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Wrath'),
      targets: [{ kind: 'permanent', oid: oidOf(start.state, 'Grazing Warden') }],
    });
    const priority = cast.state.turn.priority;
    if (priority === null) throw new Error('nobody has priority after the cast');
    const done = apply(apply(cast, { type: 'passPriority', player: priority }), {
      type: 'passPriority',
      player: 1,
    });

    expect(isOnBattlefield(done.state, oidOf(start.state, 'Grazing Warden'))).toBe(false);
    expect(done.state.costModifiers).toEqual([]);
  });

  it('drops out when the artifact that printed it is destroyed', () => {
    // The same expiry on the shape that actually prints it. Every other
    // reduction fixture in this file is an artifact, and until
    // `targetArtifactOrEnchantment` existed no spell this DSL could express
    // was able to destroy one, so the expiry path was only ever exercised
    // through a creature standing in for an artifact. `SHATTER` names the
    // artifact directly, which is what the printed card does.
    const start = scenario({
      seed: 'cost/expiry-artifact',
      battlefield: [{ card: CREATURE_DISCOUNT, controller: 0 }, ...myLands(2)],
      hands: [[SHATTER], []],
    });
    expect(start.state.costModifiers.length).toBe(1);

    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Shatter'),
      targets: [{ kind: 'permanent', oid: oidOf(start.state, 'Warden of Cheap Beasts') }],
    });
    const priority = cast.state.turn.priority;
    if (priority === null) throw new Error('nobody has priority after the cast');
    const done = apply(apply(cast, { type: 'passPriority', player: priority }), {
      type: 'passPriority',
      player: 1,
    });

    expect(isOnBattlefield(done.state, oidOf(start.state, 'Warden of Cheap Beasts'))).toBe(false);
    expect(done.state.costModifiers).toEqual([]);
  });
});

describe('castOptions and validateCast, routed through the seam', () => {
  it('is not offered when the printed cost is unaffordable and nothing reduces it', () => {
    const bare = scenario({ seed: 'cost/enum-bare', battlefield: [...myLands(1)], hands: [[BEAR], []] });
    const bearOid = handOidOf(bare.state, 0, 'Grizzly Bear');
    expect(canPay(bare.state, 0, BEAR.manaCost)).toBe(false); // one Mountain cannot pay {2}
    expect(legalActions(bare.state).some((a) => a.type === 'castSpell' && a.oid === bearOid)).toBe(false);
    expect(validateAction(bare.state, { type: 'castSpell', player: 0, oid: bearOid, targets: [] })).not.toBe(
      null,
    );
  });

  it('is offered once a matching reduction makes the same board affordable', () => {
    const withDiscount = scenario({
      seed: 'cost/enum-with',
      battlefield: [{ card: CREATURE_DISCOUNT, controller: 0 }, ...myLands(1)],
      hands: [[BEAR], []],
    });
    const bearOid = handOidOf(withDiscount.state, 0, 'Grizzly Bear');
    const castBear: Action = { type: 'castSpell', player: 0, oid: bearOid, targets: [] };
    expect(legalActions(withDiscount.state).some((a) => a.type === 'castSpell' && a.oid === bearOid)).toBe(
      true,
    );
    expect(validateAction(withDiscount.state, castBear)).toBeNull();
  });

  it('pays the reduced cost rather than the printed one', () => {
    const start = scenario({
      seed: 'cost/pays-reduced',
      battlefield: [{ card: CREATURE_DISCOUNT, controller: 0 }, ...myLands(1)],
      hands: [[BEAR], []],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Grizzly Bear'),
      targets: [],
    });
    const paid = eventsOfType(cast.events, 'manaPaid');
    expect(paid).toHaveLength(1);
    expect(paid[0]?.cost.generic).toBe(1);
    // Exactly one Mountain tapped, not two: the plan was built for {1}, not {2}.
    const produced = eventsOfType(cast.events, 'manaProduced');
    expect(produced).toHaveLength(1);
  });
});

describe('X costs', () => {
  it('maxPayableX is null for a card with no X', () => {
    const start = scenario({ seed: 'x/no-x', battlefield: [...myLands(4)], hands: [[BEAR], []] });
    expect(maxPayableX(start.state, 0, BEAR)).toBeNull();
  });

  it('maxPayableX is bounded by available mana', () => {
    const start = scenario({ seed: 'x/bounded', battlefield: [...myLands(3)], hands: [[XBOLT], []] });
    // {X}{R}: one Mountain pays R, the other two pay X up to 2.
    expect(maxPayableX(start.state, 0, XBOLT)).toBe(2);
  });

  it('a cost reduction raises the maximum payable X', () => {
    const start = scenario({
      seed: 'x/discounted',
      battlefield: [{ card: UNIVERSAL_DISCOUNT, controller: 0 }, ...myLands(3)],
      hands: [[XBOLT], []],
    });
    // The reduction shaves {1} off the total cost, which lands entirely on X:
    // three mana pays R plus X = 3 once the discount is spent on the generic side.
    expect(maxPayableX(start.state, 0, XBOLT)).toBe(3);
  });

  it('validateCast rejects a missing X on a hasX cost', () => {
    const start = scenario({ seed: 'x/missing', battlefield: [...myLands(3)], hands: [[XBOLT], []] });
    const oid = handOidOf(start.state, 0, 'X-Bolt');
    const result = validateAction(start.state, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
    });
    expect(result).not.toBeNull();
  });

  it('validateCast rejects an X on a cost with no X', () => {
    const start = scenario({ seed: 'x/unwanted', battlefield: [...myLands(3)], hands: [[BEAR], []] });
    const oid = handOidOf(start.state, 0, 'Grizzly Bear');
    const result = validateAction(start.state, { type: 'castSpell', player: 0, oid, targets: [], x: 1 });
    expect(result).not.toBeNull();
  });

  it('validateCast rejects a negative X', () => {
    const start = scenario({ seed: 'x/negative', battlefield: [...myLands(3)], hands: [[XBOLT], []] });
    const oid = handOidOf(start.state, 0, 'X-Bolt');
    const result = validateAction(start.state, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
      x: -1,
    });
    expect(result).not.toBeNull();
  });

  it('casts with the announced X folded into the paid generic cost', () => {
    const start = scenario({ seed: 'x/cast', battlefield: [...myLands(3)], hands: [[XBOLT], []] });
    const oid = handOidOf(start.state, 0, 'X-Bolt');
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
      x: 2,
    });
    const paid = eventsOfType(cast.events, 'manaPaid');
    expect(paid).toHaveLength(1);
    // {X}{R} at X=2 is {2}{R}: generic 2, one red pip.
    expect(paid[0]?.cost.generic).toBe(2);
    expect(paid[0]?.cost.R).toBe(1);
    expect(paid[0]?.cost.hasX).toBe(false);
  });

  it('rejects an X larger than what the player can pay', () => {
    const start = scenario({ seed: 'x/too-big', battlefield: [...myLands(3)], hands: [[XBOLT], []] });
    const oid = handOidOf(start.state, 0, 'X-Bolt');
    const result = validateAction(start.state, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
      x: 3,
    });
    expect(result).not.toBeNull();
  });
});
