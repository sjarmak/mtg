/** Installed-source Forge parity for RTR Ultimate Price. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Ultimate Price Forge export', () => {
  it('emits the installed Creature.MonoColor selector exactly', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'rtr-82-ultimate-price-forge',
      name: 'Ultimate Price',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 82 },
      manaCost: { generic: 1, B: 1 },
      colors: ['B'],
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetCreature', filter: { monocolored: true } },
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Ultimate Price',
        'ManaCost:1 B',
        'Types:Instant',
        'A:SP$ Destroy | ValidTgts$ Creature.MonoColor | TgtPrompt$ Select target monocolored creature | SpellDescription$ Destroy target monocolored creature.',
        'Oracle:Destroy target monocolored creature.',
        '',
      ].join('\n'),
    );
  });
});
