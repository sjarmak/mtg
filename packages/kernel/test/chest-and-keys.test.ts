/**
 * A Chest spends what Monsters drop, which is the second of The Hidden
 * Kingdom's three named mechanics.
 *
 * the set design document, decision 14: "Chests and Drops mirror
 * the prior project's economy: a dropped resource, three chest tiers", and the
 * paragraph under it says chests "enter locked and open by sacrificing parts".
 * The flagship spends parts; this file spends a Key, because the cost is a
 * count and a subtype and the kernel does not care which word the subtype is.
 * Until this slice `ActivationCostSchema` could spend mana, the source's tap
 * symbol and the source itself, so a Chest could sacrifice *itself* and could
 * not spend anything else.
 *
 * The cost names what it eats — a count and a subtype — because "sacrifice a
 * permanent" and "sacrifice two Keys" are different cards, and the difference
 * has to survive into the enumeration, the legality check and the payment.
 *
 * CR 601.2h is unchanged and load-bearing: the cost is paid on activation,
 * before the ability reaches the stack, so the Keys are gone while the Chest's
 * ability is still waiting there. `fuse.test.ts` and `monster-drop.test.ts`
 * state the same rule for the source itself.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard, tokenCard, TokenSpecSchema } from '@mtg/dsl';
import type { Action, GameState, ObjectId } from '@mtg/kernel';
import {
  getObject,
  hasSubtype,
  IllegalActionError,
  legalActions,
  onlyObject,
  pendingDecision,
  reduce,
  reduceAll,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { creature, FOREST } from './cards';
import { retype, withContinuous } from './continuous-helpers';

/** The part a chest holds. Fuse, exactly as `fuse.test.ts` prints it. */
const TROPHY_HORN = TokenSpecSchema.parse({
  name: 'Trophy Horn',
  subtypes: ['Part'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeSelf: true },
      effects: [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
    },
  ],
});

/** What a small Monster drops: an artifact token with no body and no ability. */
const KEY = tokenCard(TokenSpecSchema.parse({ name: 'Key', subtypes: ['Key'] }));

/**
 * A chest of decision 14's three tiers. It opens by sacrificing Keys and
 * nothing else, which `checkActivationCost` accepts for the reason it accepts
 * Fuse: the cost consumes permanents, so the ability is not repeatable.
 */
function chest(keys: number): Card {
  return parseCard({
    kind: 'artifact',
    id: `xmp-chest-${keys}`,
    name: `Chest of ${keys}`,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 20 + keys },
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {}, sacrificeOther: { count: keys, subtype: 'Key' } },
        effects: [{ kind: 'createToken', count: 1, token: TROPHY_HORN }],
      },
    ],
  });
}

const SPROUT = creature('Bramble Sprout', 2, 2, { cost: { generic: 1 } });

interface Board {
  readonly state: GameState;
  readonly chest: ObjectId;
  readonly keys: readonly ObjectId[];
  readonly opponentKey: ObjectId;
}

/**
 * A chest and two Keys on your side of the table, one Key on theirs. The
 * opponent's Key is the case a count alone would let through: it is a Key, it
 * is on the battlefield, and it is not yours.
 */
function board(cost = 2, mine = 2): Board {
  const started = scenario({
    battlefield: [
      { card: chest(cost), controller: 0 },
      { card: SPROUT, controller: 0 },
      ...Array.from({ length: mine }, () => ({ card: KEY, controller: 0 as const, token: true })),
      { card: KEY, controller: 1, token: true },
      ...Array.from({ length: 2 }, () => ({ card: FOREST, controller: 0 as const })),
    ],
  });
  const state = started.state;
  const named = (name: string): ObjectId => {
    const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
    if (found === undefined) throw new Error(`no battlefield object named ${name}`);
    return found;
  };
  const keysOf = (player: 0 | 1): readonly ObjectId[] =>
    state.battlefield.filter(
      (oid) => state.objects[oid]?.card.name === 'Key' && state.objects[oid]?.controller === player,
    );
  const theirs = keysOf(1)[0];
  if (theirs === undefined) throw new Error('the opponent has no Key');
  return { state, chest: named(`Chest of ${cost}`), keys: keysOf(0), opponentKey: theirs };
}

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

type Activation = Extract<Action, { type: 'activateAbility' }>;

function openings(state: GameState, chestOid: ObjectId): readonly Activation[] {
  return legalActions(state).filter(
    (action): action is Activation => action.type === 'activateAbility' && action.oid === chestOid,
  );
}

function onlyOpening(state: GameState, chestOid: ObjectId): Activation {
  const found = openings(state, chestOid);
  const first = found[0];
  if (first === undefined) throw new Error('the chest offered no opening');
  return first;
}

describe('a Chest that spends Keys', () => {
  it('offers one opening per set of Keys that could pay, each naming its own', () => {
    const { state, chest: chestOid, keys } = board();
    const offered = openings(state, chestOid);
    expect(offered).toHaveLength(1);
    expect([...(offered[0]?.sacrifices ?? [])].sort()).toEqual([...keys].sort());

    // Three Keys and a cost of two is C(3,2): the choice of which pair is the
    // player's, so the enumeration hands them all three pairs.
    const wider = board(2, 3);
    const pairs = openings(wider.state, wider.chest);
    expect(pairs).toHaveLength(3);
    for (const pair of pairs) expect(pair.sacrifices).toHaveLength(2);
    expect(new Set(pairs.map((pair) => [...pair.sacrifices].sort().join(','))).size).toBe(3);
  });

  it('never offers the opponent a way to spend your Keys', () => {
    const { state, chest: chestOid } = board();
    for (const opening of openings(state, chestOid)) expect(opening.player).toBe(0);
  });

  it('eats both Keys on activation and yields the part when the ability resolves', () => {
    const { state, chest: chestOid, keys, opponentKey } = board();
    const activated = reduce(state, onlyOpening(state, chestOid));

    // CR 601.2h: the cost is paid before the ability reaches the stack, so both
    // Keys are gone while the chest's ability waits there. They are tokens, so
    // `sba.ts` has already swept them out of the graveyard (CR 111.7, 704.5d).
    for (const key of keys) expect(getObject(activated.state, key).zone).toBe('exile');
    expect(getObject(activated.state, opponentKey).zone).toBe('battlefield');
    expect(activated.state.stack).toHaveLength(1);
    // The chest is not one of the things it ate.
    expect(getObject(activated.state, chestOid).zone).toBe('battlefield');

    const settled = reduceAll(activated.state, PASS).state;
    const part = settled.battlefield.filter((oid) => settled.objects[oid]?.card.name === 'Trophy Horn');
    expect(part).toHaveLength(1);
  });

  it('refuses an opening that offers one Key when the cost names two', () => {
    const { state, chest: chestOid, keys } = board();
    const short = keys[0];
    if (short === undefined) throw new Error('no Key');
    expect(validateAction(state, { ...onlyOpening(state, chestOid), sacrifices: [short] })).toBe(
      'the cost sacrifices 2 Key permanents, and 1 was offered',
    );
  });

  it("refuses an opening that offers the opponent's Key", () => {
    const { state, chest: chestOid, keys, opponentKey } = board();
    const mine = keys[0];
    if (mine === undefined) throw new Error('no Key');
    expect(validateAction(state, { ...onlyOpening(state, chestOid), sacrifices: [mine, opponentKey] })).toBe(
      `${opponentKey} is not a Key permanent you control`,
    );
  });

  it('refuses the same Key offered twice to make up the count', () => {
    const { state, chest: chestOid, keys } = board();
    const mine = keys[0];
    if (mine === undefined) throw new Error('no Key');
    expect(validateAction(state, { ...onlyOpening(state, chestOid), sacrifices: [mine, mine] })).toBe(
      `${mine} was offered twice`,
    );
  });

  it('stops counting a Key that a layer-4 effect stopped being one', () => {
    const { state, chest: chestOid, keys } = board();
    const stripped = keys[0];
    if (stripped === undefined) throw new Error('no Key');
    // CR 613.1d: an effect that sets a type line wipes the printed subtypes
    // (CR 205.1a). The cost reads the derived line, not the printed one, so the
    // permanent is still called Key and no longer pays for Chests.
    const bent = withContinuous(state, [
      retype(onlyObject(stripped), { addSubtypes: ['Wall'], removeAllSubtypes: true }),
    ]);
    expect(getObject(bent, stripped).card.subtypes).toEqual(['Key']);
    expect(hasSubtype(bent, stripped, 'Key')).toBe(false);
    expect(openings(bent, chestOid)).toHaveLength(0);
    expect(
      validateAction(bent, {
        type: 'activateAbility',
        player: 0,
        oid: chestOid,
        abilityIndex: 0,
        targets: [null],
        sacrifices: keys,
      }),
    ).toBe('you control 1 Key permanents and the cost sacrifices 2');
  });

  it('offers no opening at all while the player is a Key short', () => {
    const { state, chest: chestOid } = board(3);
    expect(openings(state, chestOid)).toHaveLength(0);
  });

  it('will not let a chest count itself as one of the permanents it eats', () => {
    // The chest carries the subtype the cost names, so the only thing keeping
    // it out of its own payment is `sacrificeOther` meaning other.
    const selfish = parseCard({
      kind: 'artifact',
      id: 'xmp-chest-selfish',
      name: 'Keyed Chest',
      rarity: 'common',
      set: { code: 'XMP', collectorNumber: 30 },
      manaCost: { generic: 2 },
      subtypes: ['Key'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, sacrificeOther: { count: 1, subtype: 'Key' } },
          effects: [{ kind: 'createToken', count: 1, token: TROPHY_HORN }],
        },
      ],
    });
    const started = scenario({ battlefield: [{ card: selfish, controller: 0 }] });
    const state = started.state;
    const oid = state.battlefield[0];
    if (oid === undefined) throw new Error('no chest');
    expect(openings(state, oid)).toHaveLength(0);
    expect(
      validateAction(state, {
        type: 'activateAbility',
        player: 0,
        oid,
        abilityIndex: 0,
        targets: [null],
        sacrifices: [oid],
      }),
    ).toBe('you control 0 Key permanents and the cost sacrifices 1');
  });
});

/**
 * An altar that eats a Beast and aims at a creature. Every other fixture here
 * eats Keys, which are artifact tokens with no body, so no permanent can be both
 * the payment and the target. This one names a subtype its own targets carry,
 * which is the only way the two enumerated dimensions can collide on one object.
 */
const BEAST_ALTAR = parseCard({
  kind: 'artifact',
  id: 'xmp-altar-beast',
  name: 'Beast Altar',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 40 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeOther: { count: 1, subtype: 'Beast' } },
      effects: [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
    },
  ],
});

const SNARLFANG = creature('Snarlfang', 2, 2, { subtypes: ['Beast'] });

/**
 * CR 601.2c chooses an activated ability's targets, and CR 601.2h pays its costs
 * afterwards. So a permanent may be named as the target and then eaten to pay for
 * the very ability aiming at it: the target was legal at the moment it was
 * chosen, and the activation is legal too. What the rules refuse is the
 * *resolution* — CR 608.2b removes an ability from the stack, without effect,
 * when every target it has has become illegal.
 *
 * All three assertions are needed together. The offer alone would pass if the
 * kernel resolved the ability onto a card in the graveyard; the fizzle alone
 * would pass if the enumeration had quietly stopped offering the activation at
 * all, which is the wrong fix for the same board.
 */
describe('a cost that eats the permanent its own ability targets', () => {
  function altarBoard(): { state: GameState; altar: ObjectId; beasts: readonly ObjectId[] } {
    const started = scenario({
      battlefield: [
        { card: BEAST_ALTAR, controller: 0 },
        ...Array.from({ length: 2 }, () => ({ card: SNARLFANG, controller: 0 as const })),
      ],
    });
    const state = started.state;
    const altar = state.battlefield[0];
    if (altar === undefined) throw new Error('no altar');
    const beasts = state.battlefield.filter((oid) => state.objects[oid]?.card.name === 'Snarlfang');
    if (beasts.length !== 2) throw new Error('expected two beasts');
    return { state, altar, beasts };
  }

  /** The activation that names `beast` both as its target and as its payment. */
  function selfEating(state: GameState, altar: ObjectId, beast: ObjectId): Activation {
    const found = openings(state, altar).find(
      (action) =>
        action.sacrifices.includes(beast) &&
        action.targets.some((target) => target?.kind === 'permanent' && target.oid === beast),
    );
    if (found === undefined) throw new Error('the altar offered no self-eating activation');
    return found;
  }

  it('offers it, because the target was legal when CR 601.2c chose it', () => {
    const { state, altar, beasts } = altarBoard();
    const [first] = beasts;
    if (first === undefined) throw new Error('no beast');
    expect(selfEating(state, altar, first).sacrifices).toEqual([first]);
  });

  it('eats the target on activation and resolves nothing (CR 608.2b)', () => {
    const { state, altar, beasts } = altarBoard();
    const [eaten, other] = beasts;
    if (eaten === undefined || other === undefined) throw new Error('no beasts');

    const activated = reduce(state, selfEating(state, altar, eaten));
    expect(getObject(activated.state, eaten).zone).toBe('graveyard');

    const settled = reduceAll(activated.state, PASS).state;
    // The counter lands nowhere: not on the card that paid the cost, and not on
    // the creature the ability never named.
    expect(getObject(settled, eaten).counters.horn).toBeUndefined();
    expect(getObject(settled, other).counters.horn).toBeUndefined();
  });

  it('still lands the counter when it aims at the beast it did not eat', () => {
    const { state, altar, beasts } = altarBoard();
    const [eaten, other] = beasts;
    if (eaten === undefined || other === undefined) throw new Error('no beasts');

    const aimed = openings(state, altar).find(
      (action) =>
        action.sacrifices.includes(eaten) &&
        action.targets.some((target) => target?.kind === 'permanent' && target.oid === other),
    );
    if (aimed === undefined) throw new Error('the altar offered no activation sparing the target');

    const settled = reduceAll(reduce(state, aimed).state, PASS).state;
    expect(getObject(settled, eaten).zone).toBe('graveyard');
    expect(getObject(settled, other).counters.horn).toBe(1);
  });
});

/**
 * A chest whose ability both eats Keys and aims at something: the two enumerated
 * dimensions of one activation, so a test can multiply them.
 */
function aimingChest(keys: number): Card {
  return parseCard({
    kind: 'artifact',
    id: `xmp-chest-aiming-${keys}`,
    name: `Winding Chest of ${keys}`,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 60 + keys },
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {}, sacrificeOther: { count: keys, subtype: 'Key' } },
        effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
      },
    ],
  });
}

/** `{1}: You gain 1 life.` An ordinary ability that eats nothing. */
const LANTERN = parseCard({
  kind: 'artifact',
  id: 'xmp-lantern',
  name: 'Ashen Lantern',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 70 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, tapSelf: true },
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

/** A board of `keys` Keys, `creatures` creatures, and one chest over both. */
function wideBoard(card: Card, keys: number, creatures: number): { state: GameState; chest: ObjectId } {
  const started = scenario({
    battlefield: [
      { card, controller: 0 },
      ...Array.from({ length: keys }, () => ({ card: KEY, controller: 0 as const, token: true })),
      ...Array.from({ length: creatures }, () => ({ card: SPROUT, controller: 0 as const })),
    ],
  });
  const state = started.state;
  const chestOid = state.battlefield[0];
  if (chestOid === undefined) throw new Error('no chest');
  return { state, chest: chestOid };
}

describe('the enumeration cap over an activation that pays and aims', () => {
  it('never reports a complete decision while offering more openings than the cap', () => {
    // C(4,2) = 6 payments x 2 creatures = 12 tuples for one ability, over a cap
    // of 8. Each dimension fits under the cap on its own; the product does not,
    // and it is the product that reaches the agent.
    const cap = 8;
    const { state, chest: chestOid } = wideBoard(aimingChest(2), 4, 2);
    const decision = pendingDecision(state, cap);
    if (decision === null) throw new Error('no decision');
    const offered = decision.options.filter(
      (option) => option.type === 'activateAbility' && option.oid === chestOid,
    );
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThanOrEqual(cap);
    expect(decision.complete).toBe(false);
  });

  it('reports incomplete when the payments alone are what the cap cut off', () => {
    // C(5,2) = 10 payments, one target tuple. The truncation is entirely in the
    // payment enumeration, which is the half `Decision.complete` has to carry
    // for a truncated activation to be visible at all.
    const cap = 8;
    const { state, chest: chestOid } = wideBoard(chest(2), 5, 0);
    const decision = pendingDecision(state, cap);
    if (decision === null) throw new Error('no decision');
    const offered = decision.options.filter(
      (option) => option.type === 'activateAbility' && option.oid === chestOid,
    );
    expect(offered.length).toBeLessThanOrEqual(cap);
    expect(decision.complete).toBe(false);
  });

  it('reports the cap that bit on a dimension that produced no options at all', () => {
    // C(5,2) = 10 payments over a cap of 8, and no creature to aim the opening
    // at, so the target dimension yields no tuple and the product yields no
    // option. `enumerate.ts` states the contract as "`Decision.complete` is
    // false whenever a cap bit", not "whenever an option was lost", and this is
    // the board where those two readings come apart.
    //
    // It is also the only board where the cap on `sacrificePayments` changes an
    // answer rather than only the work: everywhere else the product cap in
    // `oneAbilityOptions` reaches the same `complete` from the other side, so
    // dropping the argument to `combinations` would enumerate every C(n,k) set
    // and still return the same list. Here it would report a complete decision.
    const cap = 8;
    const { state, chest: chestOid } = wideBoard(aimingChest(2), 5, 0);
    const decision = pendingDecision(state, cap);
    if (decision === null) throw new Error('no decision');
    const offered = decision.options.filter(
      (option) => option.type === 'activateAbility' && option.oid === chestOid,
    );
    expect(offered).toHaveLength(0);
    expect(decision.complete).toBe(false);
  });

  it('stays complete when the whole product fits', () => {
    // C(3,2) = 3 payments x 2 creatures = 6, under the same cap of 8. The two
    // tests above have to be able to fail for a reason other than "the cap is
    // reported whenever a chest is on the board".
    const cap = 8;
    const { state, chest: chestOid } = wideBoard(aimingChest(2), 3, 2);
    const decision = pendingDecision(state, cap);
    if (decision === null) throw new Error('no decision');
    const offered = decision.options.filter(
      (option) => option.type === 'activateAbility' && option.oid === chestOid,
    );
    expect(offered).toHaveLength(6);
    expect(decision.complete).toBe(true);
  });
});

describe('an activation that offers permanents to an ability that eats none', () => {
  it('is refused by name rather than sacrificing them', () => {
    const started = scenario({
      battlefield: [
        { card: LANTERN, controller: 0 },
        { card: KEY, controller: 0, token: true },
        ...Array.from({ length: 1 }, () => ({ card: FOREST, controller: 0 as const })),
      ],
    });
    const state = started.state;
    const [lantern, key] = state.battlefield;
    if (lantern === undefined || key === undefined) throw new Error('the board is short');

    const offer: Action = {
      type: 'activateAbility',
      player: 0,
      oid: lantern,
      abilityIndex: 0,
      targets: [null],
      sacrifices: [key],
    };
    expect(validateAction(state, offer)).toBe('this ability sacrifices nothing, and 1 was offered');

    // The check is what stands between a hand-built action and `reduce`'s
    // payment loop, which moves every named permanent to the graveyard without
    // re-deriving whether the cost asked for it.
    expect(() => reduce(state, offer)).toThrow(IllegalActionError);
    expect(getObject(state, key).zone).toBe('battlefield');

    // The same activation with the empty list is legal, so the refusal above is
    // about the offer and not about the ability.
    expect(validateAction(state, { ...offer, sacrifices: [] })).toBe(null);
  });
});
