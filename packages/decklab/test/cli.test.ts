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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { deckCriteriaInputFromArgs, loadPrintedFormatCatalogs, main } from '../src/cli';
import { defaultMaxSpendUsd } from '../src/select';

const REQUIRED = ['--prompt', 'aggressive red burn', '--format', 'modern'] as const;

describe('decklab flag validation', () => {
  it('loads every catalog registered for a multi-set printed format', () => {
    const loaded = loadPrintedFormatCatalogs('jou');
    expect(loaded.map((entry) => entry.code)).toEqual(['BNG', 'JOU', 'THS']);
  });

  it('requires an explicit model-spend ceiling for a printed format build', async () => {
    await expect(
      main([
        '--printed-format',
        'ktk',
        '--prompt',
        'curve out with efficient Abzan creatures',
        '--archetype',
        'Abzan Midrange',
        '--colors',
        'W,B,G',
        '--output',
        'out/ktk-abzan.json',
      ]),
    ).rejects.toThrow(/--max-usd is required/);
  });

  it('refuses a printed format build that is not exactly 60 cards', async () => {
    await expect(
      main([
        '--printed-format',
        'ktk',
        '--prompt',
        'curve out with efficient Abzan creatures',
        '--archetype',
        'Abzan Midrange',
        '--colors',
        'W,B,G',
        '--size',
        '40',
        '--max-usd',
        '15',
        '--output',
        'out/ktk-abzan.json',
      ]),
    ).rejects.toThrow(/must contain 60 cards/);
  });

  it('loads a declared opponent population into the build criteria', () => {
    const directory = mkdtempSync(join(tmpdir(), 'decklab-opponents-'));
    const path = join(directory, 'field.json');
    try {
      writeFileSync(
        path,
        JSON.stringify({
          id: 'modern-field',
          members: [
            { id: 'energy', share: 0.65, strategy: 'build a wide board' },
            { id: 'combo', share: 0.35, strategy: 'race with a combo' },
          ],
        }),
      );
      expect(deckCriteriaInputFromArgs([...REQUIRED, '--opponents', path])).toMatchObject({
        opponentPopulation: {
          id: 'modern-field',
          members: [
            { id: 'energy', share: 0.65 },
            { id: 'combo', share: 0.35 },
          ],
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
