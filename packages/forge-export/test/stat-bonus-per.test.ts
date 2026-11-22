/**
 * Live layer-7c bonuses use Forge's counted-SVar grammar.
 *
 * These expected lines are pinned to Card-Forge/forge commit
 * 2d5346af81a61efdb0175c6f29f7f35c537a3838: Timberpack Wolf names the
 * controlled matching creatures and subtracts the source, Earth Servant reads
 * controlled Mountains, and Quag Sickness puts the sign on the SVar reference.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

function linesFor(input: Parameters<typeof parseCard>[0]): readonly string[] {
  const result = transpileCardScript(parseCard(input));
  if (!result.ok) throw new Error(JSON.stringify(result.rejections));
  return result.value.lines;
}

describe('a static bonus per matching permanent', () => {
  it('exports Timberpack Wolf through the same live name/count shape Forge ships', () => {
    const lines = linesFor({
      id: 'm13-timberpack-wolf',
      name: 'Timberpack Wolf',
      rarity: 'common',
      set: { code: 'M13', collectorNumber: 194 },
      kind: 'creature',
      manaCost: { generic: 1, G: 1 },
      colors: ['G'],
      subtypes: ['Wolf'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: {
            kind: 'statBonusPer',
            power: 1,
            toughness: 1,
            each: {
              kind: 'countMatching',
              filter: { cardTypes: ['creature'], names: ['Timberpack Wolf'] },
              whose: 'you',
              excludeSource: true,
            },
          },
        },
      ],
    });

    expect(lines).toContain(
      'S:Mode$ Continuous | Affected$ Card.Self | AddPower$ Static1Count | AddToughness$ Static1Count | Description$ CARDNAME gets +1/+1 for each other creature you control named Timberpack Wolf.',
    );
    expect(lines).toContain('SVar:Static1Count:Count$Valid Creature.namedTimberpack Wolf+Other+YouCtrl');
  });

  it('keeps independent rates and signs instead of flattening either half', () => {
    const lines = linesFor({
      id: 'tst-asymmetric-clock',
      name: 'Asymmetric Clock',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      kind: 'creature',
      manaCost: { generic: 3 },
      power: 1,
      toughness: 1,
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: {
            kind: 'statBonusPer',
            power: 2,
            toughness: -1,
            each: { kind: 'landsWithSubtype', subtype: 'Mountain', whose: 'you' },
          },
        },
      ],
    });

    expect(lines).toContain(
      'S:Mode$ Continuous | Affected$ Card.Self | AddPower$ Static1Power | AddToughness$ -Static1Toughness | Description$ CARDNAME gets +2/-1 for each Mountain you control.',
    );
    expect(lines).toContain('SVar:Static1Power:Count$Valid Mountain.YouCtrl/Times.2');
    expect(lines).toContain('SVar:Static1Toughness:Count$Valid Mountain.YouCtrl');
  });

  it('refuses a tally whose part-counter identity Forge cannot preserve', () => {
    const card = parseCard({
      id: 'tst-part-counter-rate',
      name: 'Part Counter Rate',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 3 },
      kind: 'creature',
      manaCost: { generic: 3 },
      power: 1,
      toughness: 1,
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: {
            kind: 'statBonusPer',
            power: 1,
            toughness: 1,
            each: {
              kind: 'countWithCounter',
              filter: { cardTypes: ['creature'] },
              counters: ['horn'],
            },
          },
        },
      ],
    });

    const result = transpileCardScript(card);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toEqual([
      expect.objectContaining({
        code: 'UNMAPPED_EFFECT_KIND',
        path: 'abilities[0].modification.each',
      }),
    ]);
  });
});
