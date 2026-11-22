/** RTR casting-rule parity against installed Forge 0c9f64ae0d46290523d17e6e6b2cc76331743a9e. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const GOBLIN_ELECTROMANCER = parseCard({
  kind: 'creature',
  id: 'rtr-163-goblin-electromancer-forge',
  name: 'Goblin Electromancer',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 163 },
  manaCost: { U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Goblin', 'Wizard'],
  power: 2,
  toughness: 2,
  costReduction: { amount: 1, cardTypes: ['instant', 'sorcery'] },
});

const HYPERSONIC_DRAGON = parseCard({
  kind: 'creature',
  id: 'rtr-170-hypersonic-dragon-forge',
  name: 'Hypersonic Dragon',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 170 },
  manaCost: { generic: 3, U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Dragon'],
  power: 4,
  toughness: 4,
  keywords: ['flying', 'haste'],
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'controller',
      rule: 'castSpellsAsThoughFlash',
      spellFilter: { cardTypes: ['sorcery'] },
      flashTimingReminder: true,
    },
  ],
  oracleText:
    'Flying, haste\nYou may cast sorcery spells as though they had flash. (You may cast them any time you could cast an instant.)',
});

describe('RTR casting-rule Forge export', () => {
  it('matches Goblin Electromancer current card source exactly', () => {
    expect(mustTranspile(GOBLIN_ELECTROMANCER)).toBe(
      [
        'Name:Goblin Electromancer',
        'ManaCost:U R',
        'Types:Creature Goblin Wizard',
        'PT:2/2',
        'S:Mode$ ReduceCost | ValidCard$ Instant,Sorcery | Type$ Spell | Activator$ You | Amount$ 1 | Description$ Instant and sorcery spells you cast cost {1} less to cast.',
        'DeckHints:Type$Instant|Sorcery',
        'Oracle:Instant and sorcery spells you cast cost {1} less to cast.',
        '',
      ].join('\n'),
    );
  });

  it('matches Hypersonic Dragon current card source exactly', () => {
    expect(mustTranspile(HYPERSONIC_DRAGON)).toBe(
      [
        'Name:Hypersonic Dragon',
        'ManaCost:3 U R',
        'Types:Creature Dragon',
        'PT:4/4',
        'K:Flying',
        'K:Haste',
        'S:Mode$ CastWithFlash | ValidCard$ Sorcery | ValidSA$ Spell | Caster$ You | Description$ You may cast sorcery spells as though they had flash.',
        'Oracle:Flying, haste\\nYou may cast sorcery spells as though they had flash. (You may cast them any time you could cast an instant.)',
        '',
      ].join('\n'),
    );
  });
});
