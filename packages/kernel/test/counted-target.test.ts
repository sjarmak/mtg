/**
 * Kernel coverage for `TargetSpec.count` (mtg-kg44): "up to two target
 * creatures" on `tapPermanent`, the shape the reviewer asked for on the set's
 * counted-target card.
 *
 * A counted slot is castable at zero legal targets on purpose — "up to two"
 * means zero is a legal choice, not a degenerate one — so the first three
 * cases climb legal-creature count (zero, one, two) and assert castability
 * and resolution at each rung. `target-choices.ts`'s `[null]` short-circuit
 * for a counted slot exists exactly so the zero-target case does not read as
 * "no legal action"; these tests are what would catch a regression of that
 * short-circuit turning into "no creatures, no cast."
 *
 * The fourth case is CR 608.2b's partial-survivor rule, the reason
 * `survivingMultipleTargets` exists as a function distinct from the
 * single-target `isTargetStillLegal`: one of two chosen targets leaves the
 * battlefield in response, and the spell still resolves, still taps the
 * survivor, and is not reported as fizzled — a whole-object fizzle only
 * applies when every target of every instruction became illegal, and this
 * spell has a second (still-legal) target left.
 *
 * The remaining cases are `validateCast`'s new rejection paths for a
 * hand-built `multiTargets` action: too many members, a repeated member, and
 * a member that was never a legal target to begin with. These mirror CR
 * 601.2c ("no two targets may be the same object", "all chosen targets must
 * be legal") applied to a submitted action rather than to the enumerator,
 * since a human or a bot can submit a `multiTargets` payload the enumerator
 * never offered.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { Action } from '@mtg/kernel';
import {
  DEFAULT_ENUMERATION_CAP,
  eventsOfType,
  legalActions,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { creature, instant, ISLAND, PLAINS } from './cards';
import { oidOf } from './helpers';

/** The card's own effect list: tap up to two, they don't untap next. */
const STAKES: Card = instant(
  'Test Frost Stakes',
  [{ kind: 'tapPermanent', target: { kind: 'targetCreature', count: 2 }, doesNotUntap: true }],
  { generic: 1, U: 1 },
);

/** Answers a chosen target by destroying it before the spell resolves. */
const SHATTER: Card = instant(
  'Test Shatter Creature',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  {
    generic: 1,
    W: 1,
  },
);

function islands(count: number): { card: typeof ISLAND; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: ISLAND, controller: 0 as const }));
}

function plains(count: number): { card: typeof PLAINS; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: PLAINS, controller: 0 as const }));
}

/**
 * The casts of one card this board offers, asked for at a stated width.
 *
 * `multiTargetsOptionsFor` bounds a counted slot's member list with the cap it
 * is given, and `DEFAULT_ENUMERATION_CAP` is one global constant over every
 * enumeration in the kernel. A test whose claim is "every member count the slot
 * allows is offered" is a claim about the card and the board, so it says how
 * wide the space is rather than inheriting a number set for combat.
 */
function castOptions(
  state: ReturnType<typeof scenario>['state'],
  oid: string,
  cap = DEFAULT_ENUMERATION_CAP,
): readonly Action[] {
  return legalActions(state, cap)
    .filter((action): action is Extract<Action, { type: 'castSpell' }> => action.type === 'castSpell')
    .filter((action) => action.oid === oid);
}

describe('a counted target slot (mtg-kg44)', () => {
  it('is castable with zero legal creatures on the battlefield', () => {
    const start = scenario({ battlefield: islands(2), hands: [[STAKES], []] });
    const stakes = playerOf(start.state, 0).hand[0] ?? '';

    const options = castOptions(start.state, stakes);
    expect(options.length).toBeGreaterThan(0);
    expect(
      options.every((action) => action.type === 'castSpell' && (action.multiTargets?.[0]?.length ?? 0) === 0),
    ).toBe(true);

    const cast = reduce(start.state, { type: 'castSpell', player: 0, oid: stakes, targets: [null] });
    expect(
      validateAction(start.state, { type: 'castSpell', player: 0, oid: stakes, targets: [null] }),
    ).toBeNull();
    const done = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
  });

  it('offers zero- and one-member choices with exactly one legal creature, and tapping the one taps it', () => {
    const bear = creature('Test Lone Bear', 2, 2, { cost: { generic: 1 } });
    const start = scenario({
      battlefield: [...islands(2), { card: bear, controller: 1 }],
      hands: [[STAKES], []],
    });
    const stakes = playerOf(start.state, 0).hand[0] ?? '';
    const victim = oidOf(start.state, 'Test Lone Bear');

    const options = castOptions(start.state, stakes);
    const counts = options
      .filter((action): action is Extract<Action, { type: 'castSpell' }> => action.type === 'castSpell')
      .map((action) => action.multiTargets?.[0]?.length ?? 0)
      .sort();
    expect(counts).toEqual([0, 1]);

    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: stakes,
      targets: [null],
      multiTargets: { 0: [victim] },
    });
    const done = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(done.state.objects[victim]?.tapped).toBe(true);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
  });

  it('offers 0/1/1/2-member choices with two legal creatures, and casting on both taps both', () => {
    const bearA = creature('Test Board Bear A', 2, 2, { cost: { generic: 1 } });
    const bearB = creature('Test Board Bear B', 2, 2, { cost: { generic: 1 } });
    const start = scenario({
      battlefield: [...islands(2), { card: bearA, controller: 1 }, { card: bearB, controller: 1 }],
      hands: [[STAKES], []],
    });
    const stakes = playerOf(start.state, 0).hand[0] ?? '';
    const bearAOid = oidOf(start.state, 'Test Board Bear A');
    const bearBOid = oidOf(start.state, 'Test Board Bear B');

    const options = castOptions(start.state, stakes);
    const counts = options
      .filter((action): action is Extract<Action, { type: 'castSpell' }> => action.type === 'castSpell')
      .map((action) => action.multiTargets?.[0]?.length ?? 0)
      .sort();
    expect(counts).toEqual([0, 1, 1, 2]);

    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: stakes,
      targets: [null],
      multiTargets: { 0: [bearAOid, bearBOid] },
    });
    const done = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(done.state.objects[bearAOid]?.tapped).toBe(true);
    expect(done.state.objects[bearBOid]?.tapped).toBe(true);
  });

  it('CR 608.2b: taps only the survivor when one of two chosen targets is destroyed in response', () => {
    const bearA = creature('Test Survivor Bear', 2, 2, { cost: { generic: 1 } });
    const bearB = creature('Test Doomed Bear', 2, 2, { cost: { generic: 1 } });
    const start = scenario({
      battlefield: [
        ...islands(2),
        ...plains(2),
        { card: bearA, controller: 1 },
        { card: bearB, controller: 1 },
      ],
      hands: [[STAKES, SHATTER], []],
    });
    const stakes = playerOf(start.state, 0).hand[0] ?? '';
    const shatter = playerOf(start.state, 0).hand[1] ?? '';
    const survivor = oidOf(start.state, 'Test Survivor Bear');
    const doomed = oidOf(start.state, 'Test Doomed Bear');

    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: stakes,
      targets: [null],
      multiTargets: { 0: [survivor, doomed] },
    });
    const answered = reduce(cast.state, {
      type: 'castSpell',
      player: 0,
      oid: shatter,
      targets: [{ kind: 'permanent', oid: doomed }],
    });
    const done = reduceAll(answered.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);

    expect(done.state.objects[doomed]?.zone).toBe('graveyard');
    expect(done.state.objects[survivor]?.tapped).toBe(true);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
  });

  it('validateCast rejects a multiTargets list longer than the slot allows', () => {
    const bearA = creature('Test Over Bear A', 2, 2, { cost: { generic: 1 } });
    const bearB = creature('Test Over Bear B', 2, 2, { cost: { generic: 1 } });
    const bearC = creature('Test Over Bear C', 2, 2, { cost: { generic: 1 } });
    const start = scenario({
      battlefield: [
        ...islands(2),
        { card: bearA, controller: 1 },
        { card: bearB, controller: 1 },
        { card: bearC, controller: 1 },
      ],
      hands: [[STAKES], []],
    });
    const stakes = playerOf(start.state, 0).hand[0] ?? '';
    const oids = [
      oidOf(start.state, 'Test Over Bear A'),
      oidOf(start.state, 'Test Over Bear B'),
      oidOf(start.state, 'Test Over Bear C'),
    ];

    const error = validateAction(start.state, {
      type: 'castSpell',
      player: 0,
      oid: stakes,
      targets: [null],
      multiTargets: { 0: oids },
    });
    expect(error).not.toBeNull();
  });

  it('validateCast rejects a multiTargets list naming the same object twice', () => {
    const bear = creature('Test Dup Bear', 2, 2, { cost: { generic: 1 } });
    const start = scenario({
      battlefield: [...islands(2), { card: bear, controller: 1 }],
      hands: [[STAKES], []],
    });
    const stakes = playerOf(start.state, 0).hand[0] ?? '';
    const victim = oidOf(start.state, 'Test Dup Bear');

    const error = validateAction(start.state, {
      type: 'castSpell',
      player: 0,
      oid: stakes,
      targets: [null],
      multiTargets: { 0: [victim, victim] },
    });
    expect(error).not.toBeNull();
  });

  it('validateCast rejects a multiTargets member that is not a legal target', () => {
    const bear = creature('Test Illegal Bear', 2, 2, { cost: { generic: 1 } });
    const start = scenario({
      battlefield: [...islands(2), { card: bear, controller: 1 }],
      hands: [[STAKES], []],
    });
    const stakes = playerOf(start.state, 0).hand[0] ?? '';
    const creatureOid = oidOf(start.state, 'Test Illegal Bear');

    // A land is on the battlefield but is not a creature, so it is not a
    // legal member of a `targetCreature` counted slot.
    const land = start.state.battlefield.find((oid) => oid !== creatureOid) ?? '';

    const error = validateAction(start.state, {
      type: 'castSpell',
      player: 0,
      oid: stakes,
      targets: [null],
      multiTargets: { 0: [land] },
    });
    expect(error).not.toBeNull();
  });
});

/**
 * `count` was `z.literal(2)` until `mtg-hgmz`. Downpour (M13 48, common) is
 * "Tap up to three target creatures.", one of the M11/M13 identities the DSL
 * refused, and the kernel already read the number rather than the literal:
 * `subsetsUpToSize(candidates, count, cap)` and `members.length > count` are
 * both generic. These are the tests that say so out loud, so a future
 * re-pinning of the schema has to break something.
 */
describe('a counted slot at three (mtg-hgmz)', () => {
  const DOWNPOUR: Card = instant(
    'Test Downpour',
    [{ kind: 'tapPermanent', target: { kind: 'targetCreature', count: 3 } }],
    { generic: 1, U: 1 },
  );

  it('offers zero through three members and taps all three', () => {
    const start = scenario({
      battlefield: [
        ...islands(2),
        { card: creature('Test Rain Bear A', 2, 2, { cost: { generic: 1 } }), controller: 1 },
        { card: creature('Test Rain Bear B', 2, 2, { cost: { generic: 1 } }), controller: 1 },
        { card: creature('Test Rain Bear C', 2, 2, { cost: { generic: 1 } }), controller: 1 },
      ],
      hands: [[DOWNPOUR], []],
    });
    const spell = playerOf(start.state, 0).hand[0] ?? '';
    const victims = [
      oidOf(start.state, 'Test Rain Bear A'),
      oidOf(start.state, 'Test Rain Bear B'),
      oidOf(start.state, 'Test Rain Bear C'),
    ];

    // Three creatures into a slot of up to three is every subset of them:
    // 2^3 = 8 member lists, which is the width this claim needs listed.
    const sizes = new Set(
      castOptions(start.state, spell, 2 ** victims.length)
        .filter((action): action is Extract<Action, { type: 'castSpell' }> => action.type === 'castSpell')
        .map((action) => action.multiTargets?.[0]?.length ?? 0),
    );
    expect([...sizes].sort()).toEqual([0, 1, 2, 3]);

    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: spell,
      targets: [null],
      multiTargets: { 0: victims },
    });
    const done = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(victims.every((oid) => done.state.objects[oid]?.tapped === true)).toBe(true);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
  });

  it('still refuses a fourth member', () => {
    const start = scenario({
      battlefield: [
        ...islands(2),
        { card: creature('Test Flood Bear A', 2, 2, { cost: { generic: 1 } }), controller: 1 },
        { card: creature('Test Flood Bear B', 2, 2, { cost: { generic: 1 } }), controller: 1 },
        { card: creature('Test Flood Bear C', 2, 2, { cost: { generic: 1 } }), controller: 1 },
        { card: creature('Test Flood Bear D', 2, 2, { cost: { generic: 1 } }), controller: 1 },
      ],
      hands: [[DOWNPOUR], []],
    });
    const spell = playerOf(start.state, 0).hand[0] ?? '';
    const error = validateAction(start.state, {
      type: 'castSpell',
      player: 0,
      oid: spell,
      targets: [null],
      multiTargets: {
        0: ['A', 'B', 'C', 'D'].map((suffix) => oidOf(start.state, `Test Flood Bear ${suffix}`)),
      },
    });
    expect(error).not.toBeNull();
  });
});
