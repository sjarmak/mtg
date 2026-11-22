/** Source-attested Forge parity for M13 Battle of Wits. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const BATTLE_OF_WITS = parseCard({
  kind: 'enchantment',
  id: 'm13-44-battle-of-wits-forge',
  name: 'Battle of Wits',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 44 },
  manaCost: { generic: 3, U: 2 },
  colors: ['U'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      interveningIf: { kind: 'controllerLibraryAtLeast', atLeast: 200 },
      effects: [{ kind: 'winGame' }],
    },
  ],
});

describe('Battle of Wits Forge export', () => {
  it('emits the upstream library gate and controller win instruction', () => {
    const script = mustTranspile(BATTLE_OF_WITS);
    expect(script).toContain(
      'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | IsPresent$ Card.YouCtrl | PresentZone$ Library | PresentCompare$ GE200 | Execute$ Trig1Effect1 | TriggerZones$ Battlefield | TriggerDescription$ At the beginning of your upkeep, if you have 200 or more cards in your library, you win the game.',
    );
    expect(script).toContain('SVar:Trig1Effect1:DB$ WinsGame | Defined$ You');
    expect(script).toContain(
      'Oracle:At the beginning of your upkeep, if you have 200 or more cards in your library, you win the game.',
    );
  });
});
