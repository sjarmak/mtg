/**
 * A permanent's text is worth something on the battlefield, not only in hand.
 *
 * `printedCreatureValue` has summed abilities since the ability model landed and
 * `boardCreatureValue` did not, so a lord in hand was a vanilla body plus a line
 * of text and the same lord on the battlefield was a vanilla body. Three
 * policies read the board figure and each of them was wrong in the same
 * direction: the block policy deciding whether a trade is worth it, the chump
 * ordering deciding which creature is cheapest to throw away, and the targeting
 * policy deciding where removal points. Killing a permanent takes its text as
 * well as its body.
 *
 * The hard half is not adding the term, it is not adding it twice.
 * `boardCreatureValue` already reads `powerOf`, `toughnessOf` and `hasKeyword`,
 * so whatever a static grants to its own source is in the figure before any
 * ability is looked at. `boardStaticReach` subtracts exactly the one permanent
 * the layers already spoke for, and the `self` case below is what proves it —
 * without that assertion, a `boardStaticReach` returning the full reach for
 * every scope passes every other test in this file.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from '@mtg/kernel';
import type { GameState, ObjectId } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, boardCreatureValue } from '@mtg/sim';
import { parseCard } from '@mtg/dsl';
import type { AbilityInput, Card, CardInput } from '@mtg/dsl';

const config = DEFAULT_GREEDY_CONFIG.cast;

const SELF_PUMP: AbilityInput = {
  kind: 'static',
  scope: 'self',
  subtype: null,
  modification: { kind: 'statBonus', power: 1, toughness: 1 },
};

const TEAM_PUMP: AbilityInput = {
  kind: 'static',
  scope: 'creaturesYouControl',
  subtype: null,
  modification: { kind: 'statBonus', power: 1, toughness: 1 },
};

const OTHERS_PUMP: AbilityInput = {
  kind: 'static',
  scope: 'otherCreaturesYouControl',
  subtype: null,
  modification: { kind: 'statBonus', power: 1, toughness: 1 },
};

const ENTERS_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
};

let serial = 0;

function body(name: string, power: number, toughness: number, abilities: readonly AbilityInput[]): Card {
  serial += 1;
  const input: CardInput = {
    kind: 'creature',
    id: `ba-${serial}`,
    name,
    rarity: 'common',
    set: { code: 'BAT', collectorNumber: serial },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    abilities: [...abilities],
    power,
    toughness,
  };
  return parseCard(input);
}

/** The board value of one card, alone on its controller's battlefield. */
function valueAlone(card: Card): number {
  const start = scenario({
    seed: `sim/board-abilities/${card.id}`,
    battlefield: [{ card, controller: 0 }],
  });
  const oid = onlyCreature(start.state, card.name);
  return boardCreatureValue(config, start.state, oid);
}

function onlyCreature(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`${name} is not on the battlefield`);
  return found;
}

describe('a permanent is worth its text as well as its body', () => {
  it('values a trigger by exactly what the same trigger is worth in hand', () => {
    const plain = valueAlone(body('Plain Two', 2, 2, []));
    const withTrigger = valueAlone(body('Scout Two', 2, 2, [ENTERS_TRIGGER]));
    expect(withTrigger - plain).toBeCloseTo(config.triggerValue.selfEnters, 10);
  });

  /**
   * THE DISCRIMINATING CASE. A `self` static is already in `powerOf` and
   * `toughnessOf`, so a 2/2 that pumps itself must be worth exactly what a
   * printed 3/3 is worth and not a point more. Counting the ability again is
   * the double count this arm exists to prevent, and it is invisible to every
   * other assertion here.
   */
  it('does not count a self static twice, because the layers already applied it', () => {
    const pumped = valueAlone(body('Self Pump', 2, 2, [SELF_PUMP]));
    const printed = valueAlone(body('Printed Three', 3, 3, []));
    expect(pumped).toBeCloseTo(printed, 10);
  });

  /**
   * The two group scopes come out equal, and that is the invariant rather than
   * a coincidence. A team pump reaches its own source, so the layers put that
   * buff in the body and `boardStaticReach` shortens the ability term by one
   * permanent; an anthem that excludes itself leaves the body alone and keeps
   * the full term. The same grant is counted once either way, so the totals
   * meet.
   *
   * Swap the two scope arms and each side moves by one grant in opposite
   * directions, so this is the assertion that catches it.
   */
  it('reaches the same total whether a pump includes its own source or not', () => {
    const team = valueAlone(body('Team Pump', 2, 2, [TEAM_PUMP]));
    const others = valueAlone(body('Others Pump', 2, 2, [OTHERS_PUMP]));
    expect(team).toBeCloseTo(others, 10);
  });

  it('is worth more with an anthem than without one', () => {
    expect(valueAlone(body('Anthem Body', 2, 2, [OTHERS_PUMP]))).toBeGreaterThan(
      valueAlone(body('Bare Body', 2, 2, [])),
    );
  });
});
