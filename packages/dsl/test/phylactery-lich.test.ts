import { describe, expect, it } from 'vitest';
import {
  COUNTER_DECLARATIONS,
  ModelAbilitySchema,
  parseCard,
  printedEntryReplacement,
  renderOracleText,
} from '@mtg/dsl';

const PHYLACTERY_LICH = {
  kind: 'creature',
  id: 'm11-phylactery-lich',
  name: 'Phylactery Lich',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 110 },
  manaCost: { B: 3 },
  colors: ['B'],
  subtypes: ['Zombie'],
  power: 5,
  toughness: 5,
  keywordAbilities: [{ kind: 'indestructible' }],
  entryReplacement: {
    kind: 'putCounterOnControlledPermanent',
    permanentType: 'artifact',
    counter: 'phylactery',
    count: 1,
  },
  abilities: [
    {
      kind: 'stateTriggered',
      condition: { kind: 'controllerControlsNoPermanentWithCounter', counter: 'phylactery' },
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
    },
  ],
} as const;

describe('Phylactery Lich typed semantics (mtg-nhyv.130)', () => {
  it('parses and prints both exact non-keyword clauses', () => {
    const card = parseCard(PHYLACTERY_LICH);

    expect(printedEntryReplacement(card)).toEqual(PHYLACTERY_LICH.entryReplacement);
    expect(renderOracleText(card)).toBe(
      'Indestructible\n' +
        'As Phylactery Lich enters, put a phylactery counter on an artifact you control.\n' +
        'When you control no permanents with phylactery counters on them, sacrifice this creature.',
    );
  });

  it('declares phylactery as a marker counter with no layer effect', () => {
    expect(COUNTER_DECLARATIONS.phylactery).toEqual({ printName: 'phylactery', modifications: [] });
  });

  it('keeps the state-trigger machinery outside the generator output space', () => {
    expect(ModelAbilitySchema.safeParse(PHYLACTERY_LICH.abilities[0]).success).toBe(false);
  });
});
