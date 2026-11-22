import { afterEach, expect, it, vi } from 'vitest';
import { main } from '../tools/legacy-cube-quality';

const mocks = vi.hoisted(() => ({ run: vi.fn(), transfer: vi.fn(), reviewer: vi.fn() }));
vi.mock('../src/legacy-cube-calibration/quality-run', () => ({ runQualityReviews: mocks.run }));
vi.mock('../src/legacy-cube-calibration/transfer-run', () => ({ runTransferReviews: mocks.transfer }));
vi.mock('../src/legacy-cube-calibration/codex-review', () => ({
  createCodexQualityReviewer: mocks.reviewer,
}));
vi.mock('../src/legacy-cube-calibration/io', () => ({
  calibrationSourceFingerprint: async () => 'a'.repeat(64),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

const options = [
  'run',
  '--bundle',
  'bundle',
  '--ledger',
  'ledger',
  '--archive',
  'archive',
  '--codex-bin',
  '/verified/codex',
  '--model',
  'fixture-model',
  '--max-calls',
  '7',
];

it('connects explicit OAuth configuration and call budget to the reserved runner', async () => {
  const reviewer = { model: 'fixture-model', review: vi.fn() };
  mocks.reviewer.mockReturnValue(reviewer);
  mocks.run.mockResolvedValue({ campaign: 'campaign', receipts: 'receipts', modelCalls: 7 });
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await main(options);
  expect(mocks.reviewer).toHaveBeenCalledWith({
    binary: '/verified/codex',
    model: 'fixture-model',
    archive: 'archive',
    runtimeSha256: 'a'.repeat(64),
  });
  expect(mocks.run).toHaveBeenCalledWith(
    { bundle: 'bundle', ledger: 'ledger', maxCalls: 7 },
    expect.objectContaining({ cards: expect.any(Array) }),
    'a'.repeat(64),
    reviewer,
  );
  expect(output).toHaveBeenCalledWith(expect.stringContaining('"modelCalls":7'));
});

it.each(['-1', '1.5', 'Infinity', 'NaN', '500001', ''])(
  'refuses invalid call budget %s before creating a reviewer',
  async (budget) => {
    await expect(main([...options.slice(0, -1), budget])).rejects.toThrow();
    expect(mocks.reviewer).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  },
);

it('requires all execution options and propagates runner failures', async () => {
  await expect(main(options.slice(0, -2))).rejects.toThrow();
  mocks.run.mockRejectedValue(new Error('reserved attempt already exists'));
  await expect(main(options)).rejects.toThrow(/reserved attempt/);
});

it('runs adjacent-source reviews with explicit split and preserves the original corpus', async () => {
  const reviewer = { model: 'fixture-model', review: vi.fn() };
  mocks.reviewer.mockReturnValue(reviewer);
  mocks.transfer.mockResolvedValue({ campaign: 'transfer', receipts: 'receipts', modelCalls: 1 });
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await main([
    'transfer-run',
    '--corpus',
    'packages/metrics/data/legacy-cube-transfer-holdout-decks-v1.json',
    '--split',
    'holdout',
    ...options.slice(3, -1),
    '1',
  ]);
  expect(mocks.transfer).toHaveBeenCalledWith(
    { ledger: 'ledger', split: 'holdout', maxCalls: 1 },
    expect.objectContaining({ cases: expect.any(Array) }),
    expect.objectContaining({ cards: expect.any(Array) }),
    'a'.repeat(64),
    reviewer,
  );
  expect(mocks.run).not.toHaveBeenCalled();
});

it('refuses a missing transfer corpus before constructing a reviewer', async () => {
  await expect(
    main([
      'transfer-run',
      '--corpus',
      '/nonexistent/transfer-corpus.json',
      '--split',
      'holdout',
      ...options.slice(3, -1),
      '1',
    ]),
  ).rejects.toThrow(/ENOENT/);
  expect(mocks.reviewer).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
});
