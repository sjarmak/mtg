/** Produces checked receipts from existing assertions run against copied executable inputs. */
import { expect, it, vi } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrintedPlayProbeReceiptSchema } from '@mtg/printed-card';
import { runPrintedProbeSuite } from '../../tools/printed-probe-run';
import { printedProbeMain } from '../../tools/printed-probe-cli';
import probeConfig from '../../data/akh-hou-probes-v1.json';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt(
  'records local and native interaction receipts from the measured snapshot',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'mtg-printed-probe-run-test-'));
    const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
    const catalogs = ['akh', 'hou', 'mp2'].map((code) =>
      json(`packages/data/data/akh-hou/${code}-printed-catalog-v1.json`),
    );
    const cardId = catalogs
      .flatMap((catalog) => catalog.cards)
      .find((card) => card.correctedName === 'Binding Mummy').physicalId;
    try {
      const io = { stdout: vi.fn(), stderr: vi.fn() };
      const code = await printedProbeMain(
        [
          '--config',
          'packages/ui/data/akh-hou-probes-v1.json',
          '--out',
          join(root, 'evidence'),
          '--timeout-ms',
          '300000',
        ],
        io,
      );
      expect(code, io.stderr.mock.calls.flat().join('\n')).toBe(0);
      expect(io.stderr).not.toHaveBeenCalled();
      expect(JSON.parse(io.stdout.mock.calls[0]![0] as string)).toMatchObject({
        receipts: 38,
        qualification: 'unproven',
      });
      const provenance = json(join(root, 'evidence/provenance.json'));
      const result = {
        subject: provenance.subject,
        qualification: provenance.qualification,
        receipts: probeConfig.probes.map((probe) =>
          PrintedPlayProbeReceiptSchema.parse(json(join(root, 'evidence/probes', `${probe.id}.json`))),
        ),
      };
      expect(result.receipts).toHaveLength(38);
      expect(json(join(root, 'evidence/vitest.json'))).toMatchObject({
        numTotalTests: 74,
        numPassedTests: 74,
        numFailedTests: 0,
        numPendingTests: 0,
      });
      expect(result.receipts.map((receipt) => receipt.result.controller)).toEqual([
        'engine',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'engine',
        'local',
        'local',
        'engine',
        'local',
        'local',
        'engine',
        'engine',
        'local',
        'engine',
      ]);
      for (const receipt of result.receipts) {
        expect(receipt.subject).toEqual(result.subject);
        expect(receipt.result.status).toBe('passed');
      }
      expect(json(join(root, 'evidence/probes/binding-mummy-local-v1.json'))).toEqual(result.receipts[2]);
      expect(result.qualification).toBe('unproven');
      await expect(
        runPrintedProbeSuite({
          workspace: resolve('.'),
          format: json('packages/data/data/akh-hou/akh-hou-limited-format-v1.json'),
          catalogs,
          outputDirectory: join(root, 'unrelated'),
          timeoutMs: 180_000,
          probes: [
            {
              id: 'unrelated-green-test',
              scope: 'card',
              controller: 'local',
              cardIds: [cardId],
              decisionFamilies: ['zombie-entry-optional-tap'],
              testFile: 'packages/forge-export/test/snapshot-backend.test.ts',
              assertions: [
                'loads the copied adapter with exact measured runtime paths',
                'refuses changed runtime bytes before importing the adapter',
                'refuses malformed or missing manifests without falling back to the workspace',
                'refuses source bridge manifests and undeclared input overrides',
              ],
            },
          ],
        }),
      ).rejects.toThrow(/snapshot usage/);
      expect(json(join(root, 'unrelated/process.json')).code).toBe(0);
      expect(existsSync(join(root, 'unrelated/probes'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  450_000,
);
