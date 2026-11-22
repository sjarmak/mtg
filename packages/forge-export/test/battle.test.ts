import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

describe('Battle card scripts', () => {
  it('writes the Battle type and starting defense without inventing P/T', () => {
    const card = parseCard({
      kind: 'battle',
      id: 'tst-open-front',
      name: 'Open Front',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      defense: 4,
    });
    const result = transpileCardScript(card);
    if (!result.ok) throw new Error(JSON.stringify(result.rejections));
    expect(result.value.lines).toContain('Types:Battle');
    expect(result.value.lines).toContain('Defense:4');
    expect(result.value.lines.some((line) => line.startsWith('PT:'))).toBe(false);
  });

  it('writes Forge source-compatible Siege DFC sections and the back-face color indicator', () => {
    const card = parseCard({
      kind: 'battle',
      id: 'tst-invasion-of-forge',
      name: 'Invasion of Forge',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 3, G: 1 },
      colors: ['G'],
      subtypes: ['Siege'],
      defense: 3,
      backFace: {
        kind: 'creature',
        name: 'Awakened Testscape',
        colors: ['G'],
        subtypes: ['Elemental'],
        power: 4,
        toughness: 4,
      },
    });
    const result = transpileCardScript(card);
    if (!result.ok) throw new Error(JSON.stringify(result.rejections));
    expect(result.value.lines).toEqual(
      expect.arrayContaining([
        'Types:Battle Siege',
        'Defense:3',
        'AlternateMode:DoubleFaced',
        'ALTERNATE',
        'Name:Awakened Testscape',
        'ManaCost:no cost',
        'Colors:green',
        'Types:Creature Elemental',
        'PT:4/4',
      ]),
    );
    expect(result.value.lines.find((line) => line.startsWith('Oracle:'))).toContain(
      'choose an opponent to protect it',
    );
    expect(result.value.lines.indexOf('ALTERNATE')).toBeGreaterThan(
      result.value.lines.indexOf('AlternateMode:DoubleFaced'),
    );
  });
});
