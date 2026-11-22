/** A bounded, independently rerunnable cohort; these receipts do not admit the format. */
import { expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PrintedPlayProbeReceiptSchema } from '@mtg/printed-card';
import { printedProbeMain } from '../../tools/printed-probe-cli';
import config from '../../data/akh-hou-textless-probes-v1.json';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt(
  'retains twenty-eight exact textless casting and combat receipts without admission',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'mtg-textless-probe-run-'));
    const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
    try {
      const io = { stdout: vi.fn(), stderr: vi.fn() };
      const code = await printedProbeMain(
        [
          '--config',
          'packages/ui/data/akh-hou-textless-probes-v1.json',
          '--out',
          join(root, 'evidence'),
          '--timeout-ms',
          '180000',
        ],
        io,
      );
      expect(code, io.stderr.mock.calls.flat().join('\n')).toBe(0);
      expect(io.stderr).not.toHaveBeenCalled();
      expect(JSON.parse(io.stdout.mock.calls[0]![0] as string)).toMatchObject({
        receipts: 28,
        qualification: 'unproven',
      });
      const provenance = json(join(root, 'evidence/provenance.json'));
      const helper = 'packages/forge-export/test/support/textless-blocking.ts';
      expect(provenance.sources).toContainEqual({
        path: join(process.cwd(), helper),
        sha256: createHash('sha256').update(readFileSync(helper)).digest('hex'),
      });
      expect(json(join(root, 'evidence/vitest.json'))).toMatchObject({
        numTotalTests: 28,
        numPassedTests: 28,
        numFailedTests: 0,
        numPendingTests: 0,
      });
      for (const probe of config.probes) {
        const receipt = PrintedPlayProbeReceiptSchema.parse(
          json(join(root, 'evidence/probes', `${probe.id}.json`)),
        );
        expect(receipt.subject).toEqual(provenance.subject);
        expect(receipt.result).toEqual({
          id: probe.id,
          scope: probe.scope,
          controller: probe.controller,
          cardIds: probe.cardIds,
          decisionFamilies: probe.decisionFamilies,
          assertions: probe.assertions,
          status: 'passed',
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  240_000,
);
