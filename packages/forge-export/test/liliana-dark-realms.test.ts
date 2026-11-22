/** Forge parity for Liliana of the Dark Realms' three exact loyalty abilities. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

const SWAMPS = { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' } as const;

const LILIANA = parseCard({
  kind: 'planeswalker',
  id: 'm13-liliana-of-the-dark-realms',
  name: 'Liliana of the Dark Realms',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 97 },
  colors: ['B'],
  manaCost: { generic: 2, B: 2 },
  supertypes: ['legendary'],
  subtypes: ['Liliana'],
  startingLoyalty: 3,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [
        {
          kind: 'searchLibrary',
          filter: { subtypes: ['Swamp'] },
          reveal: true,
          destination: 'hand',
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -3,
      effects: [],
      modes: [
        {
          effects: [
            {
              kind: 'pumpUntilEndOfTurn',
              power: { kind: 'ratePer', rate: 1, each: SWAMPS },
              toughness: { kind: 'ratePer', rate: 1, each: SWAMPS },
              target: { kind: 'targetCreature' },
            },
          ],
        },
        {
          effects: [
            {
              kind: 'pumpUntilEndOfTurn',
              power: { kind: 'ratePer', rate: -1, each: SWAMPS },
              toughness: { kind: 'ratePer', rate: -1, each: SWAMPS },
              target: { kind: 'targetCreature' },
            },
          ],
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -6,
      effects: [
        {
          kind: 'createEmblem',
          emblem: {
            name: 'Liliana of the Dark Realms Emblem',
            grantsManaAbility: {
              filter: { cardTypes: ['land'], subtypes: ['Swamp'] },
              produces: ['B'],
              amount: 4,
            },
          },
        },
      ],
    },
  ],
} satisfies CardInput);

describe('Liliana of the Dark Realms Forge export', () => {
  it('exports the tutor, signed choice, live count, and persistent emblem without approximation', () => {
    const result = transpileCardScript(LILIANA);
    if (!result.ok) throw new Error(`expected Forge script, got ${JSON.stringify(result.rejections)}`);

    expect(result.value.lines).toContainEqual(
      expect.stringContaining(
        'A:AB$ ChangeZone | Cost$ AddCounter<1/LOYALTY> | Origin$ Library | Destination$ Hand',
      ),
    );
    const search = result.value.lines.find((line) => line.startsWith('A:AB$ ChangeZone'));
    expect(search).toContain('ChangeType$ Swamp');
    expect(search).toContain('Planeswalker$ True');
    expect(result.value.lines).toContainEqual(
      expect.stringContaining(
        'A:AB$ Pump | Cost$ SubCounter<3/LOYALTY> | ValidTgts$ Creature | Planeswalker$ True | SubAbility$',
      ),
    );
    expect(result.value.lines).toContainEqual(
      expect.stringContaining('DB$ GenericChoice | Defined$ You | Choices$'),
    );
    expect(result.value.lines).toContainEqual(
      expect.stringContaining('DB$ Pump | Defined$ Targeted | NumAtt$ +Y | NumDef$ +Y'),
    );
    expect(result.value.lines).toContainEqual(
      expect.stringContaining('DB$ Pump | Defined$ Targeted | NumAtt$ -Y | NumDef$ -Y'),
    );
    expect(result.value.lines).toContain('SVar:Y:Count$Valid Swamp.YouCtrl');
    expect(result.value.lines).toContainEqual(
      expect.stringContaining('AB$ Effect | Cost$ SubCounter<6/LOYALTY>'),
    );
    expect(result.value.lines).toContainEqual(
      expect.stringContaining(
        'Mode$ Continuous | Affected$ Swamp.YouCtrl | AffectedZone$ Battlefield | AddAbility$',
      ),
    );
    expect(result.value.lines).toContainEqual(
      expect.stringContaining('AB$ Mana | Cost$ T | Produced$ B | Amount$ 4'),
    );
  });
});
