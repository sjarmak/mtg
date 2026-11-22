import { describe, expect, it } from 'vitest';
import { FilledCardSchema } from '@mtg/setgen';

describe('Battle generator containment', () => {
  it('keeps Battle hand-authored until a generation role is deliberately designed', () => {
    expect(
      FilledCardSchema.safeParse({
        kind: 'battle',
        slotId: 'battle-slot',
        name: 'Generated Siege',
        defense: 4,
      }).success,
    ).toBe(false);
  });
});
