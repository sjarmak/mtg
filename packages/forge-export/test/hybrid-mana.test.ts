import { describe, expect, it } from 'vitest';
import { mana } from '@mtg/dsl';
import { forgeManaCost } from '@mtg/forge-export';

describe('Forge hybrid mana syntax', () => {
  it('emits one slashless Forge shard per printed symbol', () => {
    expect(
      forgeManaCost(
        mana({
          generic: 3,
          hybrid: { 'W/U': 2 },
        }),
      ),
    ).toBe('3 WU WU');
  });
});
