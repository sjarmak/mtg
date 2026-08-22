/**
 * CR 608.2b takes the whole object, not the targeted half of it.
 *
 * "Destroy target artifact or enchantment. You gain 4 life" is one spell with
 * two instructions, and only the first names a target. When that target is
 * gone the rule removes the spell from the stack, so the life gain does not
 * happen either — the player who answered the removal spell answered all of
 * it. The kernel used to decide the question by asking whether any instruction
 * still had something to do, and an untargeted instruction always does, so the
 * spell resolved its second line off a stack it should never have left.
 *
 * The positive control is the same spell on a board where the target survives:
 * a kernel that had started fizzling everything would pass the first test and
 * fail this one.
 *
 * Abilities are here for the same reason `planResolution` is written over an
 * effect list rather than over a spell: an activated ability with the same two
 * instructions is rechecked by identical rules, and it reaches the recheck
 * through a different function.
 *
 * The last describe is the boundary of the rule rather than another reading of
 * it, and it is the distinction `@mtg/dsl`'s `targets.ts` argues at length:
 * "every one of them" is not "any one of them". Two separately chosen targets
 * are two independent rechecks, so a spell that loses one of them keeps the
 * other — and keeps every untargeted line, which the fizzle above would have
 * taken with it. A kernel that fizzled on the first illegal target instead of
 * on the last would pass both describes above and fail only that one.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { Action } from '@mtg/kernel';
import { eventsOfType, playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { PLAINS, artifact, creature, instant } from './cards';
import { oidOf } from './helpers';

/** Solemn Offering, with the rules text that makes the two halves visible. */
const OFFERING: Card = instant(
  'Test Offering',
  [
    { kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } },
    { kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } },
  ],
  { generic: 1, W: 1 },
);

/** The answer: it removes the offering's only target in response. */
const SHATTER: Card = instant(
  'Test Shatter',
  [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } }],
  { generic: 1, W: 1 },
);

const IDOL: Card = artifact('Test Idol', { generic: 2 });

/** The same two instructions, reached through an activation instead of a cast. */
const RELIQUARY: Card = artifact('Test Reliquary', { generic: 2 }, [
  {
    kind: 'activated',
    cost: { mana: { generic: 1 } },
    effects: [
      { kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } },
      { kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } },
    ],
  },
]);

/**
 * "Destroy target creature and target creature. You gain 4 life. Create a
 * 1/1 Spirit." — four instructions, two of them separately targeted, so the
 * board can take one target away and leave the other three lines alone.
 */
const RECKONING: Card = instant(
  'Test Reckoning',
  [
    { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    { kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: true } },
    { kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } },
    {
      kind: 'createToken',
      count: 1,
      token: {
        name: 'Test Spirit',
        power: 1,
        toughness: 1,
        colors: ['W'],
        subtypes: ['Spirit'],
        keywords: [],
      },
    },
  ],
  { generic: 2, W: 1 },
);

/** The answer to one of the reckoning's two targets, and only one of them. */
const SMITE: Card = instant(
  'Test Smite',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  { generic: 1, W: 1 },
);

const DOOMED: Card = creature('Test Doomed Ox', 2, 2, { cost: { generic: 1 } });
const SURVIVOR: Card = creature('Test Surviving Ox', 2, 2, { cost: { generic: 1 } });

const PASS_TWICE: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function plains(count: number): { card: typeof PLAINS; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: PLAINS, controller: 0 as const }));
}

describe('a spell whose only target is gone does none of its instructions', () => {
  it('gains no life when the artifact it named has been destroyed under it', () => {
    const start = scenario({
      battlefield: [...plains(6), { card: IDOL, controller: 1 }],
      hands: [[OFFERING, SHATTER], []],
      life: [20, 20],
    });
    const idol = oidOf(start.state, 'Test Idol');
    const [offering, shatter] = playerOf(start.state, 0).hand;
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: offering ?? '',
      targets: [{ kind: 'permanent', oid: idol }, null],
    });
    const answered = reduce(cast.state, {
      type: 'castSpell',
      player: 0,
      oid: shatter ?? '',
      targets: [{ kind: 'permanent', oid: idol }],
    });

    const done = reduceAll(answered.state, [...PASS_TWICE, ...PASS_TWICE]);

    expect(eventsOfType(done.events, 'spellFizzled').map((event) => event.oid)).toEqual([offering]);
    expect(done.state.players[0].life).toBe(20);
    expect(done.state.objects[idol]?.zone).toBe('graveyard');
    expect(playerOf(done.state, 0).graveyard).toContain(offering);
  });

  it('gains the life and destroys the artifact when the target is still there', () => {
    const start = scenario({
      battlefield: [...plains(6), { card: IDOL, controller: 1 }],
      hands: [[OFFERING], []],
      life: [20, 20],
    });
    const idol = oidOf(start.state, 'Test Idol');
    const offering = playerOf(start.state, 0).hand[0];
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: offering ?? '',
      targets: [{ kind: 'permanent', oid: idol }, null],
    });

    const done = reduceAll(cast.state, PASS_TWICE);

    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
    expect(done.state.players[0].life).toBe(24);
    expect(done.state.objects[idol]?.zone).toBe('graveyard');
  });
});

describe('an ability whose only target is gone does none of its instructions', () => {
  it('gains no life when the artifact it named has been destroyed under it', () => {
    const start = scenario({
      battlefield: [...plains(6), { card: RELIQUARY, controller: 0 }, { card: IDOL, controller: 1 }],
      hands: [[SHATTER], []],
      life: [20, 20],
    });
    const idol = oidOf(start.state, 'Test Idol');
    const reliquary = oidOf(start.state, 'Test Reliquary');
    const shatter = playerOf(start.state, 0).hand[0];
    const activated = reduce(start.state, {
      type: 'activateAbility',
      player: 0,
      oid: reliquary,
      abilityIndex: 0,
      targets: [{ kind: 'permanent', oid: idol }, null],
      sacrifices: [],
    });
    const answered = reduce(activated.state, {
      type: 'castSpell',
      player: 0,
      oid: shatter ?? '',
      targets: [{ kind: 'permanent', oid: idol }],
    });

    const done = reduceAll(answered.state, [...PASS_TWICE, ...PASS_TWICE]);

    expect(done.state.stack).toEqual([]);
    expect(done.state.players[0].life).toBe(20);
    expect(done.state.objects[idol]?.zone).toBe('graveyard');
  });
});

describe('a spell that loses one of two separately chosen targets resolves the rest', () => {
  /** Both oxen named, the first one answered, the whole spell then resolved. */
  function play(answered: boolean): {
    result: ReturnType<typeof reduceAll>;
    doomed: string;
    survivor: string;
  } {
    const start = scenario({
      battlefield: [...plains(6), { card: DOOMED, controller: 1 }, { card: SURVIVOR, controller: 1 }],
      hands: [[RECKONING, SMITE], []],
      life: [20, 20],
    });
    const doomed = oidOf(start.state, 'Test Doomed Ox');
    const survivor = oidOf(start.state, 'Test Surviving Ox');
    const [reckoning, smite] = playerOf(start.state, 0).hand;
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: reckoning ?? '',
      targets: [{ kind: 'permanent', oid: doomed }, { kind: 'permanent', oid: survivor }, null, null],
    });
    if (!answered) return { result: reduceAll(cast.state, PASS_TWICE), doomed, survivor };
    const response = reduce(cast.state, {
      type: 'castSpell',
      player: 0,
      oid: smite ?? '',
      targets: [{ kind: 'permanent', oid: doomed }],
    });
    return {
      result: reduceAll(response.state, [...PASS_TWICE, ...PASS_TWICE]),
      doomed,
      survivor,
    };
  }

  function spirits(state: ReturnType<typeof reduceAll>['state']): number {
    return state.battlefield.filter((oid) => state.objects[oid]?.card.name === 'Test Spirit').length;
  }

  it('keeps the surviving kill and both untargeted lines, and skips only the dead slot', () => {
    const { result, doomed, survivor } = play(true);

    expect(eventsOfType(result.events, 'spellFizzled')).toEqual([]);
    expect(result.state.objects[survivor]?.zone).toBe('graveyard');
    expect(result.state.players[0].life).toBe(24);
    expect(spirits(result.state)).toBe(1);
    expect(eventsOfType(result.events, 'effectSkipped').map((event) => event.index)).toEqual([0]);
    // The first ox is in the graveyard because the answer put it there, which
    // is the premise rather than a fifth assertion about the reckoning.
    expect(result.state.objects[doomed]?.zone).toBe('graveyard');
  });

  it('skips nothing and kills both when neither target is answered', () => {
    const { result, doomed, survivor } = play(false);

    expect(eventsOfType(result.events, 'effectSkipped')).toEqual([]);
    expect(result.state.objects[doomed]?.zone).toBe('graveyard');
    expect(result.state.objects[survivor]?.zone).toBe('graveyard');
    expect(result.state.players[0].life).toBe(24);
    expect(spirits(result.state)).toBe(1);
  });
});
