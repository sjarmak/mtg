/** Forge must refuse engine semantics it cannot yet spell, never approximate them. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

function result(input: CardInput) {
  return transpileCardScript(parseCard(input));
}

describe('variable values at the Forge boundary', () => {
  it('refuses an X cost rather than dropping the unpaid symbol', () => {
    const found = result({
      kind: 'instant',
      id: 'tst-forge-x',
      name: 'Forge X',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { R: 1, hasX: true },
      colors: ['R'],
      effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
    });
    expect(found.ok).toBe(false);
    expect(found.ok ? [] : found.rejections.map((entry) => entry.code)).toContain('UNMAPPED_VARIABLE_MANA');
  });

  it('refuses an X in an activation cost rather than shipping a cheaper ability', () => {
    // `forgeActivationCost` builds its cost string out of `manaValue`, which
    // counts X as nothing, so before `mtg-nhyv.17` this card exported as a
    // plain `{G}{G}` activation: cheaper in Forge than the kernel charges, and
    // wrong in the direction that makes a parity run agree with itself while
    // both halves play a different card.
    const found = result({
      kind: 'creature',
      id: 'tst-forge-x-activation',
      name: 'Forge X Activation',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: { generic: 4, G: 2 },
      colors: ['G'],
      power: 2,
      toughness: 5,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { G: 2, hasX: true } },
          effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
        },
      ],
    });
    expect(found.ok).toBe(false);
    const rejections = found.ok ? [] : found.rejections;
    expect(rejections.map((entry) => entry.code)).toContain('UNMAPPED_VARIABLE_MANA');
    expect(
      rejections.filter((entry) => entry.code === 'UNMAPPED_VARIABLE_MANA').map((entry) => entry.path),
    ).toEqual(['abilities[0].cost.mana.hasX']);
  });

  it('refuses a CDA rather than emitting its canonical storage sentinel as printed P/T', () => {
    const found = result({
      kind: 'creature',
      id: 'tst-forge-cda',
      name: 'Forge CDA',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 3 },
      power: 0,
      toughness: 0,
      characteristicPowerToughness: { kind: 'creaturesYouControl' },
    });
    expect(found.ok).toBe(false);
    expect(found.ok ? [] : found.rejections.map((entry) => entry.code)).toContain(
      'UNMAPPED_CHARACTERISTIC_VALUE',
    );
  });
});
