import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../tools/legacy-cube-quality';

it('writes an export-ready campaign from the active store without a model call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtg-mixed-propose-'));
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    await main([
      'propose',
      '--corpus',
      'packages/metrics/data/legacy-cube-transfer-decks-v1.json',
      '--store',
      join(root, 'store'),
      '--root',
      'propose-cli-fixture',
      '--indices',
      '0,1',
      '--out',
      join(root, 'proposal'),
    ]);
    const report = JSON.parse(await readFile(join(root, 'proposal', 'proposal.json'), 'utf8'));
    const request = JSON.parse(await readFile(join(root, 'proposal', 'request.json'), 'utf8'));
    expect(report.status).toBe('insufficient-evidence');
    expect(request).toEqual(report.campaign.request);
    expect(request.split).toBe('holdout');
    expect(request.policies).toHaveLength(20);
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"modelCalls":0'));
  } finally {
    output.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
