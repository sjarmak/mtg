/** Offline discovery only: full native games do not exercise the observed bridge. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import { createInstalledForgeBotRunner } from '@mtg/forge-export';
import type { BotRunInput, InstalledBotResult } from '@mtg/forge-export';
import { samplePrintedLimitedDecks } from './printed-limited-decks';

const OptionsSchema = z.strictObject({
  format: z.unknown(),
  catalogs: z.array(z.unknown()).min(1),
  mode: z.enum(['draft', 'sealed']),
  seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  outputDirectory: z.string().trim().min(1),
  timeoutMs: z.number().int().min(1000).max(600000),
});
export type PrintedNativeSmokeOptions = z.infer<typeof OptionsSchema>;
interface NativeRunner {
  readonly botFingerprint: string;
  readonly forgeVersion: string;
  readonly run: (input: BotRunInput) => Promise<InstalledBotResult>;
  readonly dispose: () => void;
}

/**
 * Writes one immutable run directory. Native logs can include terminal hidden
 * hands: these are private diagnostic artifacts, never draft-advisor input.
 * Catalog membership is retained, but no card is promoted to qualified here.
 */
export async function runPrintedNativeSmoke(
  input: PrintedNativeSmokeOptions,
  createRunner: () => NativeRunner = createInstalledForgeBotRunner,
) {
  const options = OptionsSchema.parse(input);
  const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
  const prepared = await preparePrintedLimitedFormat(options.format, options.catalogs, digest);
  const decks = samplePrintedLimitedDecks(prepared, options.mode, options.seed);
  const directory = resolve(options.outputDirectory);
  // Exclusive creation prevents accidental evidence replacement on a repeated seed.
  await mkdir(directory);
  for (const deck of decks) await writeFile(join(directory, deck.file), deck.text, { flag: 'wx' });
  const runner = createRunner();
  try {
    const native = await runner.run({
      deckA: join(directory, decks[0]!.file),
      deckB: join(directory, decks[1]!.file),
      seed: options.seed,
      timeoutMs: options.timeoutMs,
    });
    const result = {
      schemaVersion: 1,
      kind: 'printed-native-smoke',
      qualification: 'unproven',
      bridgeCoverage: 'not-exercised',
      status: native.status === 'completed' ? 'completed-native-game' : 'failed',
      formatId: prepared.format.id,
      formatFingerprint: prepared.fingerprint,
      formatSha256: prepared.format.contentSha256,
      catalogs: prepared.format.sources,
      mode: options.mode,
      seed: options.seed,
      deckPolicy: 'printed-structural/v1',
      botFingerprint: runner.botFingerprint,
      forgeVersion: runner.forgeVersion,
      decks: decks.map(({ text, ...deck }) => ({
        ...deck,
        deckSha256: createHash('sha256').update(text).digest('hex'),
      })),
      native,
    };
    await writeFile(join(directory, 'report.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    return result;
  } finally {
    runner.dispose();
  }
}
