/**
 * Forge must refuse a modal spell rather than transpile it as a blank card.
 *
 * `checkEffects` permits (and requires, for a modal spell) `effects: []`
 * beside a populated `modes` list. `abilityBlock` builds the `A:`/`SVar:`
 * chain from `card.effects` alone, which is empty by construction on a modal
 * card, so a script built from it would silently print a card with no
 * ability lines at all — the same failure `enchantment-aura.test.ts` guards
 * against for a different unmapped shape.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

describe('modal spell Forge boundary', () => {
  it('refuses a modal spell rather than exporting it with no ability lines', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'tst-fork-in-the-road',
      name: 'Fork in the Road',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      modes: [
        { effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }] },
        { effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }] },
      ],
    });
    const result = transpileCardScript(card);
    expect(result).toEqual({
      ok: false,
      rejections: [
        expect.objectContaining({
          code: 'UNMAPPED_MODAL_SPELL',
          cardId: 'tst-fork-in-the-road',
          path: 'modes',
        }),
      ],
    });
  });
});
