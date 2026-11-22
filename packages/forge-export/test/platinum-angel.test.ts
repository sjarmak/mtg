/** Forge parity for Platinum Angel's paired game-result replacement rules. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const PLATINUM_ANGEL = parseCard({
  kind: 'creature',
  id: 'm11-212-platinum-angel-forge',
  name: 'Platinum Angel',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 212 },
  colors: [],
  manaCost: { generic: 7 },
  artifact: true,
  power: 4,
  toughness: 4,
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [{ kind: 'staticGameRule', rule: 'controllerCantLoseAndOpponentsCantWin' }],
});

describe('Platinum Angel Forge parity', () => {
  it('emits the two exact event replacements from Forge master', () => {
    const result = transpileCard(PLATINUM_ANGEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const description = "You can't lose the game and your opponents can't win the game.";
    expect(result.script.text).toContain(
      `R:Event$ GameLoss | ActiveZones$ Battlefield | ValidPlayer$ You | Layer$ CantHappen | Description$ ${description}`,
    );
    expect(result.script.text).toContain(
      `R:Event$ GameWin | ActiveZones$ Battlefield | ValidPlayer$ Opponent | Layer$ CantHappen | Secondary$ True | Description$ ${description}`,
    );
  });
});
