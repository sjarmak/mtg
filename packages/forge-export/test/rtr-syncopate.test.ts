import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const SYNCOPATE = parseCard({
  kind: 'instant',
  id: 'rtr-54-syncopate-forge',
  name: 'Syncopate',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 54 },
  manaCost: { hasX: true, U: 1 },
  colors: ['U'],
  effects: [{ kind: 'counterSpell', unlessCost: { kind: 'chosenX' }, destination: 'exile' }],
});

describe('RTR #54 Syncopate Forge export', () => {
  it('matches the installed Forge script exactly', () => {
    expect(mustTranspile(SYNCOPATE)).toBe(
      [
        'Name:Syncopate',
        'ManaCost:X U',
        'Types:Instant',
        "A:SP$ Counter | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Select target spell | Destination$ Exile | UnlessCost$ X | SpellDescription$ Counter target spell unless its controller pays {X}. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
        'SVar:X:Count$xPaid',
        "Oracle:Counter target spell unless its controller pays {X}. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
        '',
      ].join('\n'),
    );
  });
});
