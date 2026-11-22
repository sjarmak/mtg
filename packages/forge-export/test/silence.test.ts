/** Forge parity for Silence's turn-scoped casting prohibition. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const SILENCE = parseCard({
  kind: 'instant',
  id: 'tst-silence',
  name: 'Silence',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 30 },
  colors: ['W'],
  manaCost: { W: 1 },
  effects: [{ kind: 'cantCastSpellsThisTurn', players: 'eachOpponent' }],
});

describe('Silence Forge parity', () => {
  it('emits Forge master 0c9f64a rule-modifier grammar', () => {
    const result = transpileCard(SILENCE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = result.script.text.split('\n');
    expect(lines).toContain(
      "A:SP$ Effect | StaticAbilities$ STCantBeCast | AILogic$ BeginningOfOppTurn | SpellDescription$ Your opponents can't cast spells this turn.",
    );
    expect(lines).toContain(
      "SVar:STCantBeCast:Mode$ CantBeCast | ValidCard$ Card | Caster$ Opponent | Description$ Your opponents can't cast spells.",
    );
  });
});
