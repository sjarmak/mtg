/** Source-attested Forge costs for Bloodthrone Vampire and Viscera Seer. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

function scriptFor(name: string, effect: object): string {
  const card = parseCard({
    kind: 'creature',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'common',
    set: { code: 'M11', collectorNumber: name === 'Bloodthrone Vampire' ? 85 : 120 },
    colors: ['B'],
    manaCost: { B: 1 },
    subtypes: ['Vampire'],
    power: 1,
    toughness: 1,
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {}, sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
        effects: [effect],
      },
    ],
  });
  const result = transpileCard(card);
  if (!result.ok) throw new Error(JSON.stringify(result.rejections));
  return result.script.text;
}

describe('filtered sacrifice costs in Forge', () => {
  it('writes the exact Sac<1/Creature> payment used by both upstream scripts', () => {
    expect(
      scriptFor('Bloodthrone Vampire', {
        kind: 'pumpUntilEndOfTurn',
        power: 2,
        toughness: 2,
        target: { kind: 'selfCreature' },
      }),
    ).toContain('A:AB$ Pump | Cost$ Sac<1/Creature> | Defined$ Self | NumAtt$ +2 | NumDef$ +2');
    expect(scriptFor('Viscera Seer', { kind: 'scry', count: 1 })).toContain(
      'A:AB$ Scry | Cost$ Sac<1/Creature> | ScryNum$ 1',
    );
  });
});
