/** Opening-hand actions remain outside every model-facing card answer. */
import { describe, expect, it } from 'vitest';
import { FilledEnchantmentWithAbilitiesSchema } from '../src/filled';

describe('opening-hand action containment', () => {
  it('does not expose or retain the engine-only card field in a model answer', () => {
    const parsed = FilledEnchantmentWithAbilitiesSchema.parse({
      slotId: 'green-rare-1',
      kind: 'enchantment',
      name: 'Model Leyline',
      manaCost: { generic: 2, G: 2 },
      abilities: [],
      designNote: 'A model must not be able to commission pregame rules.',
      openingHandAction: { kind: 'beginOnBattlefield' },
    });

    expect(parsed).not.toHaveProperty('openingHandAction');
  });
});
