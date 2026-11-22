/** M13's five Rings against Card-Forge d6465382e4455ebfb3d77c297a56f30b929cb520. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type Color, type Keyword } from '@mtg/dsl';
import { transpileSet } from '@mtg/forge-export';
import { mustTranspile } from './helpers';

function ring(
  name: string,
  collectorNumber: number,
  color: Color,
  grant: Keyword | null,
  distinct: 'hexproof' | 'regenerate' | null,
): Card {
  const equip = {
    kind: 'activated' as const,
    cost: { mana: { generic: 1 } },
    attach: {
      modifications: grant === null ? [] : [{ kind: 'grantKeyword' as const, keyword: grant }],
    },
    effects: [],
  };
  const upkeep = {
    kind: 'triggered' as const,
    condition: 'beginningOfYourUpkeep' as const,
    effects: [
      {
        kind: 'putCounters' as const,
        counter: 'plusOnePlusOne' as const,
        count: 1,
        target: { kind: 'equippedCreature' as const },
        recipientCondition: { kind: 'hasColor' as const, color },
      },
    ],
  };
  const distinctAbility =
    distinct === 'hexproof'
      ? {
          kind: 'activated' as const,
          cost: { mana: { generic: 2 } },
          effects: [
            {
              kind: 'grantKeywordUntilEndOfTurn' as const,
              keyword: 'hexproof' as const,
              target: { kind: 'equippedCreature' as const },
            },
          ],
        }
      : distinct === 'regenerate'
        ? {
            kind: 'activated' as const,
            cost: { mana: { generic: 2 } },
            effects: [
              { kind: 'regeneratePermanent' as const, target: { kind: 'equippedCreature' as const } },
            ],
          }
        : null;
  return parseCard({
    kind: 'artifact',
    id: `m13-${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber },
    manaCost: { generic: 2 },
    subtypes: ['Equipment'],
    abilities: distinctAbility === null ? [equip, upkeep] : [distinctAbility, upkeep, equip],
  });
}

const RINGS = [
  ring('Ring of Evos Isle', 211, 'U', null, 'hexproof'),
  ring('Ring of Kalonia', 212, 'G', 'trample', null),
  ring('Ring of Thune', 213, 'W', 'vigilance', null),
  ring('Ring of Valkas', 214, 'R', 'haste', null),
  ring('Ring of Xathrid', 215, 'B', null, 'regenerate'),
] as const;

const FORGE_COLORS = { U: 'Blue', G: 'Green', W: 'White', R: 'Red', B: 'Black' } as const;

describe('M13 Ring cycle in Forge', () => {
  it('writes the exact unconditional phase trigger and conditional Equipped counter body for each color', () => {
    for (const [index, card] of RINGS.entries()) {
      const color = ['U', 'G', 'W', 'R', 'B'][index] as keyof typeof FORGE_COLORS;
      const script = mustTranspile(card);
      expect(script, card.name).toContain('K:Equip:1');
      expect(script, card.name).toContain(
        'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ Trig2Effect1',
      );
      expect(script, card.name).toContain(
        `SVar:Trig2Effect1:DB$ PutCounter | Defined$ Equipped | ConditionDefined$ Equipped | ConditionPresent$ Creature.${FORGE_COLORS[color]} | ConditionCompare$ EQ1 | CounterType$ P1P1 | CounterNum$ 1`,
      );
    }
  });

  it("matches Forge's two activated Equipped referents without choosing a target", () => {
    expect(mustTranspile(RINGS[0])).toContain('A:AB$ Pump | Cost$ 2 | Defined$ Equipped | KW$ Hexproof');
    expect(mustTranspile(RINGS[4])).toContain('A:AB$ Regenerate | Cost$ 2 | Defined$ Equipped');
  });

  it('keeps the three continuous grants on Creature.EquippedBy', () => {
    expect(mustTranspile(RINGS[1])).toContain(
      'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddKeyword$ Trample',
    );
    expect(mustTranspile(RINGS[2])).toContain(
      'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddKeyword$ Vigilance',
    );
    expect(mustTranspile(RINGS[3])).toContain(
      'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddKeyword$ Haste',
    );
  });

  it('exports bare Equip but still refuses its attachment referent on a non-Equipment source', () => {
    expect(mustTranspile(RINGS[0])).toContain('K:Equip:1');

    const malformed = { ...RINGS[0], subtypes: [] } as Card;
    const result = transpileSet([malformed], { name: 'Magic 2013', date: '2012-07-13' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections.map(({ code }) => code)).toContain('DSL_VIOLATION');
      expect(result.rejections.map(({ message }) => message).join('\n')).toContain(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
      );
    }
  });
});
