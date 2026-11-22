/** Faerie Impostor against Forge's installed card script. */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const IMPOSTOR = parseCard({
  kind: 'creature',
  id: 'rtr-39-faerie-impostor',
  name: 'Faerie Impostor',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 39 },
  manaCost: { U: 1 },
  colors: ['U'],
  subtypes: ['Faerie', 'Rogue'],
  power: 2,
  toughness: 1,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
      returnAnotherCreatureOrSacrificeSelf: true,
    },
  ],
});

describe('Faerie Impostor in Forge', () => {
  const script = mustTranspile(IMPOSTOR);

  it('exports the installed entry trigger and return cost exactly', () => {
    expect(script).toContain('K:Flying');
    expect(script).toContain(
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSacUnless',
    );
    expect(script).toContain(
      'SVar:TrigSacUnless:DB$ Sacrifice | UnlessCost$ Return<1/Creature.Other/other creature> | UnlessPayer$ You',
    );
  });

  it('keeps the exact Oracle text in the exported card', () => {
    expect(script).toContain(`Oracle:${renderOracleText(IMPOSTOR).replaceAll('\n', '\\n')}`);
  });
});
