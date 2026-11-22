/** Forge and Oracle presentation retain a hand-authored activation's exact pip order. */
import { ActivationCostSchema, parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { forgeActivationManaCost } from '../src/ability-script';
import { mustTranspile } from './helpers';

describe('activation mana pip presentation order', () => {
  it('prints the override while leaving the structured payment unchanged', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'tst-ordered-activation',
      name: 'Ordered Activation',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 1 },
      colors: ['G', 'W'],
      manaCost: { G: 1, W: 1 },
      subtypes: ['Dryad'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'activated',
          cost: {
            mana: { generic: 4, G: 1, W: 1 },
            printedManaPips: ['G', 'W'],
          },
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });

    const script = mustTranspile(card);
    expect(script).toContain('Cost$ 4 G W');
    expect(script).toContain('Oracle:{4}{G}{W}: You gain 1 life.');
  });

  it('keeps X and generic first while ordering fixed colored and hybrid pips', () => {
    const cost = ActivationCostSchema.parse({
      mana: { generic: 1, hasX: true, G: 1, hybrid: { 'W/U': 1 } },
      printedManaPips: ['W/U', 'G'],
    });
    expect(forgeActivationManaCost(cost)).toBe('X 1 WU G');
  });
});
