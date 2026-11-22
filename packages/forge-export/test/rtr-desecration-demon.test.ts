/** Installed-Forge parity for RTR #63. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';
import { readInstalledForgeCardScript } from './installed-card-script';

const card = parseCard({
  kind: 'creature',
  id: 'rtr-063',
  name: 'Desecration Demon',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 63 },
  colors: ['B'],
  manaCost: { generic: 2, B: 2 },
  subtypes: ['Demon'],
  power: 6,
  toughness: 6,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEndStep',
      optional: true,
      printedSourceReference: 'thisCreature',
      opponentMaySacrificeCreatureThenTapAndCounterSelf: true,
      effects: [
        {
          kind: 'sacrificePermanent',
          filter: { cardTypes: ['creature'] },
          target: { kind: 'triggeringPlayer' },
        },
        { kind: 'tapPermanent', target: { kind: 'selfPermanent' } },
        { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'selfCreature' } },
      ],
    },
  ],
});

const installed = readInstalledForgeCardScript('desecration_demon.txt');

describe.skipIf(installed === null)('RTR Desecration Demon Forge parity', () => {
  it('matches the installed script exactly', () => {
    if (installed === null) throw new Error('Required installed Forge is absent');
    const semanticLines = (text: string) =>
      text.split('\n').filter((line) => !line.startsWith('Oracle:') && !line.startsWith('DeckHas:'));
    expect(semanticLines(mustTranspile(card).trim())).toEqual(semanticLines(installed.trim()));
  });
});
