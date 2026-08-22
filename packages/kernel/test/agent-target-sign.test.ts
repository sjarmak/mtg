/**
 * Which side of the table the kernel's own bot points a spell at.
 *
 * `simpleAgent` is not the bot tier — `@mtg/sim` is where target choice is a
 * policy — but it is the opponent `npm run play` deals, so every one of its
 * target choices is something a person watches happen. `effectTargetBonus`
 * scores a target tuple as `harmful === !owned`, and that equality is what
 * makes the harmful/not-harmful answer load-bearing in *both* directions: an
 * effect kind the function does not recognize is not scored neutrally, it is
 * scored as a gift, so the bot aims it at its own board and is penalized for
 * aiming it anywhere else.
 *
 * The first test is a game the playtester played on 2026-08-18: the bot cast "Exile
 * target creature. You gain 2 life." on a 1/3 it had played itself. The rest
 * are the same defect in the two other places it was hiding — a stat change is
 * pointed by its sign rather than by its kind, and the sign was read for
 * neither `pumpUntilEndOfTurn` nor an unscoped `putCounters`, which between
 * them are eight cards in the flagship set.
 *
 * The assertion is the *choice*, not the outcome. A bot that picks right for
 * the wrong reason still picks right, and a bot that picks wrong has already
 * lost the game by the time the board shows it.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Effect } from '@mtg/dsl';
import type { Action, ObjectId } from '@mtg/kernel';
import { pendingDecision, scenario, simpleAgent } from '@mtg/kernel';
import { creature, FOREST, instant, lands } from './cards';
import { oidOf } from './helpers';

const MINE = 'Pasture Goat';
const THEIRS = 'Brigand Scout';

/**
 * The bot (player 0) holds one spell, and each player controls one creature of
 * the same size, so nothing but the controller separates the two targets.
 *
 * Same size on purpose: `effectTargetBonus` adds the target's power and
 * toughness to a desirable choice, so a test whose two creatures differed would
 * pass on the stat line even with the sign backwards.
 *
 * The return is the pick *and* the two oids it could have been, because the
 * scenario has to be built once for both: an oid is a position in one game's
 * object table and means nothing in another.
 */
function aim(spell: Card): {
  readonly picked: ObjectId | null;
  readonly mine: ObjectId;
  readonly theirs: ObjectId;
} {
  const start = scenario({
    battlefield: [
      { card: creature(MINE, 1, 3), controller: 0 },
      { card: creature(THEIRS, 1, 3), controller: 1 },
      ...lands(FOREST, 4).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[spell], []],
  });
  const state = start.state;
  const mine = oidOf(state, MINE);
  const theirs = oidOf(state, THEIRS);

  const decision = pendingDecision(state);
  if (decision === null || decision.kind !== 'priority') throw new Error('the bot was not offered priority');
  // Both readings have to be on the table for the choice between them to mean
  // anything: a spell the kernel only ever offered pointed one way would pass
  // this file with the sign backwards.
  const offered = decision.options
    .filter((option): option is Extract<Action, { type: 'castSpell' }> => option.type === 'castSpell')
    .map((option) => firstPermanent(option));
  expect(new Set(offered)).toStrictEqual(new Set([mine, theirs]));

  const picked = simpleAgent('bot').decide({ state, player: 0, decision });
  if (picked.type !== 'castSpell') throw new Error(`the bot did something other than cast: ${picked.type}`);
  return { picked: firstPermanent(picked), mine, theirs };
}

/** The permanent a cast points its first target at, or `null` when it points at nobody. */
function firstPermanent(action: Extract<Action, { type: 'castSpell' }>): ObjectId | null {
  const first = action.targets[0];
  return first?.kind === 'permanent' ? first.oid : null;
}

/** Two effects, because the reported card had two and the second one is a gift to its caster. */
const SEALED_AWAY: readonly Effect[] = [
  { kind: 'exileTarget', target: { kind: 'targetCreature' } },
  { kind: 'gainLife', amount: 2, target: { kind: 'targetPlayer' } },
];

const SHRINK: readonly Effect[] = [
  { kind: 'pumpUntilEndOfTurn', power: -3, toughness: -3, target: { kind: 'targetCreature' } },
];
const PUMP: readonly Effect[] = [
  { kind: 'pumpUntilEndOfTurn', power: 3, toughness: 3, target: { kind: 'targetCreature' } },
];
const GLOOM: readonly Effect[] = [
  { kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'targetCreature' } },
];
const GROW: readonly Effect[] = [
  { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
];
const KILL: readonly Effect[] = [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }];

describe('the kernel bot aims a spell by what the spell does', () => {
  it('exiles the creature it does not control', () => {
    const { picked, theirs } = aim(instant('Sealed Away', SEALED_AWAY));
    expect(picked).toBe(theirs);
  });

  it('shrinks the creature it does not control', () => {
    const { picked, theirs } = aim(instant('Withering Glare', SHRINK));
    expect(picked).toBe(theirs);
  });

  it('pumps the creature it does control, which is the same sign read the other way', () => {
    const { picked, mine } = aim(instant('Rallying Shout', PUMP));
    expect(picked).toBe(mine);
  });

  it('glooms the creature it does not control, with no scope to read the sign off', () => {
    const { picked, theirs } = aim(instant('Swallowed by Gloom', GLOOM));
    expect(picked).toBe(theirs);
  });

  it('grows the creature it does control, which is the same counter read the other way', () => {
    const { picked, mine } = aim(instant('Mighty Banana Feast', GROW));
    expect(picked).toBe(mine);
  });

  it('destroys the creature it does not control, which never regressed and is the control', () => {
    const { picked, theirs } = aim(instant('Claimed by the Depths', KILL));
    expect(picked).toBe(theirs);
  });
});
