/** Forge parity for Safe Passage's turn-long replacement effect object. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CARD = parseCard({
  kind: 'instant',
  id: 'tst-safe-passage',
  name: 'Safe Passage',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 26 },
  colors: ['W'],
  manaCost: { generic: 2, W: 1 },
  effects: [{ kind: 'preventAllDamageToYouAndCreaturesYouControl' }],
});

describe('Safe Passage Forge parity', () => {
  it('matches Forge master 0c9f64a Effect plus ValidTarget grammar', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = result.script.text.split('\n');
    expect(lines).toContain(
      'A:SP$ Effect | ReplacementEffects$ RPrevent | AILogic$ Fog | SpellDescription$ Prevent all damage that would be dealt to you and creatures you control this turn.',
    );
    expect(lines).toContain(
      'SVar:RPrevent:Event$ DamageDone | Prevent$ True | ActiveZones$ Command | ValidTarget$ You,Creature.YouCtrl | Description$ Prevent all damage that would be dealt to you and creatures you control this turn.',
    );
  });
});
