/** Forge descriptions and Oracle retain a hand-authored trigger source reference. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

function card(printedSourceReference?: 'thisCreature') {
  return parseCard({
    kind: 'creature',
    id: 'tst-trigger-source-reference',
    name: 'Wayfaring Temple',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 1, G: 1, W: 1 },
    colors: ['G', 'W'],
    subtypes: ['Elemental'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDealsCombatDamageToPlayer',
        effects: [{ kind: 'populate' }],
        ...(printedSourceReference === undefined ? {} : { printedSourceReference }),
      },
    ],
  });
}

describe('trigger source presentation reference', () => {
  it('preserves the override in both Forge trigger description and Oracle text', () => {
    const script = mustTranspile(card('thisCreature'));
    expect(script).toContain(
      'TriggerDescription$ Whenever this creature deals combat damage to a player, populate.',
    );
    expect(script).toContain('Oracle:Whenever this creature deals combat damage to a player, populate.');
  });

  it('keeps the card-name default unchanged', () => {
    const script = mustTranspile(card());
    expect(script).toContain(
      'TriggerDescription$ Whenever CARDNAME deals combat damage to a player, populate.',
    );
    expect(script).toContain('Oracle:Whenever Wayfaring Temple deals combat damage to a player, populate.');
  });
});
