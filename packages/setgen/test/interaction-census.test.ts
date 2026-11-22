/**
 * The interaction census, and the four places a lever hides from it.
 *
 * the original interaction-lever study took this reading once off a scratch
 * script, and the reading it published is one card list behind and cannot be
 * re-derived from anything committed. So what is worth asserting here is not a
 * figure. It is the properties whose absence is what made the first reading
 * unrepeatable, each one invisible on a small pool and each one worth cards on a
 * real one:
 *
 *  1. **A target spec is found by parsing, not by field name.** Forty-one effect
 *     builders in `effects.ts` take the spec as a parameter and the field it
 *     lands in is theirs to name. A reader keyed to `target` counts whichever
 *     ones spell it that way on the day it is written, and silently stops
 *     counting the next one.
 *  2. **At any depth.** A narrowing printed on a triggered ability's effect, on
 *     a mode, or on the line of a token the card creates is a narrowing a player
 *     has to satisfy, and the shallow walk is the one that reports a set as
 *     printing none.
 *  3. **The two activated readings are both stated.** Every ability printed on a
 *     token in the flagship is an activated ability, so the descent moves that
 *     one count and nothing else. A tool that picked one silently would publish
 *     a number two documents in this tree already contradict.
 *  4. **A vocabulary member printed zero times is reported.** The load-bearing
 *     half of a census is what is missing, and absence is the half that cannot
 *     be read off a tally of what is present.
 *
 * Nothing here pins a count taken from the shipped pool, for
 * `pool-census.test.ts`'s reason: that test goes red on the next card anybody
 * authors, which makes it a tripwire on authoring rather than a gate on the
 * instrument. `research-figures.test.ts` is where the shipped pool's figures are
 * held against the prose that quotes them.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, STATIC_SCOPES, TRIGGER_CONDITIONS } from '@mtg/dsl';
import type { Card, CardInput, TokenSpecInput } from '@mtg/dsl';
import { interactionCensus, printedTargetSpecs } from '../tools/interaction-census';

function card(overrides: Partial<CardInput> & { id: string }): Card {
  return parseCard({
    kind: 'instant',
    name: 'Interaction Probe',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 1 },
    colors: [],
    effects: [],
    ...overrides,
  } as CardInput);
}

/** The same, with a body on it: the half of the vocabulary a creature can print. */
function body(overrides: Partial<CardInput> & { id: string }): Card {
  const creature = { kind: 'creature', power: 2, toughness: 2, artifact: false, ...overrides };
  return card(creature as Partial<CardInput> & { id: string });
}

/** A token whose own line narrows a target: the descent's subject for this census. */
const NARROWING_TOKEN: TokenSpecInput = {
  name: 'Interaction Token',
  colors: [],
  subtypes: ['Part'],
  keywords: [],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 0 }, tapSelf: false, sacrificeSelf: true },
      effects: [
        {
          kind: 'dealDamage',
          amount: 1,
          target: { kind: 'targetCreature', restriction: { kind: 'tapped' } },
        },
      ],
    },
  ],
};

describe('a printed target spec', () => {
  it('is found under whatever field the effect names it, not under `target`', () => {
    // `fight` prints two slots and only one of them is called `target`; the
    // other is `fighter`. A reader keyed to the field name sees one of the two,
    // and reports a spell that names two creatures as naming one.
    const fight = card({
      id: 'fight',
      effects: [
        {
          kind: 'fight',
          fighter: { kind: 'targetCreatureYouControl' },
          target: { kind: 'targetCreatureYouDontControl' },
        },
      ],
    });
    const specs = printedTargetSpecs(fight);

    expect([...specs.map((spec) => spec.kind)].sort()).toEqual([
      'targetCreatureYouControl',
      'targetCreatureYouDontControl',
    ]);
  });

  it('is found on a mode, where a naive walk over effects and abilities sees nothing', () => {
    const modal = card({
      id: 'modal',
      modes: [
        {
          effects: [
            {
              kind: 'dealDamage',
              amount: 2,
              target: { kind: 'targetCreature', filter: { combat: 'attacking' } },
            },
          ],
        },
        { effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] },
      ],
    });
    expect(modal.effects).toStrictEqual([]);
    expect(modal.abilities).toStrictEqual([]);

    const census = interactionCensus([modal]);
    expect(census.targets.specs).toBe(2);
    expect(census.targets.narrowed).toBe(1);
    expect(census.targets.combat).toBe(1);
  });

  it('is found on the line of a token the card creates', () => {
    const minter = card({
      id: 'minter',
      effects: [{ kind: 'createToken', count: 1, token: NARROWING_TOKEN }],
    });
    const census = interactionCensus([minter]);

    expect(census.targets.narrowed).toBe(1);
    expect(census.targets.narrowedCards).toBe(1);
    expect(census.targets.restrictions).toEqual([{ label: 'tapped', count: 1 }]);
  });

  it('counts a spec once however deep it sits, and counts nothing that is not one', () => {
    // `scopeFilter` is a `TargetFilter` printed beside the target rather than
    // inside it. It narrows a sweep, it is not a chosen target, and a walk that
    // matched on shape rather than on the schema would count it as one.
    const sweeper = card({
      id: 'sweeper',
      effects: [
        {
          kind: 'exileTarget',
          scope: 'permanentsYouControl',
          scopeFilter: { colors: ['B'] },
          target: { kind: 'noTarget' },
        },
      ],
    });
    expect(printedTargetSpecs(sweeper)).toHaveLength(1);
  });

  it('separates the two ways a slot narrows, and counts a slot using both once', () => {
    const both = card({
      id: 'both',
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetCreature',
            restriction: { kind: 'minPower', power: 3 },
            filter: { combat: 'attackingOrBlocking' },
          },
        },
      ],
    });
    const census = interactionCensus([both]);

    expect(census.targets.narrowed).toBe(1);
    expect(census.targets.restrictions).toEqual([{ label: 'minPower', count: 1 }]);
    expect(census.targets.filterFields).toEqual([{ label: 'combat', count: 1 }]);
  });
});

describe('the two activated readings', () => {
  const minter = card({
    id: 'token-minter',
    kind: 'sorcery',
    effects: [{ kind: 'createToken', count: 1, token: NARROWING_TOKEN }],
  });

  it('differ by exactly the tokens, and the census states both', () => {
    const census = interactionCensus([minter]);

    expect(census.activated.abilities).toBe(0);
    expect(census.activated.cards).toBe(0);
    expect(census.activated.boardAbilities).toBe(1);
    expect(census.activated.boardCards).toBe(1);
  });

  it('breaks down by kind and rarity over the printed reading alone', () => {
    // A sorcery does not have an activated ability. A token it makes does, and a
    // breakdown taken over the descended reading would file this card under
    // "sorcery" in a table about what permanents can do at instant speed.
    const census = interactionCensus([minter]);

    expect(census.activated.byCardKind).toEqual([]);
    expect(census.activated.byRarity).toEqual([]);
  });

  it('tells a mana ability from one that touches a board', () => {
    const rock = body({
      id: 'rock',
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 0 }, tapSelf: true, sacrificeSelf: false },
          effects: [{ kind: 'addMana', produces: ['G'], amount: 1 }],
        },
      ],
    });
    const pinger = body({
      id: 'pinger',
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 }, tapSelf: true, sacrificeSelf: false },
          effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
        },
      ],
    });
    const census = interactionCensus([rock, pinger]);

    expect(census.activated.cards).toBe(2);
    expect(census.activated.manaAbilities).toBe(1);
    expect(census.activated.manaOnlyCards).toBe(1);
  });
});

describe('what the pool does not print', () => {
  const trigger = body({
    id: 'enters',
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
    ],
  });

  it('names every trigger condition standing unused, and accounts for all of them', () => {
    const census = interactionCensus([trigger]);

    expect(census.triggers.abilities).toBe(1);
    expect(census.triggers.cards).toBe(1);
    expect(census.triggers.conditions).toEqual([{ label: 'selfEnters', count: 1 }]);
    expect(census.triggers.unprinted).not.toContain('selfEnters');
    // Printed plus unprinted is the whole vocabulary, so a condition added to
    // `TRIGGER_CONDITIONS` cannot go missing from both halves of the report.
    expect(census.triggers.unprinted.length + census.triggers.conditions.length).toBe(
      TRIGGER_CONDITIONS.length,
    );
  });

  it('prints every static scope, including the ones standing at zero', () => {
    const anthem = body({
      id: 'anthem',
      abilities: [
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
        },
      ],
    });
    const census = interactionCensus([anthem]);

    expect(census.statics.abilities).toBe(1);
    expect(census.statics.modifications).toEqual([{ label: 'statBonus', count: 1 }]);
    expect(census.statics.scopes.map((entry) => entry.label)).toEqual([...STATIC_SCOPES]);
    expect(census.statics.scopes.find((entry) => entry.label === 'self')?.count).toBe(0);
  });

  it('reports a pool that prints no cost reduction as printing none', () => {
    expect(interactionCensus([trigger]).costReductionCards).toBe(0);
  });
});
