import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText, type CardInput } from '@mtg/dsl';

const WORLDSPINE_WURM = {
  kind: 'creature',
  id: 'rtr-140-worldspine-wurm',
  name: 'Worldspine Wurm',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 140 },
  manaCost: { generic: 8, G: 3 },
  colors: ['G'],
  subtypes: ['Wurm'],
  power: 15,
  toughness: 15,
  keywords: ['trample'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'createToken',
          count: 3,
          token: {
            name: 'Wurm',
            power: 5,
            toughness: 5,
            colors: ['G'],
            subtypes: ['Wurm'],
            keywords: ['trample'],
          },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfPutIntoGraveyardFromAnywhere',
      effects: [{ kind: 'shuffleSourceIntoOwnerLibrary' }],
    },
  ],
} as const satisfies CardInput;

describe('RTR #140 Worldspine Wurm', () => {
  it('parses both overlapping graveyard triggers and renders current Oracle exactly', () => {
    const card = parseCard(WORLDSPINE_WURM);

    expect(card.abilities.map((ability) => ability.kind)).toEqual(['triggered', 'triggered']);
    expect(renderOracleText(card)).toBe(
      [
        'Trample',
        'When this creature dies, create three 5/5 green Wurm creature tokens with trample.',
        "When Worldspine Wurm is put into a graveyard from anywhere, shuffle it into its owner's library.",
      ].join('\n'),
    );
  });
});
