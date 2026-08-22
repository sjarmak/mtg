/**
 * The two flags the build cannot start on a bad value for.
 *
 * Everything else the CLI accepts is checked by `DeckCriteriaSchema` on the
 * first line of `buildInformedDeck`, before any model call. `--max-spend-usd`
 * and `--rounds` were not: the spend bound was checked inside `spendMeter` and
 * the round budget was not checked at all, and both are read by the selection
 * loop, which runs after the land plan has already been asked for and paid for.
 * A typo therefore cost a live call before it produced an error.
 *
 * These run with no store and no provider, which is the assertion: a rejected
 * flag must not reach `openStore`, let alone `resolveProvider`.
 */
import { describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli';
import { defaultMaxSpendUsd } from '../src/select';

const REQUIRED = ['--prompt', 'aggressive red burn', '--format', 'modern'] as const;

describe('decklab flag validation', () => {
  it('refuses a spend bound that is not a positive number of dollars', async () => {
    await expect(main([...REQUIRED, '--max-spend-usd', '0'])).rejects.toThrow(
      /--max-spend-usd must be a positive number of dollars, got 0/,
    );
    await expect(main([...REQUIRED, '--max-spend-usd', '-1'])).rejects.toThrow(
      /--max-spend-usd must be a positive number of dollars/,
    );
  });

  it('refuses a spend bound that is not a number at all', async () => {
    await expect(main([...REQUIRED, '--max-spend-usd', 'five'])).rejects.toThrow(
      /--max-spend-usd must be a number, got five/,
    );
  });

  it('refuses a round budget that is not a whole number of rounds', async () => {
    await expect(main([...REQUIRED, '--rounds', '-1'])).rejects.toThrow(
      /--rounds must be a whole number of rounds, zero or more, got -1/,
    );
    await expect(main([...REQUIRED, '--rounds', 'nine'])).rejects.toThrow(
      /--rounds must be a number, got nine/,
    );
    await expect(main([...REQUIRED, '--rounds', '2.5'])).rejects.toThrow(
      /--rounds must be a whole number of rounds/,
    );
  });

  it('states the derived spend default in the usage rather than a figure that can drift', async () => {
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await expect(main(['--help'])).resolves.toBe(0);
    } finally {
      write.mockRestore();
    }

    expect(written.join('')).toContain(`$${defaultMaxSpendUsd(36).toFixed(2)}`);
  });
});
