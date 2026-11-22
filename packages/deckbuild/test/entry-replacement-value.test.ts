/**
 * Every arm of the entry-replacement union has a price, and each price is
 * arithmetic this file can restate from a weight that was already in
 * `config.ts` (`mtg-pr8a`).
 *
 * The defect was the third instance of `mtg-gloz`'s failure mode and the second
 * one found by measurement rather than by a bug report: `evaluateCard` read
 * `card.entryReplacement` nowhere, so a 2/2 for `{1}{G}` arriving with two
 * `+1/+1` counters — a 4/4 for two mana — and a plain 2/2 were one number to
 * `buildDeck`, and so was the same 2/2 arriving tapped. Eleven nonland cards in
 * the reduced M11 and M13 print one.
 *
 * The table below is keyed by the union's own discriminant, so an arm added to
 * `PermanentEntryReplacementSchema` or `LandEntryReplacementSchema` fails to
 * compile here until somebody says what it is worth. That is the half that does
 * not go stale; the numbers are the half that says the price is derived rather
 * than picked, and a retune of `tapPermanent` or of the stat weights moves both
 * sides of every expectation at once.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, LandEntryReplacement, PermanentEntryReplacement } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, EFFECT_PRICING, evaluateCard } from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;

/** The same stat arithmetic `evaluate.ts` prices a body with. */
function stats(power: number, toughness: number): number {
  return WEIGHTS.creaturePowerWeight * power + WEIGHTS.creatureToughnessWeight * toughness;
}

/** One tap, unscoped and with no held-tap rider: what arriving tapped costs. */
const ONE_TAP = EFFECT_PRICING.tapPermanent.base + EFFECT_PRICING.tapPermanent.perUnit;

let minted = 0;
function build(over: Record<string, unknown>): Card {
  minted += 1;
  return parseCard({
    id: `ent-${minted}`,
    name: `Entrant ${minted}`,
    rarity: 'common',
    set: { code: 'ENT', collectorNumber: minted },
    ...over,
  } as CardInput);
}

const BEAR = { kind: 'creature', manaCost: { generic: 1, G: 1 }, colors: ['G'], power: 2, toughness: 2 };
const ROCK = { kind: 'artifact', manaCost: { generic: 2 }, colors: [] };
const TAPPER = {
  ...ROCK,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['G'], amount: 1 }],
    },
  ],
};
const FOREST = { kind: 'land', colors: [], producesMana: ['G'] };

type EntryReplacementKind = (LandEntryReplacement | PermanentEntryReplacement)['kind'];

interface Case {
  /** What the card is, without the clause. */
  readonly host: Record<string, unknown>;
  readonly clause: LandEntryReplacement | PermanentEntryReplacement;
  /** The whole of the delta, restated from weights rather than copied from a run. */
  readonly worth: number;
  readonly why: string;
}

/** Every arm, and at least one card per arm. Total by construction. */
const CASES: Record<EntryReplacementKind, readonly Case[]> = {
  payLifeOrEntersTapped: [
    {
      host: FOREST,
      clause: { kind: 'payLifeOrEntersTapped', life: 2 },
      worth: 0,
      why: 'A land can pay the life and arrive untapped; land bodies are priced by the mana base rather than this evaluator.',
    },
  ],
  entersTapped: [
    {
      host: BEAR,
      clause: { kind: 'entersTapped' },
      worth: -ONE_TAP,
      why: 'A tapped creature cannot block, and blocking is the half of its first turn summoning sickness left it.',
    },
    {
      host: TAPPER,
      clause: { kind: 'entersTapped' },
      worth: -ONE_TAP,
      why: 'A mana rock that arrives tapped loses the activation it arrived for.',
    },
    {
      host: ROCK,
      clause: { kind: 'entersTapped' },
      worth: 0,
      why: 'An artifact that never taps for anything loses nothing by arriving tapped, and charging it would price a word rather than what the word does.',
    },
  ],
  entersWithCounters: [
    {
      host: BEAR,
      clause: { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 2 },
      worth: stats(2, 2),
      why: 'The body it actually has. A 2/2 that arrives with two +1/+1 counters is a 4/4 for two mana.',
    },
    {
      host: BEAR,
      clause: { kind: 'entersWithCounters', counter: 'minusOneMinusOne', count: 1 },
      worth: stats(-1, -1),
      why: 'These counters land on this card, so a shrink is a smaller body — not `putCounters`’s shrink arm, which reads a shrink aimed at an opponent.',
    },
  ],
  putCounterOnControlledPermanent: [
    {
      host: BEAR,
      clause: {
        kind: 'putCounterOnControlledPermanent',
        permanentType: 'creature',
        counter: 'plusOnePlusOne',
        count: 2,
      },
      worth: 2 * stats(1, 1),
      why: 'The same counters on another body, at the same per-counter arithmetic `EFFECT_PRICING.putCounters` charges.',
    },
    {
      host: BEAR,
      clause: {
        kind: 'putCounterOnControlledPermanent',
        permanentType: 'land',
        counter: 'plusOnePlusOne',
        count: 3,
      },
      worth: 0,
      why: 'A land has no body to grow, which is `config.ts`’s own sentence about a permanent with no body at all.',
    },
  ],
  entersAsCharacteristicChoice: [
    {
      host: { ...BEAR, power: 1, toughness: 1 },
      clause: {
        kind: 'entersAsCharacteristicChoice',
        modes: [
          { power: 3, toughness: 3 },
          { power: 1, toughness: 6 },
        ],
      },
      worth: Math.max(stats(3, 3), stats(1, 6)) - stats(1, 1),
      why: 'The mode is chosen as the permanent enters, after its controller has seen the board, so it is worth the best of them.',
    },
  ],
  entersAsCopyOfCreature: [
    {
      host: BEAR,
      clause: { kind: 'entersAsCopyOfCreature' },
      worth: 0,
      why: 'Nothing with no deck in hand, and the deck is what answers it (mtg-8w1r): clone-body.test.ts prices the same clause against one.',
    },
  ],
  choosePlayer: [
    {
      host: BEAR,
      clause: { kind: 'choosePlayer' },
      worth: 0,
      why: 'A decision: in a two-player game the choice is the opponent, and the clause rides on other text priced where it is printed.',
    },
  ],
  entersTappedUnlessControlsLandSubtype: [
    {
      host: FOREST,
      clause: { kind: 'entersTappedUnlessControlsLandSubtype', landTypes: ['Forest'] },
      worth: 0,
      why: 'Only a land prints it, and every land scores zero because which lands a deck plays is `mana-base.ts`’s decision (mtg-h6ut).',
    },
  ],
};

const score = (card: Card): number => evaluateCard(card, WEIGHTS).score;

describe('what replacing your own entry is worth', () => {
  for (const [kind, cases] of Object.entries(CASES)) {
    it(`${kind}: has at least one card that prints it`, () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    for (const [index, probe] of cases.entries()) {
      it(`${kind}[${index}]: ${probe.why}`, () => {
        const withClause = build({ ...probe.host, entryReplacement: probe.clause });
        const without = build(probe.host);
        expect(score(withClause) - score(without)).toBeCloseTo(probe.worth, 10);
      });
    }
  }

  it('charges a body that arrives bigger what a body that size costs', () => {
    const grown = build({
      ...BEAR,
      entryReplacement: { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 2 },
    });
    const printed = build({ ...BEAR, power: 4, toughness: 4 });
    // Not the same score — the printed 4/4 pays no more mana for being one, and
    // the counters do not move `keywordAbilities`' body share — but the same
    // number for the two points of power and two of toughness, which is the
    // claim that stops one rules text from having two prices.
    expect(score(grown) - score(build(BEAR))).toBeCloseTo(score(printed) - score(build(BEAR)), 10);
  });

  it('never lets a land score anything, whatever it replaces its entry with', () => {
    for (const clause of [
      { kind: 'entersTapped' } as const,
      { kind: 'entersTappedUnlessControlsLandSubtype', landTypes: ['Forest'] } as const,
      { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 2 } as const,
    ]) {
      expect(score(build({ ...FOREST, entryReplacement: clause }))).toBe(0);
    }
  });
});
