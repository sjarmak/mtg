/** Private qualification tooling. Receipts do not automatically review or admit any card. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  compileInstalledForgeBridge,
  createForgeRuntimeSnapshot,
  measureForgeRuntime,
} from '@mtg/forge-export';
import {
  PrintedPlayProbeReceiptSchema,
  PrintedScriptCoveragePlanSchema,
  parsePrintedCardCatalog,
} from '@mtg/printed-card';
import {
  buildPrintedScriptCoveragePlan,
  buildPrintedScriptCoverageReport,
  verifiedPrintedFormat,
  verifyPrintedControllerContractReceipt,
} from '@mtg/printed-card/node';
import { checkedProbeReport, checkedProbeUsage, groupedProbeFiles } from './printed-probe-report';
import { runProbeProcess } from './printed-probe-process';
import { captureProbeSources } from './printed-probe-sources';
import { verifyRetainedScenarioProbeReceipts } from './printed-scenario-verify';
import {
  createScenarioProbeReceipts,
  PrintedScenarioProbeDefinitionSchema,
} from './printed-scenario-receipts';
import { bundleInstalledForgeAdapter } from './installed-adapter-bundle';

const WholeGameProbeDefinitionSchema = PrintedPlayProbeReceiptSchema.shape.result
  .omit({ status: true })
  .extend({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u),
    testFile: z.string().min(1),
  });
export const PrintedProbeDefinitionSchema = z.union([
  WholeGameProbeDefinitionSchema,
  PrintedScenarioProbeDefinitionSchema,
]);
const Options = z.strictObject({
  workspace: z.string().min(1),
  format: z.unknown(),
  catalogs: z.array(z.unknown()).min(1),
  outputDirectory: z.string().min(1),
  timeoutMs: z.number().int().min(1000).max(600000),
  forgeHome: z.string().min(1).optional(),
  probes: z.array(PrintedProbeDefinitionSchema).min(1),
  coveragePlan: PrintedScriptCoveragePlanSchema.optional(),
  controllerContracts: z
    .array(
      z.strictObject({
        path: z.string().min(1),
        bytes: z.custom<string | Uint8Array>(
          (value) => typeof value === 'string' || value instanceof Uint8Array,
        ),
        readEvidence: z.custom<(path: string) => string | Uint8Array>((value) => typeof value === 'function'),
      }),
    )
    .optional(),
});
const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Selected tests must be reviewed users of snapshotForgeBackend, not arbitrary green tests. */
export async function runPrintedProbeSuite(input: z.infer<typeof Options>) {
  const options = Options.parse(input);
  const workspace = resolve(options.workspace);
  // Either format kind: a probe suite binds the format's identity, not its packs.
  const prepared = verifiedPrintedFormat(options.format, options.catalogs);
  const cardIds = new Set(
    options.catalogs.flatMap((catalog) =>
      parsePrintedCardCatalog(catalog).cards.map((card) => card.physicalId),
    ),
  );
  const selected = options.probes.map((probe) => {
    const testFile = resolve(workspace, probe.testFile);
    if (
      isAbsolute(probe.testFile) ||
      !testFile.startsWith(`${workspace}${sep}`) ||
      !testFile.endsWith('.test.ts')
    )
      throw new Error(`Invalid probe test path: ${probe.testFile}`);
    if (probe.scope !== 'scenario' && probe.cardIds.some((id) => !cardIds.has(id)))
      throw new Error(`Probe names foreign card: ${probe.id}`);
    return { testFile, tests: probe.assertions, controller: probe.controller };
  });
  if (new Set(options.probes.map((probe) => probe.id)).size !== options.probes.length)
    throw new Error('Probe IDs must be unique');
  const scenarioProbes = options.probes.filter((probe) => probe.scope === 'scenario');
  if (scenarioProbes.length !== 0 && scenarioProbes.length !== options.probes.length)
    throw new Error('Scenario and whole-game claims require separate suites');
  if (options.coveragePlan !== undefined && scenarioProbes.length === 0)
    throw new Error('Script coverage requires a scenario suite');
  const files = groupedProbeFiles(selected);
  const sourcePaths = files.map((file) => file.testFile);
  const sources = await captureProbeSources(workspace, sourcePaths);
  const output = resolve(options.outputDirectory);
  await mkdir(output);
  const temporary = await mkdtemp(join(tmpdir(), 'mtg-printed-probe-run-'));
  let compiled: ReturnType<typeof compileInstalledForgeBridge> | undefined;
  let snapshot: ReturnType<typeof createForgeRuntimeSnapshot> | undefined;
  try {
    const forgeHome = options.forgeHome ?? join(workspace, 'tools/forge/dist');
    compiled = compileInstalledForgeBridge({
      forgeHome,
      bridgeSource: join(workspace, 'packages/forge-export/bridge/ForgeBridge.java'),
      outputParent: temporary,
    });
    if (compiled === null) throw new Error('Required Forge installation is absent');
    await bundleInstalledForgeAdapter(workspace, join(temporary, 'bundle'));
    snapshot = createForgeRuntimeSnapshot({
      forgeHome,
      bridge: { kind: 'compiled', path: compiled.classDirectory },
      adapterBundlePath: join(temporary, 'bundle/adapter.mjs'),
      outputParent: temporary,
    });
    compiled.dispose();
    const subject = {
      ...snapshot.identity,
      formatId: prepared.format.id,
      formatSha256: prepared.format.contentSha256,
      catalogs: Object.fromEntries(
        prepared.format.sources.map((source) => [source.code, source.catalogSha256]),
      ),
    };
    const expectedEngineRuntime = {
      forgeVersion: snapshot.identity.forgeVersion,
      forgeJarSha256: snapshot.identity.forgeJarSha256,
      scriptArchiveSha256: snapshot.identity.scriptArchiveSha256,
      resourcesSha256: snapshot.identity.resourcesSha256,
      protocolVersion: snapshot.identity.protocolVersion,
    };
    const contractInputs = options.controllerContracts ?? [];
    const contracts = contractInputs.map((file) =>
      verifyPrintedControllerContractReceipt({
        body: file.bytes,
        expectedEngineRuntime,
        readEvidence: file.readEvidence,
        readSource: (path) => readFileSync(resolve(workspace, path)),
      }),
    );
    const manifestPath = join(temporary, 'runtime.json');
    await writeFile(
      manifestPath,
      json({ schemaVersion: 1, inputs: snapshot.inputs, identity: snapshot.identity }),
      { flag: 'wx' },
    );
    await writeFile(
      join(output, 'provenance.json'),
      json({ subject, sources, probes: options.probes, qualification: 'unproven' }),
      { flag: 'wx' },
    );
    const reportPath = join(output, 'vitest.json');
    const usagePath = join(output, 'snapshot-usage.jsonl');
    await writeFile(usagePath, '', { flag: 'wx' });
    const executed = await runProbeProcess(
      process.execPath,
      [
        join(workspace, 'node_modules/vitest/vitest.mjs'),
        'run',
        ...files.map((file) => file.testFile),
        '--project',
        'unit',
        '--reporter=json',
        `--outputFile=${reportPath}`,
        '--maxWorkers=1',
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          MTG_REQUIRE_FORGE_BRIDGE: '1',
          MTG_FORGE_TEST_SNAPSHOT: manifestPath,
          MTG_FORGE_TEST_SNAPSHOT_USAGE: usagePath,
        },
        timeoutMs: options.timeoutMs,
      },
    );
    await writeFile(join(output, 'process.json'), json(executed), { flag: 'wx' });
    if (executed.code !== 0 || executed.error !== null)
      throw new Error(
        `Probe process failed: ${executed.error ?? `exit ${String(executed.code)}`}; see ${join(output, 'process.json')}`,
      );
    const reportBytes = await readFile(reportPath, 'utf8');
    const usageBytes = await readFile(usagePath, 'utf8');
    checkedProbeReport(JSON.parse(reportBytes), selected);
    const usage = usageBytes
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    if (scenarioProbes.length === 0)
      checkedProbeUsage(usage, selected, snapshot.identity, prepared.format.id);
    if (!isDeepStrictEqual(measureForgeRuntime(snapshot.inputs), snapshot.identity))
      throw new Error('Probe runtime changed during execution');
    if (!isDeepStrictEqual(await captureProbeSources(workspace, sourcePaths), sources))
      throw new Error('Probe sources changed during execution');
    const scenarioEvidence = {
      workspace,
      probes: scenarioProbes,
      runtime: snapshot.identity,
      cards: options.catalogs.flatMap((catalog) => parsePrintedCardCatalog(catalog).cards),
      sources,
      readScript: (member: string) =>
        execFileSync(
          'unzip',
          ['-p', join(snapshot!.inputs.forgeHome, 'res/cardsfolder/cardsfolder.zip'), member],
          { timeout: 30000, maxBuffer: 1024 * 1024 },
        ),
    };
    const receipts =
      scenarioProbes.length > 0
        ? createScenarioProbeReceipts({ ...scenarioEvidence, reportBytes, usageBytes })
        : options.probes.map(({ testFile: _file, ...result }) =>
            PrintedPlayProbeReceiptSchema.parse({
              schemaVersion: 1,
              kind: 'printed-play-probe-receipt',
              subject,
              result: { ...result, status: 'passed' },
            }),
          );
    await mkdir(join(output, 'probes'));
    for (const receipt of receipts)
      await writeFile(join(output, 'probes', `${receipt.result.id}.json`), json(receipt), { flag: 'wx' });
    if (scenarioProbes.length > 0) {
      const verified = await verifyRetainedScenarioProbeReceipts({
        ...scenarioEvidence,
        readEvidence: (path) => readFile(join(output, path), 'utf8'),
      });
      if (options.coveragePlan !== undefined) {
        const completePlan = buildPrintedScriptCoveragePlan(
          options.catalogs,
          scenarioEvidence.readScript,
          options.coveragePlan.scripts,
        );
        const planBytes = json(completePlan);
        const coverage = buildPrintedScriptCoverageReport({
          catalogs: options.catalogs,
          plan: completePlan,
          receipts: verified.receipts,
          verifiedControllerContracts: contracts,
          measuredRuntime: snapshot.identity,
          readScript: scenarioEvidence.readScript,
          readResource: (path) => readFileSync(join(snapshot!.inputs.forgeHome, 'res', path)),
        });
        await writeFile(join(output, 'coverage-plan.json'), planBytes, { flag: 'wx' });
        if (contracts.length > 0) {
          await mkdir(join(output, 'contracts'));
          const retained = new Map<string, string | Uint8Array>();
          const retain = (path: string, bytes: string | Uint8Array): void => {
            const prior = retained.get(path);
            if (prior !== undefined && digest(prior) !== digest(bytes))
              throw new Error(`Conflicting controller contract evidence: ${path}`);
            retained.set(path, bytes);
          };
          contracts.forEach((contract, index) => {
            const source = contractInputs[index];
            if (source === undefined) throw new Error(`Missing controller contract input: ${contract.id}`);
            retain(`contracts/${contract.id}.json`, source.bytes);
            for (const evidence of contract.evidence.scenarioReceipts)
              retain(evidence.file.path, source.readEvidence(evidence.file.path));
            for (const region of contract.sourceRegions)
              retain(region.path, readFileSync(resolve(workspace, region.path)));
          });
          for (const [path, bytes] of retained) {
            const destination = resolve(output, path);
            if (!destination.startsWith(`${output}${sep}`))
              throw new Error(`Controller contract evidence escapes output: ${path}`);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, bytes, { flag: 'wx' });
          }
        }
        await writeFile(
          join(output, 'script-coverage.json'),
          json({
            ...coverage,
            evidenceVerification:
              contracts.length === 0 ? 'scenario-receipts-verified' : 'controller-evidence-verified',
            plan: { path: 'coverage-plan.json', sha256: digest(planBytes) },
          }),
          { flag: 'wx' },
        );
      }
      return { subject, ...verified };
    }
    return { subject, receipts, qualification: 'unproven' as const };
  } finally {
    snapshot?.dispose();
    compiled?.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
}
