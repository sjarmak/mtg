import { describe, expect, it } from 'vitest';
import { planForgeManaPayment } from '../src/observed/mana-payment';

type PaymentOption = Parameters<typeof planForgeManaPayment>[0]['options'][number];

function mana(id: string, resource: string, color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'): PaymentOption {
  return { id, payment: { kind: 'mana', resource, color } };
}

const cancel: PaymentOption = {
  id: 'mana-payment-cancel',
  payment: { kind: 'cancel' },
};

describe('Forge mana payment planning', () => {
  it('pays generic mana with another permanent before consuming the only green-capable source', () => {
    expect(
      planForgeManaPayment({
        unpaid: ['{1}', '{G}'],
        options: [
          mana('mana-source-43-0-U', 'forge-card-43', 'U'),
          mana('mana-source-43-1-G', 'forge-card-43', 'G'),
          mana('mana-source-46-0-B', 'forge-card-46', 'B'),
          mana('mana-source-46-0-R', 'forge-card-46', 'R'),
          cancel,
        ],
      }),
    ).toEqual({ move: 'mana-source-46-0-B', kind: 'payment' });
  });

  it('spends floating mana on a generic shard before a required colored source', () => {
    expect(
      planForgeManaPayment({
        unpaid: ['1', 'G'],
        options: [
          mana('mana-pool-0', 'mana-pool-0', 'U'),
          mana('mana-source-75-0-G', 'forge-card-75', 'G'),
          cancel,
        ],
      }),
    ).toEqual({ move: 'mana-pool-0', kind: 'payment' });
  });

  it('decrements a multi-mana generic shard while preserving the required colored source', () => {
    expect(
      planForgeManaPayment({
        unpaid: ['{2}', '{G}'],
        options: [
          mana('mana-source-1-0-G', 'forge-card-1', 'G'),
          mana('mana-source-2-0-U', 'forge-card-2', 'U'),
          mana('mana-source-3-0-R', 'forge-card-3', 'R'),
          cancel,
        ],
      }),
    ).toEqual({ move: 'mana-source-2-0-U', kind: 'payment' });
  });

  it('preserves a hybrid-capable source while another source pays generic mana', () => {
    expect(
      planForgeManaPayment({
        unpaid: ['1', 'G/U'],
        options: [
          mana('mana-source-10-0-G', 'forge-card-10', 'G'),
          mana('mana-source-10-0-U', 'forge-card-10', 'U'),
          mana('mana-source-11-0-R', 'forge-card-11', 'R'),
          cancel,
        ],
      }),
    ).toEqual({ move: 'mana-source-11-0-R', kind: 'payment' });
  });

  it('uses colored mana for an admitted Phyrexian shard and life when it is the only payment', () => {
    const life: PaymentOption = {
      id: 'mana-payment-phyrexian-life',
      payment: { kind: 'phyrexian-life' },
    };
    expect(
      planForgeManaPayment({
        unpaid: ['W/P'],
        options: [mana('mana-source-12-0-W', 'forge-card-12', 'W'), life, cancel],
      }),
    ).toEqual({ move: 'mana-source-12-0-W', kind: 'payment' });
    expect(planForgeManaPayment({ unpaid: ['W/P'], options: [life, cancel] })).toEqual({
      move: 'mana-payment-phyrexian-life',
      kind: 'payment',
    });
  });

  it('returns the explicit cancellation when no offered payment can finish the cost', () => {
    expect(planForgeManaPayment({ unpaid: ['G'], options: [cancel] })).toEqual({
      move: 'mana-payment-cancel',
      kind: 'cancel',
    });
  });

  it('does not cancel while an unmodeled mana ability can still make the cost payable', () => {
    const activation: PaymentOption = {
      id: 'mana-activate-12-0',
      payment: { kind: 'activation' },
    };
    expect(planForgeManaPayment({ unpaid: ['G'], options: [activation, cancel] })).toBeNull();
  });

  it('does not cancel when Forge may offer another Phyrexian life payment next', () => {
    const life: PaymentOption = {
      id: 'mana-payment-phyrexian-life',
      payment: { kind: 'phyrexian-life' },
    };
    expect(planForgeManaPayment({ unpaid: ['W/P', 'W/P'], options: [life, cancel] })).toBeNull();
  });

  it('declines to interpret a generic shard beyond the safe integer range', () => {
    expect(
      planForgeManaPayment({
        unpaid: ['999999999999999999999999999999'],
        options: [mana('mana-pool-0', 'mana-pool-0', 'U'), cancel],
      }),
    ).toBeNull();
  });

  it('declines to guess when Forge reports an unsupported shard shape', () => {
    expect(
      planForgeManaPayment({
        unpaid: ['S'],
        options: [mana('mana-source-75-0-G', 'forge-card-75', 'G'), cancel],
      }),
    ).toBeNull();
  });
});
