/** Exact script spellings supported by the human permanent-cost visitor. */
import { describe, expect, it } from 'vitest';
import { legacyCubeChosenCostPaymentRefusals } from '../src/legacy-cube/decision-ledger.js';

const script = (cost: string): Uint8Array =>
  new TextEncoder().encode(`A:AB$ Draw | Cost$ ${cost} | NumCards$ 1`);

describe('bounded permanent cost payments', () => {
  it.each(['tapXType<1/Creature>', 'tapXType<2/Creature>', '1 Exile<1/CARDNAME>'])(
    'requires an explicit reviewed permission for %s',
    (cost) => {
      expect(legacyCubeChosenCostPaymentRefusals(script(cost))).not.toEqual([]);
      expect(
        legacyCubeChosenCostPaymentRefusals(script(cost), { allowBoundedPermanentCostParts: true }),
      ).toEqual([]);
    },
  );

  it.each([
    'tapXType<3/Kithkin>',
    'tapXType<1/Artifact>',
    'tapXType<3/Creature>',
    'tapXType<X/Creature>',
    'tapXType<2/Creature.YouCtrl>',
    'T tapXType<1/Creature>',
    'tapXType<2/Creature> T',
    'Exile<2/CARDNAME>',
    'Exile<X/CARDNAME>',
    'Exile<1/Creature>',
    'ExileFromGrave<1/CARDNAME>',
    'Exile<1/CARDNAME> Sac<1/Creature>',
  ])('refuses a neighboring unsupported payment: %s', (cost) => {
    expect(
      legacyCubeChosenCostPaymentRefusals(script(cost), { allowBoundedPermanentCostParts: true }),
    ).not.toEqual([]);
  });

  it('keeps the source-tap restriction local to each cost', () => {
    const bytes = new TextEncoder().encode(
      'A:AB$ Draw | Cost$ T | NumCards$ 1\nA:AB$ Draw | Cost$ tapXType<1/Creature> | NumCards$ 1',
    );
    expect(legacyCubeChosenCostPaymentRefusals(bytes, { allowBoundedPermanentCostParts: true })).toEqual([]);
  });
});
