/** Deterministic, offline verifier for the Forge decision-family ledger. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  LEGACY_CUBE_DECISION_LEDGER_PATH,
  describeError,
  legacyCubeBridgeCardFamilySafeNames,
  loadLegacyCubeDecisionLedger,
  officialLegacyCubeDecisionEntries,
  verifyForgePlayerControllerSurface,
  verifyLegacyCubeDecisionBridgeSource,
  verifyLegacyCubeExtinctionEventImplementation,
  verifyLegacyCubeDecisionScript,
  verifyLegacyCubeGeneratedScriptDependencies,
} from '@mtg/data';

interface Io {
  readonly out: (line: string) => void;
  readonly error: (line: string) => void;
}

const STDIO: Io = {
  out: (line) => console.log(line),
  error: (line) => console.error(line),
};

const USAGE = `verify-legacy-cube-decisions [options]

The flagless verifier reads only the committed ledger and provenance. An
installed Forge archive is an explicit, offline byte-for-byte cross-check.

  --ledger PATH         ledger JSON (default: committed v1 artifact)
  --forge-scripts PATH  verify every pinned script against cardsfolder.zip
  --forge-token-scripts PATH verify pinned generated scripts from res/tokenscripts
  --controller-javap PATH verify pinned PlayerController public surface
  --choose-even-odd-class PATH verify pinned ChooseEvenOddEffect class bytes
  --choose-even-odd-source PATH verify tag-pinned ChooseEvenOddEffect source
  --bridge-source PATH   verify the bounded ForgeBridge.java implementation
  --help                 print this text`;

class HelpRequested extends Error {}

function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a path`);
  return value;
}

function parseArgs(argv: readonly string[]): {
  readonly ledger: string;
  readonly forgeScripts?: string;
  readonly forgeTokenScripts?: string;
  readonly controllerJavap?: string;
  readonly chooseEvenOddClass?: string;
  readonly chooseEvenOddSource?: string;
  readonly bridgeSource?: string;
} {
  let ledger = LEGACY_CUBE_DECISION_LEDGER_PATH;
  let forgeScripts: string | undefined;
  let forgeTokenScripts: string | undefined;
  let controllerJavap: string | undefined;
  let chooseEvenOddClass: string | undefined;
  let chooseEvenOddSource: string | undefined;
  let bridgeSource: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--help') throw new HelpRequested();
    if (arg === '--ledger') {
      ledger = valueAfter(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--forge-scripts') {
      forgeScripts = valueAfter(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--controller-javap') {
      controllerJavap = valueAfter(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--forge-token-scripts') {
      forgeTokenScripts = valueAfter(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--choose-even-odd-class') {
      chooseEvenOddClass = valueAfter(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--choose-even-odd-source') {
      chooseEvenOddSource = valueAfter(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--bridge-source') {
      bridgeSource = valueAfter(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }
  return {
    ledger,
    ...(forgeScripts === undefined ? {} : { forgeScripts }),
    ...(forgeTokenScripts === undefined ? {} : { forgeTokenScripts }),
    ...(controllerJavap === undefined ? {} : { controllerJavap }),
    ...(chooseEvenOddClass === undefined ? {} : { chooseEvenOddClass }),
    ...(chooseEvenOddSource === undefined ? {} : { chooseEvenOddSource }),
    ...(bridgeSource === undefined ? {} : { bridgeSource }),
  };
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function main(argv: readonly string[], io: Io = STDIO): number {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (cause) {
    if (cause instanceof HelpRequested) {
      io.out(USAGE);
      return 0;
    }
    io.error(describeError(cause));
    io.error(USAGE);
    return 2;
  }

  try {
    const ledger = loadLegacyCubeDecisionLedger(args.ledger);
    io.out(
      `tracked ledger: ${String(officialLegacyCubeDecisionEntries(ledger).length)} positions, ` +
        `${String(ledger.families.length)} closed decision families, content ${ledger.contentSha256}`,
    );
    const safeNames = legacyCubeBridgeCardFamilySafeNames(ledger);
    io.out(
      `reviewed bridge card-family-safe names (${String(safeNames.length)}, not session-safe): ${safeNames.join(', ')}`,
    );

    if (args.forgeScripts !== undefined) {
      const archive = readFileSync(args.forgeScripts);
      const archiveHash = sha256(archive);
      if (archiveHash !== ledger.forge.cardScriptArchiveSha256) {
        throw new Error(
          `Forge card-script archive checksum drift: expected ${ledger.forge.cardScriptArchiveSha256}, got ${archiveHash}`,
        );
      }
      const extraction = mkdtempSync(join(tmpdir(), 'mtg-legacy-decision-scripts-'));
      try {
        const result = spawnSync('unzip', ['-qq', args.forgeScripts, '-d', extraction], {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
        });
        if (result.error !== undefined || result.status !== 0) {
          throw new Error(result.error?.message ?? (result.stderr.trim() || 'unzip failed'));
        }
        for (const entry of ledger.auditedCards) {
          const cardBytes = readFileSync(join(extraction, entry.forgeScript));
          verifyLegacyCubeDecisionScript(entry, cardBytes, ledger.syntaxInventory);
          if (entry.bridgeCapabilityProfile?.generatedObjects === 'pinned-token-scripts-v1') {
            if (args.forgeTokenScripts === undefined) {
              throw new Error('--forge-token-scripts is required for pinned generated token scripts');
            }
            verifyLegacyCubeGeneratedScriptDependencies(
              entry,
              cardBytes,
              entry.generatedScriptDependencies.map((dependency) => ({
                name: dependency.name,
                bytes: readFileSync(join(args.forgeTokenScripts!, dependency.file)),
              })),
              ledger.syntaxInventory,
            );
          }
        }
      } finally {
        rmSync(extraction, { recursive: true, force: true });
      }
      const baselineCount = ledger.auditedCards.filter((entry) => entry.corpus === 'bridge-baseline').length;
      io.out(
        `Forge ${ledger.forge.version}: 600 official and ${String(baselineCount)} bridge-baseline script bytes and classifications match`,
      );
      const generatedCount = ledger.auditedCards.reduce(
        (count, entry) => count + entry.generatedScriptDependencies.length,
        0,
      );
      io.out(
        `Forge ${ledger.forge.version}: ${String(generatedCount)} generated token-script dependencies match`,
      );
    }
    if (args.forgeTokenScripts !== undefined && args.forgeScripts === undefined) {
      throw new Error('--forge-token-scripts requires --forge-scripts to verify the root card graph');
    }
    if (args.controllerJavap !== undefined) {
      verifyForgePlayerControllerSurface(ledger, readFileSync(args.controllerJavap));
      io.out(
        `Forge ${ledger.forge.version}: ${String(ledger.controllerSurface.abstractCallbacks.length)} abstract controller callbacks match`,
      );
    }
    if ((args.chooseEvenOddClass === undefined) !== (args.chooseEvenOddSource === undefined)) {
      throw new Error('--choose-even-odd-class and --choose-even-odd-source are required together');
    }
    if (args.chooseEvenOddClass !== undefined && args.chooseEvenOddSource !== undefined) {
      verifyLegacyCubeExtinctionEventImplementation(
        readFileSync(args.chooseEvenOddClass),
        readFileSync(args.chooseEvenOddSource),
      );
      io.out(
        `Forge ${ledger.forge.version}: ChooseEvenOddEffect class and ${ledger.forge.chooseEvenOddEffect.upstream.revision} source match`,
      );
    }
    if (args.bridgeSource !== undefined) {
      verifyLegacyCubeDecisionBridgeSource(ledger, readFileSync(args.bridgeSource));
      io.out(`Forge bridge source matches ${ledger.bridgeReview.sourceSha256}`);
    }
    return 0;
  } catch (cause) {
    io.error(describeError(cause));
    return 1;
  }
}

if (process.argv[1]?.endsWith('verify-legacy-cube-decisions.ts'))
  process.exitCode = main(process.argv.slice(2));
