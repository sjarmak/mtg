/** Forge's own M11/M13 scripts prove the zone and source-return spelling. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

function recursiveCreature(destination: 'hand' | 'battlefieldTapped') {
  const skeleton = destination === 'battlefieldTapped';
  return parseCard({
    kind: 'creature',
    id: skeleton ? 'tst-reassembling-skeleton' : 'tst-firewing-phoenix',
    name: skeleton ? 'Reassembling Skeleton' : 'Firewing Phoenix',
    rarity: skeleton ? 'uncommon' : 'rare',
    set: { code: skeleton ? 'M11' : 'M13', collectorNumber: skeleton ? 112 : 131 },
    colors: skeleton ? ['B'] : ['R'],
    manaCost: skeleton ? { generic: 1, B: 1 } : { generic: 3, R: 1 },
    subtypes: skeleton ? ['Skeleton', 'Warrior'] : ['Phoenix'],
    keywords: skeleton ? [] : ['flying'],
    power: skeleton ? 1 : 4,
    toughness: skeleton ? 1 : 2,
    abilities: [
      {
        kind: 'activated',
        activationZone: 'graveyard',
        cost: { mana: skeleton ? { generic: 1, B: 1 } : { generic: 1, R: 3 } },
        effects: [{ kind: 'returnSourceFromGraveyard', destination }],
      },
    ],
  });
}

describe('graveyard activation scripts', () => {
  it('matches Forge for Reassembling Skeleton', () => {
    const result = transpileCard(recursiveCreature('battlefieldTapped'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain(
      'A:AB$ ChangeZone | Cost$ 1 B | Origin$ Graveyard | Destination$ Battlefield | Tapped$ True | ActivationZone$ Graveyard | SpellDescription$ Return CARDNAME from your graveyard to the battlefield tapped.',
    );
  });

  it('matches Forge for Firewing Phoenix', () => {
    const result = transpileCard(recursiveCreature('hand'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain(
      'A:AB$ ChangeZone | Cost$ 1 R R R | Origin$ Graveyard | Destination$ Hand | ActivationZone$ Graveyard | SpellDescription$ Return CARDNAME from your graveyard to your hand.',
    );
  });
});
