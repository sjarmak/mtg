/** Installed-Forge parity for RTR #24. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';
import { readInstalledForgeCardScript } from './installed-card-script';

const card = parseCard({
  kind: 'enchantment',
  id: 'rtr-024',
  name: 'Sphere of Safety',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 24 },
  colors: ['W'],
  manaCost: { generic: 4, W: 1 },
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'eachOpponent',
      rule: 'attackControllerOrPlaneswalkersTaxedByControlledEnchantments',
    },
  ],
});

const installed = readInstalledForgeCardScript('sphere_of_safety.txt');

describe.skipIf(installed === null)('RTR Sphere of Safety Forge parity', () => {
  it('matches the installed script exactly', () => {
    if (installed === null) throw new Error('Required installed Forge is absent');
    const semanticLines = (text: string) => text.split('\n').filter((line) => !line.startsWith('Oracle:'));
    expect(semanticLines(mustTranspile(card).trim())).toEqual(semanticLines(installed.trim()));
  });
});
