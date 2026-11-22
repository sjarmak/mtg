import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ObservedBackend } from '@mtg/engine';
import { strongestForgeObservedPolicy } from '@mtg/forge-export';
import { serializedPrintedConstructedFormatContent, type PrintedConstructedFormat } from '@mtg/printed-card';
import { runPrintedConstructedForgeProof } from '../../tools/printed-constructed-forge';

const unsealedFormat = {
  schemaVersion: 1,
  kind: 'printed-constructed-format',
  id: 'test',
  name: 'Test',
  sources: [
    {
      code: 'TST',
      catalogFormat: 'test-v1',
      catalogSha256: '1'.repeat(64),
      mtgjson: { url: 'https://example.com/TST.json', sha256: '2'.repeat(64), version: '1' },
    },
  ],
  rules: { variant: 'standard', startingLife: 20 },
  decks: ['first', 'second'].map((id) => ({
    id,
    name: id,
    commanders: [],
    cards: [{ physicalId: `test-v1:${id}`, name: id, count: 60 }],
  })),
  contentSha256: '3'.repeat(64),
} as PrintedConstructedFormat;

function sealFormat(value: PrintedConstructedFormat): PrintedConstructedFormat {
  return {
    ...value,
    contentSha256: createHash('sha256')
      .update(serializedPrintedConstructedFormatContent(value))
      .digest('hex'),
  };
}

const format = sealFormat(unsealedFormat);

describe('printed constructed Forge proof', () => {
  it('refuses a candidate whose recorded checksum does not match its contents', async () => {
    const runGame = vi.fn();
    await expect(
      runPrintedConstructedForgeProof({
        format: { ...format, name: 'Changed after sealing' },
        backend: { id: 'forge-test' } as ObservedBackend,
        policy: strongestForgeObservedPolicy,
        runGame,
      }),
    ).rejects.toThrow(/checksum mismatch/u);
    expect(runGame).not.toHaveBeenCalled();
  });

  it('runs every deck through the Constructed page table path against the next bot deck', async () => {
    const runGame = vi.fn().mockImplementation(async (options) => ({
      evidence: { outcome: { status: 'completed' } },
      measurement: { decisions: 12, elapsedMs: 34 },
      table: options.table,
    }));
    const receipt = await runPrintedConstructedForgeProof({
      format,
      backend: { id: 'forge-test' } as ObservedBackend,
      policy: strongestForgeObservedPolicy,
      runGame,
    });
    expect(receipt).toMatchObject({
      formatId: 'test',
      formatSha256: format.contentSha256,
      results: [
        { archetypeId: 'first', status: 'completed', decisions: 12, elapsedMs: 34 },
        { archetypeId: 'second', status: 'completed', decisions: 12, elapsedMs: 34 },
      ],
    });
    expect(runGame).toHaveBeenCalledTimes(2);
    expect(runGame.mock.calls[0]?.[0].table.seats).toMatchObject([
      { name: 'You', controller: 'local', deck: { name: 'first' } },
      { name: 'Forge bot', controller: 'engine', deck: { name: 'second' } },
    ]);
  });

  it('proves a single shipped deck by mirroring it for the bot seat', async () => {
    const runGame = vi.fn().mockResolvedValue({
      evidence: { outcome: { status: 'completed' } },
      measurement: { decisions: 8, elapsedMs: 21 },
    });
    const singleDeckFormat = sealFormat({ ...format, decks: format.decks.slice(0, 1) });
    const receipt = await runPrintedConstructedForgeProof({
      format: singleDeckFormat,
      backend: { id: 'forge-test' } as ObservedBackend,
      policy: strongestForgeObservedPolicy,
      runGame,
    });
    expect(receipt.results).toEqual([
      { archetypeId: 'first', status: 'completed', decisions: 8, elapsedMs: 21 },
    ]);
    expect(runGame.mock.calls[0]?.[0].table.seats).toMatchObject([
      { deck: { name: 'first' } },
      { deck: { name: 'first' } },
    ]);
  });
});
