/** Explicit local evidence production; never installs admission or touches a running service. */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { PrintedScriptCoveragePlanSchema } from '@mtg/printed-card';
import { withForgeLock } from '../../slice/tools/test-load/host-lock';
import { PrintedProbeDefinitionSchema, runPrintedProbeSuite } from './printed-probe-run';

const Path = z.string().trim().min(1);
const Config = z.strictObject({
  schemaVersion: z.literal(1),
  workspace: Path,
  format: Path,
  catalogs: z.array(Path).min(1),
  probes: z.array(PrintedProbeDefinitionSchema).min(1),
  coveragePlan: Path.optional(),
  controllerContractBundle: Path.optional(),
});
const ContractBundle = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-controller-contract-bundle'),
  contracts: z.array(z.strictObject({ id: Path, path: Path, decisionFamilies: z.array(Path).min(1) })),
});
const Args = z.strictObject({
  config: Path,
  out: Path,
  'timeout-ms': z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().min(1000).max(600000)),
});
const usage =
  'Usage: npx tsx packages/ui/tools/printed-probe-cli.ts --config <json> --out <new-directory> --timeout-ms <1000..600000>\nProduces unproven interaction receipts only; does not enable play.';

function argumentsOf(argv: readonly string[]) {
  const { values, tokens } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    tokens: true,
    options: { config: { type: 'string' }, out: { type: 'string' }, 'timeout-ms': { type: 'string' } },
  });
  const names = tokens.filter((token) => token.kind === 'option').map((token) => token.name);
  if (new Set(names).size !== names.length) throw new Error('Each option must appear once');
  return Args.parse(values);
}

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

export async function printedProbeMain(
  argv: readonly string[],
  io: { readonly stdout: (text: string) => void; readonly stderr: (text: string) => void } = {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
  },
): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') {
    io.stdout(usage);
    return 0;
  }
  try {
    const args = argumentsOf(argv);
    const configPath = resolve(args.config);
    const config = Config.parse(await readJson(configPath));
    const workspace = resolve(dirname(configPath), config.workspace);
    const contractRoot =
      config.controllerContractBundle === undefined
        ? undefined
        : resolve(workspace, config.controllerContractBundle);
    const contractManifest =
      contractRoot === undefined
        ? undefined
        : ContractBundle.parse(await readJson(resolve(contractRoot, 'manifest.json')));
    const contractEvidence = (path: string): Buffer => {
      if (contractRoot === undefined) throw new Error('Controller contract bundle is absent');
      const absolute = resolve(contractRoot, path);
      if (!absolute.startsWith(`${contractRoot}${sep}`))
        throw new Error(`Controller contract evidence escapes bundle: ${path}`);
      return readFileSync(absolute);
    };
    // runPrintedProbeSuite compiles and drives the installed Forge bridge; take the
    // host-wide Forge lock (mtg-b9eom) so this never overlaps another lane's JVMs.
    const result = await withForgeLock(`printed-probe-cli pid ${process.pid}`, async () =>
      runPrintedProbeSuite({
        workspace,
        format: await readJson(resolve(workspace, config.format)),
        catalogs: await Promise.all(config.catalogs.map((path) => readJson(resolve(workspace, path)))),
        probes: config.probes,
        ...(config.coveragePlan === undefined
          ? {}
          : {
              coveragePlan: PrintedScriptCoveragePlanSchema.parse(
                await readJson(resolve(workspace, config.coveragePlan)),
              ),
            }),
        ...(contractManifest === undefined
          ? {}
          : {
              controllerContracts: contractManifest.contracts.map((contract) => ({
                path: contract.path,
                bytes: contractEvidence(contract.path),
                readEvidence: contractEvidence,
              })),
            }),
        outputDirectory: resolve(args.out),
        timeoutMs: args['timeout-ms'],
      }),
    );
    io.stdout(
      JSON.stringify({
        outputDirectory: resolve(args.out),
        subject: result.subject,
        receipts: result.receipts.length,
        qualification: 'unproven',
      }),
    );
    return 0;
  } catch (cause: unknown) {
    io.stderr(`Printed probe run failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await printedProbeMain(process.argv.slice(2));
