/** Parameter-sensitive color-pie rulings for reviewed capability bundles. */
import { parseCard, type CardInput, type Keyword } from '@mtg/dsl';
import { classify } from '@mtg/design-data';
import { rulingsFor } from '../src/validate/pie';
import { describe, expect, it } from 'vitest';

function grantCard(color: 'W' | 'U' | 'B' | 'R' | 'G', keyword: Keyword) {
  const input: CardInput = {
    id: `grant-${color.toLowerCase()}-${keyword.toLowerCase()}`,
    name: 'Capability Probe',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: [color],
    kind: 'instant',
    manaCost: { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, [color]: 1 },
    effects: [
      {
        kind: 'grantKeywordUntilEndOfTurn',
        keyword,
        target: { kind: 'targetCreatureYouControl' },
      },
    ],
  };
  return parseCard(input);
}

describe('keyword-grant capability color pie', () => {
  it('inherits primary and secondary keyword placements', () => {
    expect(rulingsFor(grantCard('B', 'deathtouch'))).toContainEqual({
      subject: 'deathtouch',
      verdict: 'pass',
    });
    expect(rulingsFor(grantCard('W', 'flying'))).toContainEqual({ subject: 'flying', verdict: 'pass' });
  });

  it('turns a tertiary grant to another object into off-pie', () => {
    expect(classify('trample', 'W').verdict).toBe('warn');
    expect(rulingsFor(grantCard('W', 'trample'))).toContainEqual({
      subject: 'trample',
      verdict: 'fail',
    });
  });
});

function counterEntryCard(color: 'W' | 'U' | 'B' | 'R' | 'G') {
  const input: CardInput = {
    id: `counter-entry-${color.toLowerCase()}`,
    name: 'Counter Entry Probe',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 2 },
    colors: [color],
    kind: 'creature',
    manaCost: { generic: 2, W: 0, U: 0, B: 0, R: 0, G: 0, [color]: 1 },
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'triggered',
        condition: 'anotherControlledCreatureEnters',
        effects: [
          {
            kind: 'putCounters',
            counter: 'plusOnePlusOne',
            count: 1,
            target: { kind: 'targetCreatureYouControl' },
          },
        ],
      },
    ],
  };
  return parseCard(input);
}

describe('controlled-creature counter-on-entry capability color pie', () => {
  it('uses the reviewed +1/+1-counter row instead of the generic counter inference', () => {
    expect(classify('putCounters', 'R').verdict).toBe('pass');
    expect(classify('putCounters', 'U').verdict).toBe('fail');
    expect(rulingsFor(counterEntryCard('R'))).toContainEqual({ subject: 'putCounters', verdict: 'warn' });
    expect(rulingsFor(counterEntryCard('U'))).toContainEqual({ subject: 'putCounters', verdict: 'warn' });
    expect(rulingsFor(counterEntryCard('B'))).toContainEqual({ subject: 'putCounters', verdict: 'pass' });
  });
});

function fightCard(color: 'W' | 'U' | 'B' | 'R' | 'G') {
  const input: CardInput = {
    id: `fight-${color.toLowerCase()}`,
    name: 'Fight Probe',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 3 },
    colors: [color],
    kind: 'creature',
    manaCost: { generic: 3, W: 0, U: 0, B: 0, R: 0, G: 0, [color]: 1 },
    power: 4,
    toughness: 4,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [{ kind: 'fight', target: { kind: 'targetCreatureYouDontControl' } }],
      },
    ],
  };
  return parseCard(input);
}

describe('fight-opposing-creature capability color pie', () => {
  it('places fight in green primary, red secondary, and nowhere else', () => {
    expect(rulingsFor(fightCard('G'))).toContainEqual({ subject: 'fight', verdict: 'pass' });
    expect(rulingsFor(fightCard('R'))).toContainEqual({ subject: 'fight', verdict: 'pass' });
    for (const color of ['W', 'U', 'B'] as const) {
      expect(rulingsFor(fightCard(color))).toContainEqual({ subject: 'fight', verdict: 'fail' });
    }
  });
});

function untapCard(color: 'W' | 'U' | 'B' | 'R' | 'G') {
  const input: CardInput = {
    id: `untap-${color.toLowerCase()}`,
    name: 'Untap Probe',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 4 },
    colors: [color],
    kind: 'instant',
    manaCost: { generic: 1, W: 0, U: 0, B: 0, R: 0, G: 0, [color]: 1 },
    effects: [{ kind: 'untapPermanent', target: { kind: 'targetCreatureYouControl' } }],
  };
  return parseCard(input);
}

describe('untap-controlled-creature capability color pie', () => {
  it('uses the creature-only untap row', () => {
    for (const color of ['W', 'U', 'G'] as const) {
      expect(rulingsFor(untapCard(color))).toContainEqual({
        subject: 'untapPermanent(targetCreatureYouControl)',
        verdict: 'pass',
      });
    }
    for (const color of ['B', 'R'] as const) {
      expect(rulingsFor(untapCard(color))).toContainEqual({
        subject: 'untapPermanent(targetCreatureYouControl)',
        verdict: 'fail',
      });
    }
  });
});

describe('artifact-or-enchantment routing capability color pie', () => {
  it('inherits the effect ruling and gives the selector no independent ruling', () => {
    const blueReturn = parseCard({
      id: 'artifact-bounce-blue',
      name: 'Artifact Bounce Probe',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 5 },
      colors: ['U'],
      kind: 'instant',
      manaCost: { generic: 1, W: 0, U: 1, B: 0, R: 0, G: 0 },
      effects: [{ kind: 'returnToHand', target: { kind: 'targetArtifactOrEnchantment' } }],
    });
    expect(rulingsFor(blueReturn)).toStrictEqual([{ subject: 'returnToHand', verdict: 'pass' }]);

    const greenExile = parseCard({
      id: 'artifact-exile-green',
      name: 'Artifact Exile Probe',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 6 },
      colors: ['G'],
      kind: 'instant',
      manaCost: { generic: 1, W: 0, U: 0, B: 0, R: 0, G: 1 },
      effects: [{ kind: 'exileTarget', target: { kind: 'targetArtifactOrEnchantment' } }],
    });
    expect(rulingsFor(greenExile)).toContainEqual({ subject: 'exileTarget', verdict: 'fail' });
  });
});

function graveyardToHandCard(
  color: 'W' | 'U' | 'B' | 'R' | 'G',
  cardTypes: ['creature'] | ['instant', 'sorcery'],
) {
  return parseCard({
    id: `graveyard-${color.toLowerCase()}-${cardTypes.join('-')}`,
    name: 'Graveyard Probe',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 7 },
    colors: [color],
    kind: 'sorcery',
    manaCost: { generic: 1, W: 0, U: 0, B: 0, R: 0, G: 0, [color]: 1 },
    effects: [
      {
        kind: 'chooseFromGraveyard',
        whose: 'you',
        filter: { cardTypes },
        destination: 'hand',
      },
    ],
  });
}

describe('own-graveyard-to-hand capability color pie', () => {
  it('classifies creature and instant/sorcery filters independently', () => {
    expect(rulingsFor(graveyardToHandCard('B', ['creature']))).toContainEqual({
      subject: 'chooseFromYourGraveyardToHand(creature)',
      verdict: 'pass',
    });
    expect(rulingsFor(graveyardToHandCard('U', ['creature']))).toContainEqual({
      subject: 'chooseFromYourGraveyardToHand(creature)',
      verdict: 'fail',
    });
    expect(rulingsFor(graveyardToHandCard('U', ['instant', 'sorcery']))).toContainEqual({
      subject: 'chooseFromYourGraveyardToHand(instantOrSorcery)',
      verdict: 'pass',
    });
    expect(rulingsFor(graveyardToHandCard('B', ['instant', 'sorcery']))).toContainEqual({
      subject: 'chooseFromYourGraveyardToHand(instantOrSorcery)',
      verdict: 'fail',
    });
    for (const cardTypes of [['creature'], ['instant', 'sorcery']] as const) {
      expect(rulingsFor(graveyardToHandCard('G', [...cardTypes]))[0]?.verdict).toBe('pass');
    }
  });
});
