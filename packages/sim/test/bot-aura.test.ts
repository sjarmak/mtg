/**
 * The bot has to know which side of the table an Aura belongs on.
 *
 * `bot-equip.test.ts` makes this argument for an equip ability, whose payload is
 * an attach clause rather than an effect list, and an Aura is the same hole in
 * the other policy: CR 303.4 gives it a host and no effects, so
 * `card.effects` is empty, so the sum `scoreEffectTargets` takes over the effect
 * list is zero for every legal host. The kernel enumerates the host as
 * `targets[0]` (`legal.ts`'s `castOptions` reads `isAuraCard` before it reads
 * the effect list) and the policy priced every one of those tuples identically,
 * so which creature got enchanted was enumeration order, which is battlefield
 * order, which is arrival order.
 *
 * Nothing went red. `ownGoalPenalty` is what stops removal pointing at our own
 * board and it is charged per effect, so an Aura walked past it: a hostile one
 * landed on the bot's own best creature and killed it, and a beneficial one
 * armed the opponent's.
 *
 * The assertions are `bot-equip`'s: not only that the number moved, but that the
 * action the bot submits aims at the other creature, taken from a real
 * `pendingDecision` and re-checked with `validateAction`.
 *
 * The four Auras are M11 printings, chosen because the printed vocabulary splits
 * both ways and these are the four shapes it splits into — a rate that shrinks
 * the host, a pair of combat restrictions, a rate that grows it plus a keyword,
 * and a control change.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { GameState, ObjectId, PlayerId, Target } from '@mtg/kernel';
import { pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { chooseCast, DEFAULT_GREEDY_CONFIG, scoreTargets } from '@mtg/sim';
import { creature, PLAINS, SWAMP } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

/** `Enchanted creature gets -1/-1 for each Swamp you control.` — Quag Sickness (M11 111). */
const SICKNESS: Card = parseCard({
  kind: 'enchantment',
  id: 'ref-quag-sickness',
  name: 'Quag Sickness',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 111 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      {
        kind: 'statBonusPer',
        power: -1,
        toughness: -1,
        each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
      },
    ],
  },
});

/** `Enchanted creature can't attack or block.` — Pacifism (M11 20), the clause with no body change at all. */
const PACIFISM: Card = parseCard({
  kind: 'enchantment',
  id: 'ref-pacifism',
  name: 'Pacifism',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 20 },
  manaCost: { generic: 1, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [{ kind: 'cantAttack' }, { kind: 'cantBlock' }] },
});

/** `Enchanted creature gets +1/+1 for each Plains you control and has flying.` — Armored Ascension (M11 5). */
const ASCENSION: Card = parseCard({
  kind: 'enchantment',
  id: 'ref-armored-ascension',
  name: 'Armored Ascension',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 5 },
  manaCost: { generic: 3, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      {
        kind: 'statBonusPer',
        power: 1,
        toughness: 1,
        each: { kind: 'landsWithSubtype', subtype: 'Plains', whose: 'you' },
      },
      { kind: 'grantKeyword', keyword: 'flying' },
    ],
  },
});

/** `You control enchanted creature.` — Mind Control (M11 55), the one clause that moves the body. */
const MIND_CONTROL: Card = parseCard({
  kind: 'enchantment',
  id: 'ref-mind-control',
  name: 'Mind Control',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 55 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [{ kind: 'gainControl' }] },
});

const BEAR = creature('Runeclaw Bear', 2, 2);
const OGRE = creature('Opposing Ogre', 6, 6);

/**
 * One Aura in hand, one creature each side, and just enough basics to cast it —
 * the same count the rate clauses tally, so the board the policy reads is the
 * board the layer walk would.
 */
function contested(aura: Card, land: Card, lands: number, seed: string): GameState {
  return scenario({
    seed,
    battlefield: [
      ...Array.from({ length: lands }, () => ({ card: land, controller: 0 as PlayerId })),
      { card: BEAR, controller: 0 as PlayerId },
      { card: OGRE, controller: 1 as PlayerId },
    ],
    hands: [[aura], []],
  }).state;
}

function named(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

function at(oid: ObjectId): readonly (Target | null)[] {
  return [{ kind: 'permanent', oid }];
}

/** What the policy pays for putting this Aura on this host. */
function score(state: GameState, aura: Card, oid: ObjectId): number {
  return scoreTargets(state, 0, aura, at(oid), config.cast, config.target, config.race);
}

/** The host the bot's own chosen cast aims at, re-checked against the kernel. */
function chosenHost(state: GameState): ObjectId {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  const action = chooseCast({ state, player: 0, decision }, config);
  if (action === null) throw new Error('the bot declined to cast the Aura');
  expect(validateAction(state, action)).toBeNull();
  const target = action.targets[0];
  if (target === undefined || target === null || target.kind !== 'permanent') {
    throw new Error('the cast chose no permanent');
  }
  return target.oid;
}

describe('a hostile Aura', () => {
  it('scores higher on the opponent creature than on our own', () => {
    const state = contested(SICKNESS, SWAMP, 3, 'sim/aura/sickness');
    const mine = score(state, SICKNESS, named(state, 'Runeclaw Bear'));
    const theirs = score(state, SICKNESS, named(state, 'Opposing Ogre'));
    // Three Swamps make it -3/-3, which is lethal on the 2/2 and a debuff on
    // the 6/6: -50 and +6.3 against 0 and 0 before this policy knew what an
    // Aura was.
    expect(mine).toBeLessThan(0);
    expect(theirs).toBeGreaterThan(0);
    expect(theirs).toBeGreaterThan(mine);
  });

  it('is the host the bot actually chooses', () => {
    const state = contested(SICKNESS, SWAMP, 3, 'sim/aura/sickness/cast');
    expect(chosenHost(state)).toBe(named(state, 'Opposing Ogre'));
  });

  it('scores higher on the opponent creature when the clause is a combat restriction', () => {
    const state = contested(PACIFISM, PLAINS, 2, 'sim/aura/pacifism');
    const mine = score(state, PACIFISM, named(state, 'Runeclaw Bear'));
    const theirs = score(state, PACIFISM, named(state, 'Opposing Ogre'));
    // No characteristic moves, so nothing dies and the whole score is the
    // combat-denial share of what answering the body is worth: -50 and +15.7.
    expect(mine).toBeLessThan(0);
    expect(theirs).toBeGreaterThan(0);
    expect(theirs).toBeGreaterThan(mine);
    expect(chosenHost(state)).toBe(named(state, 'Opposing Ogre'));
  });
});

describe('a beneficial Aura', () => {
  it('scores higher on our own creature than on the opponent', () => {
    const state = contested(ASCENSION, PLAINS, 4, 'sim/aura/ascension');
    const mine = score(state, ASCENSION, named(state, 'Runeclaw Bear'));
    const theirs = score(state, ASCENSION, named(state, 'Opposing Ogre'));
    // +8.7 on ours against -50 on theirs, the two branches the other way round.
    expect(mine).toBeGreaterThan(0);
    expect(theirs).toBeLessThan(0);
    expect(mine).toBeGreaterThan(theirs);
    expect(chosenHost(state)).toBe(named(state, 'Runeclaw Bear'));
  });
});

describe('a control-change Aura', () => {
  it('scores higher on the opponent creature, which is the only one worth taking', () => {
    const state = contested(MIND_CONTROL, PLAINS, 4, 'sim/aura/mind-control');
    const mine = score(state, MIND_CONTROL, named(state, 'Runeclaw Bear'));
    const theirs = score(state, MIND_CONTROL, named(state, 'Opposing Ogre'));
    // +28.5 on theirs, which is the answer plus the body: the swing is two
    // creatures wide, so it prices above every other clause here on the same
    // target. Ours is the -50, because taking a creature we already control is
    // a blank card and not a bargain.
    expect(mine).toBeLessThan(0);
    expect(theirs).toBeGreaterThan(0);
    expect(theirs).toBeGreaterThan(mine);
  });
});
