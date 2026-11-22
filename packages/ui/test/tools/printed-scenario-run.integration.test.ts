import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { PrintedScenarioProbeReceiptSchema, PrintedPlayProbeReceiptSchema } from '@mtg/printed-card';
import { PrintedProbeDefinitionSchema } from '../../tools/printed-probe-run';
import { printedProbeMain } from '../../tools/printed-probe-cli';
import * as scenarioVerification from '../../tools/printed-scenario-verify';
import config from '../../data/akh-hou-exert-scenarios-v1.json';

it('routes explicit scenario claims through the existing probe runner', () => {
  expect(config.probes).toHaveLength(10);
  expect(config.probes.flatMap((probe) => probe.assertions)).toHaveLength(13);
  for (const probe of config.probes) expect(PrintedProbeDefinitionSchema.parse(probe)).toEqual(probe);
});
const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
// Quarantined: mtg-os236. `akh-hou-exert-scenarios-v1.json`'s coveragePlan
// field names `out/validation-pilot/akh-hou-complete-coverage-plan-v6/
// coverage-plan.json`, a gitignored, never-committed output of a manual,
// multi-step `qualify-printed-set` pilot run (itself depending on a second
// gitignored artifact, `akh-hou-controller-contracts-v11`). No command in
// this repo reproduces it, and this test's assertions are byte/count-exact
// against whatever that specific run produced (printings: 550, scripts: 509,
// a gust_walker.txt obligation breakdown, a sha256 of the plan file's own
// bytes), so regenerating it blind would silently change what the test
// verifies rather than fix it. See mtg-os236 for the two real fixes: commit
// a fresh, audited regeneration, or rewrite the assertions to check
// structure instead of one run's exact historical counts.
forgeIt.skip(
  'retains thirteen copied-runtime controller cases as ten scoped source-bound receipts',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'mtg-scenario-run-test-'));
    const verification = vi.spyOn(scenarioVerification, 'verifyRetainedScenarioProbeReceipts');
    try {
      const io = { stdout: vi.fn(), stderr: vi.fn() };
      const output = join(root, 'evidence');
      const code = await printedProbeMain(
        [
          '--config',
          'packages/ui/data/akh-hou-exert-scenarios-v1.json',
          '--out',
          output,
          '--timeout-ms',
          '300000',
        ],
        io,
      );
      expect(code, io.stderr.mock.calls.flat().join('\n')).toBe(0);
      const report = JSON.parse(readFileSync(join(output, 'vitest.json'), 'utf8'));
      expect(report).toMatchObject({
        success: true,
        numTotalTests: 13,
        numPassedTests: 13,
        numPendingTests: 0,
      });
      for (const probe of config.probes) {
        const receipt = PrintedScenarioProbeReceiptSchema.parse(
          JSON.parse(readFileSync(join(output, 'probes', `${probe.id}.json`), 'utf8')),
        );
        expect(receipt.result).toMatchObject({
          sourceName: probe.sourceName,
          sourceSeat: probe.sourceSeat,
          controller: probe.controller,
        });
        expect(receipt.cases).toHaveLength(probe.assertions.length);
        expect(PrintedPlayProbeReceiptSchema.safeParse(receipt).success).toBe(false);
        for (const evidence of Object.values(receipt.evidence))
          expect(
            createHash('sha256')
              .update(readFileSync(join(output, evidence.path)))
              .digest('hex'),
          ).toBe(evidence.sha256);
      }
      expect(existsSync(join(output, 'admission.json'))).toBe(false);
      expect(verification).toHaveBeenCalledOnce();
      expect(verification.mock.calls[0]![0].probes).toEqual(config.probes);
      const coverage = JSON.parse(readFileSync(join(output, 'script-coverage.json'), 'utf8'));
      expect(coverage).toMatchObject({
        admitted: false,
        evidenceVerification: 'scenario-receipts-verified',
        summary: {
          printings: 550,
          scripts: 509,
          requirementsCovered: 1,
          partial: 508,
          missingReview: 0,
        },
      });
      expect(coverage.cards).toHaveLength(550);
      expect(coverage.plan.sha256).toBe(
        createHash('sha256')
          .update(readFileSync(join(output, 'coverage-plan.json')))
          .digest('hex'),
      );
      const walker = coverage.scripts.find(
        (script: { sourceScript: { path: string } }) => script.sourceScript.path === 'g/gust_walker.txt',
      );
      expect(walker.unmappedLines).toEqual([]);
      expect(walker.obligations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'power-increase', covered: { local: true, engine: true } }),
          expect.objectContaining({ id: 'flying-and-toughness', covered: { local: false, engine: false } }),
          expect.objectContaining({ id: 'decline-exert', covered: { local: true, engine: false } }),
        ]),
      );
    } finally {
      verification.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  },
  360_000,
);
