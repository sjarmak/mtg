/** M13 Flash cards against Card-Forge d6465382e4455ebfb3d77c297a56f30b929cb520. */
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const FAERIE_INVADERS = parseCard({
  kind: 'creature',
  id: 'm13-faerie-invaders-forge',
  name: 'Faerie Invaders',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 51 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  subtypes: ['Faerie', 'Rogue'],
  power: 3,
  toughness: 3,
  keywords: ['flying'],
  keywordAbilities: [{ kind: 'flash' }],
});

const YEVA = parseCard({
  kind: 'creature',
  id: 'm13-yeva-natures-herald-forge',
  name: "Yeva, Nature's Herald",
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 197 },
  manaCost: { generic: 2, G: 2 },
  colors: ['G'],
  supertypes: ['legendary'],
  subtypes: ['Elf', 'Shaman'],
  power: 4,
  toughness: 4,
  keywordAbilities: [{ kind: 'flash' }],
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'controller',
      rule: 'castSpellsAsThoughFlash',
      spellFilter: { cardTypes: ['creature'], colors: ['G'] },
    },
  ],
});

describe('M13 Flash Forge export', () => {
  it('matches the pinned intrinsic keyword rows', () => {
    const faerie = mustTranspile(FAERIE_INVADERS);
    expect(faerie).toContain('K:Flash');
    expect(faerie.indexOf('K:Flash')).toBeLessThan(faerie.indexOf('K:Flying'));
    expect(faerie).toContain(
      'Oracle:Flash (You may cast this spell any time you could cast an instant.)\\nFlying',
    );
    expect(mustTranspile(YEVA)).toContain('K:Flash');
  });

  it('matches Yeva current card source exactly', () => {
    expect(mustTranspile(YEVA)).toBe(
      [
        "Name:Yeva, Nature's Herald",
        'ManaCost:2 G G',
        'Types:Legendary Creature Elf Shaman',
        'PT:4/4',
        'K:Flash',
        'S:Mode$ CastWithFlash | ValidCard$ Creature.Green | ValidSA$ Spell | Caster$ You | Description$ You may cast green creature spells as though they had flash.',
        'Oracle:Flash (You may cast this spell any time you could cast an instant.)\\nYou may cast green creature spells as though they had flash.',
        '',
      ].join('\n'),
    );
  });

  it('rejects an unsupported Forge filter rather than widening its permission', () => {
    const named = parseCard({
      ...YEVA,
      id: 'm13-yeva-named-filter-forge',
      abilities: [
        {
          kind: 'staticPlayerRule',
          players: 'controller',
          rule: 'castSpellsAsThoughFlash',
          spellFilter: { names: ['Faerie Invaders'] },
        },
      ],
    });
    const result = transpileCard(named);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toContainEqual(
      expect.objectContaining({
        code: 'UNMAPPED_CAST_PERMISSION_FILTER',
        path: 'abilities[0].spellFilter',
      }),
    );
  });
});
