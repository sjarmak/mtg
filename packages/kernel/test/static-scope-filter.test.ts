/** Static characteristic filters are evaluated inside the CR 613 layer walk. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { powerOf, scenario } from '@mtg/kernel';
import { creature } from './cards';
import { oidOf } from './helpers';
import { onlyObject, recolor, withContinuous } from './continuous-helpers';

const HONOR_OF_THE_PURE = parseCard({
  kind: 'enchantment',
  id: 'm11-honor-of-the-pure',
  name: 'Honor of the Pure',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 17 },
  colors: ['W'],
  manaCost: { generic: 1, W: 1 },
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      filter: { colors: ['W'] },
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
  ],
});

const WHITE_ALLY = creature('Silvercoat Lion', 2, 2, { cost: { generic: 1, W: 1 } });
const BLUE_ALLY = creature('Azure Drake', 2, 4, { cost: { generic: 3, U: 1 } });
const WHITE_ENEMY = creature('Stormfront Pegasus', 2, 1, { cost: { generic: 1, W: 1 } });

describe('a color-filtered static scope', () => {
  const start = scenario({
    seed: 'static-filter/honor-of-the-pure',
    battlefield: [
      { card: HONOR_OF_THE_PURE, controller: 0 },
      { card: WHITE_ALLY, controller: 0 },
      { card: BLUE_ALLY, controller: 0 },
      { card: WHITE_ENEMY, controller: 1 },
    ],
  });

  it('buffs only allied permanents whose current color matches', () => {
    expect(powerOf(start.state, oidOf(start.state, 'Silvercoat Lion'))).toBe(3);
    expect(powerOf(start.state, oidOf(start.state, 'Azure Drake'))).toBe(2);
    expect(powerOf(start.state, oidOf(start.state, 'Stormfront Pegasus'))).toBe(2);
  });

  it('reads color after layer 5 rather than from the printed card', () => {
    const white = oidOf(start.state, 'Silvercoat Lion');
    const blue = oidOf(start.state, 'Azure Drake');
    const recolored = withContinuous(start.state, [
      recolor(onlyObject(white), ['U']),
      recolor(onlyObject(blue), ['W']),
    ]);

    expect(powerOf(recolored, white)).toBe(2);
    expect(powerOf(recolored, blue)).toBe(3);
  });
});
