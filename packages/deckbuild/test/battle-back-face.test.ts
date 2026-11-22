/**
 * What a Siege flips into (`mtg-2y9u`).
 *
 * The battle arm priced `manaValue` and `creatureToughnessWeight * defense` and
 * read `card.backFace` nowhere, so a four-mana Siege that flips into an 8/8 and
 * one that flips into a 1/1 were the same number. The reward is the whole
 * reason the card is in a deck: the kernel exiles the defeated battle and hands
 * its controller a free cast of the back face (`stack.ts`,
 * `awaitTransformedFreeCast`), so what the back face is worth is what that card
 * is worth cast for nothing.
 *
 * The discount is two existing rows multiplied, each for the clause it already
 * names, and the identity is asserted here rather than left in a comment.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard, transformedBackFaceOf } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;

let serial = 900;

function siege(back: Record<string, unknown> | undefined, over: Record<string, unknown> = {}): CardInput {
  serial += 1;
  return {
    kind: 'battle',
    id: `siege-${String(serial)}`,
    name: `Siege ${String(serial)}`,
    rarity: 'rare',
    set: { code: 'SGE', collectorNumber: serial },
    manaCost: { generic: 3, G: 1 },
    colors: ['G'],
    subtypes: ['Siege'],
    defense: 4,
    ...(back === undefined ? {} : { backFace: back }),
    ...over,
  } as CardInput;
}

const body = (power: number, toughness: number): Record<string, unknown> => ({
  kind: 'creature',
  name: `Siege Back ${String(power)}/${String(toughness)}`,
  colors: ['G'],
  subtypes: ['Warrior'],
  power,
  toughness,
});

function score(input: CardInput): number {
  return evaluateCard(parseCard(input), WEIGHTS).score;
}

/** What the back face is worth on its own, which is what the arm discounts. */
function freeCastScore(input: CardInput): number {
  const front = parseCard(input);
  if (front.kind !== 'battle') throw new Error('the probe is not a battle');
  const back = transformedBackFaceOf(front);
  if (back === null) throw new Error('the probe prints no back face');
  return evaluateCard(back, WEIGHTS).score;
}

describe("a battle's back face", () => {
  it('is discounted by two rows already in the table, one per clause it costs', () => {
    // `enabledWhileFactor` is what this table pays for a thing that is off some
    // of the time, and a back face is off until the battle is defeated and may
    // never come on. The other third is the timing clause inside
    // `removalPremiumActivatedScale`'s halving — the reward is not there the
    // turn the battle lands — which is the same third `instantSpeedPremium`
    // reads off that row.
    expect(WEIGHTS.battleBackFaceFactor).toBeCloseTo(
      WEIGHTS.enabledWhileFactor * (1 - (1 - WEIGHTS.removalPremiumActivatedScale) / 3),
      10,
    );
  });

  it('separates an 8/8 from a 1/1 behind the same defense', () => {
    const big = siege(body(8, 8));
    const small = siege(body(1, 1));
    expect(score(big)).toBeGreaterThan(score(small));
    expect(score(big) - score(small)).toBeCloseTo(
      (freeCastScore(big) - freeCastScore(small)) * WEIGHTS.battleBackFaceFactor,
      10,
    );
  });

  it('is the back face cast for nothing, times the factor, and not a number of its own', () => {
    const probe = siege(body(5, 5));
    const component = evaluateCard(parseCard(probe), WEIGHTS).components.find(
      (entry) => entry.name === 'backFace',
    );
    expect(component?.value).toBeCloseTo(freeCastScore(probe) * WEIGHTS.battleBackFaceFactor, 10);
  });

  it('prices whatever the face is, not only a creature', () => {
    const spell = siege({
      kind: 'sorcery',
      name: 'Siege Back Spell',
      colors: ['G'],
      effects: [{ kind: 'drawCards', count: 3, target: { kind: 'noTarget' } }],
    });
    const component = evaluateCard(parseCard(spell), WEIGHTS).components.find(
      (entry) => entry.name === 'backFace',
    );
    expect(component?.value).toBeCloseTo(freeCastScore(spell) * WEIGHTS.battleBackFaceFactor, 10);
  });

  it('names nothing when the battle prints no back face', () => {
    // Only a Siege transforms, and the validator holds the two halves of that
    // to one contract in both directions, so the battle with no reward to
    // price is the one with no Siege on its type line.
    const plain = siege(undefined, { subtypes: [] });
    const evaluation = evaluateCard(parseCard(plain), WEIGHTS);
    expect(evaluation.components.some((entry) => entry.name === 'backFace')).toBe(false);
  });

  it('leaves the defense reading alone, so the two halves stay separable', () => {
    // Defense is priced where it always was and this arm does not touch it: a
    // deeper Siege is a harder Siege to break, and that the reward is not
    // discounted by how much defense stands in front of it is `mtg-lrg9`.
    const shallow = siege(body(4, 4), { defense: 1 });
    const deep = siege(body(4, 4), { defense: 8 });
    expect(score(deep) - score(shallow)).toBeCloseTo(WEIGHTS.creatureToughnessWeight * 7, 10);
  });

  it('is a weight a caller can override, like every other row in the table', () => {
    const overridden = { ...WEIGHTS, battleBackFaceFactor: 0 };
    const big = evaluateCard(parseCard(siege(body(8, 8))), overridden).score;
    const small = evaluateCard(parseCard(siege(body(1, 1))), overridden).score;
    expect(big).toBeCloseTo(small, 10);
  });
});
