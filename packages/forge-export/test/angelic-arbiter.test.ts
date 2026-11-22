/** Forge parity for Angelic Arbiter's live player restrictions. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const ANGELIC_ARBITER = parseCard({
  kind: 'creature',
  id: 'tst-angelic-arbiter',
  name: 'Angelic Arbiter',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 4 },
  colors: ['W'],
  manaCost: { generic: 5, W: 2 },
  power: 5,
  toughness: 6,
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'eachOpponent',
      rule: 'cantAttackWithCreaturesIfCastSpellThisTurn',
    },
    {
      kind: 'staticPlayerRule',
      players: 'eachOpponent',
      rule: 'cantCastSpellsIfAttackedWithCreatureThisTurn',
    },
  ],
});

describe('Angelic Arbiter Forge parity', () => {
  it('emits the two exact restriction lines from Forge master', () => {
    const result = transpileCard(ANGELIC_ARBITER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = result.script.text.split('\n');
    expect(lines).toContain(
      "S:Mode$ CantAttack | ValidCard$ Creature.ControlledBy Opponent.castSpellThisTurn | Description$ Each opponent who cast a spell this turn can't attack with creatures.",
    );
    expect(lines).toContain(
      "S:Mode$ CantBeCast | ValidCard$ Card | Caster$ Opponent.attackedWithCreaturesThisTurn | Description$ Each opponent who attacked with a creature this turn can't cast spells.",
    );
  });
});
