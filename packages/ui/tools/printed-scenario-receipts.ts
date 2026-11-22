/** Pure evidence assembly after a trusted runner checked execution and source stability. */
import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { PrintedScenarioProbeReceiptSchema, PrintedScenarioProbeResultSchema } from '@mtg/printed-card';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { checkedScenarioUsage } from './printed-scenario-report';

export const PrintedScenarioProbeDefinitionSchema = PrintedScenarioProbeResultSchema.omit({
  status: true,
}).extend({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u),
  testFile: z.string().min(1),
});
type Definition = z.infer<typeof PrintedScenarioProbeDefinitionSchema>;
type ScriptCard = Pick<
  PrintedCardCatalogEntry,
  'name' | 'correctedName' | 'forgeScript' | 'forgeScriptSha256'
>;
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function portablePath(workspace: string, path: string): string {
  const absolute = resolve(path);
  if (!absolute.startsWith(`${resolve(workspace)}${sep}`))
    throw new Error(`Source outside workspace: ${path}`);
  return relative(workspace, absolute).split(sep).join('/');
}
function checkedScript(
  sourceName: string,
  cards: readonly ScriptCard[],
  readScript: (path: string) => string | Uint8Array,
) {
  const matches = cards.filter((card) => card.name === sourceName || card.correctedName === sourceName);
  const first = matches[0];
  if (
    first === undefined ||
    matches.some(
      (card) => card.forgeScript !== first.forgeScript || card.forgeScriptSha256 !== first.forgeScriptSha256,
    )
  )
    throw new Error(`Missing or ambiguous scenario script: ${sourceName}`);
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_-]+)*\.txt$/u.test(first.forgeScript))
    throw new Error(`Unsafe scenario script path: ${first.forgeScript}`);
  if (hash(readScript(first.forgeScript)) !== first.forgeScriptSha256)
    throw new Error(`Scenario script checksum mismatch: ${sourceName}`);
  return { path: first.forgeScript, sha256: first.forgeScriptSha256 };
}

export function createScenarioProbeReceipts(input: {
  readonly workspace: string;
  readonly probes: readonly Definition[];
  readonly runtime: unknown;
  readonly cards: readonly ScriptCard[];
  readonly sources: readonly { readonly path: string; readonly sha256: string }[];
  readonly reportBytes: string;
  readonly usageBytes: string;
  readonly readScript: (path: string) => string | Uint8Array;
}) {
  const probes = z.array(PrintedScenarioProbeDefinitionSchema).min(1).parse(input.probes);
  if (new Set(probes.map((probe) => probe.id)).size !== probes.length)
    throw new Error('Duplicate scenario probe ID');
  const selected = probes.map((probe) => {
    const { decisionSeat, ...required } = probe;
    return {
      ...required,
      ...(decisionSeat === undefined ? {} : { decisionSeat }),
      testFile: resolve(input.workspace, probe.testFile),
      tests: probe.assertions,
    };
  });
  const usage: unknown = input.usageBytes
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
  const rows = checkedScenarioUsage(usage, JSON.parse(input.reportBytes), selected, input.runtime);
  const sources = input.sources.map((file) => ({ ...file, path: portablePath(input.workspace, file.path) }));
  return probes.map(({ testFile, ...result }) =>
    PrintedScenarioProbeReceiptSchema.parse({
      schemaVersion: 1,
      kind: 'printed-scenario-probe-receipt',
      runtime: input.runtime,
      result: { ...result, status: 'passed' },
      sourceScript: checkedScript(result.sourceName, input.cards, input.readScript),
      sources,
      cases: rows
        .filter(
          (row) =>
            row.testFile === resolve(input.workspace, testFile) &&
            result.assertions.includes(
              [...row.testIdentity.ancestorTitles, row.testIdentity.title].join(' '),
            ),
        )
        .map((row) => ({
          testFile: portablePath(input.workspace, row.testFile),
          testIdentity: row.testIdentity,
          formatId: row.formatId,
          stateSha256: row.scenario.sha256,
          seed: row.scenario.seed,
          maximumTurns: row.scenario.maximumTurns,
        })),
      evidence: {
        report: { path: 'vitest.json', sha256: hash(input.reportBytes) },
        usage: { path: 'snapshot-usage.jsonl', sha256: hash(input.usageBytes) },
      },
    }),
  );
}
