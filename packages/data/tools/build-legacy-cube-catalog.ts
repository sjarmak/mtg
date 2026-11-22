/** Emit the official Legacy Cube's portable printed-card catalog. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';
import {
  LEGACY_CUBE_PROVENANCE_PATH,
  ScryfallCardSchema,
  buildLegacyCubePrintedCatalog,
  closeStore,
  getCardByOracleId,
  loadLegacyCubeProvenance,
  openStore,
  verifyLegacyCubeStore,
} from '@mtg/data';

interface Args {
  readonly provenance: string;
  readonly store: string;
  readonly forgeScripts: string;
  readonly out: string;
}

const USAGE = `build-legacy-cube-catalog

  --store PATH          pinned SQLite store
  --forge-scripts PATH  pinned cardsfolder.zip
  --out PATH            explicit output JSON
  --provenance PATH     provenance artifact (default: committed v1)
  --help                 show this text`;

function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a path`);
  return value;
}

function parseArgs(argv: readonly string[]): Args {
  let provenance = LEGACY_CUBE_PROVENANCE_PATH;
  let store: string | undefined;
  let forgeScripts: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case '--provenance':
        provenance = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--store':
        store = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--forge-scripts':
        forgeScripts = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--out':
        out = valueAfter(argv, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  if (store === undefined || forgeScripts === undefined || out === undefined) {
    throw new Error('--store, --forge-scripts, and --out are required');
  }
  return { provenance, store, forgeScripts, out };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function extractScripts(archive: string): { readonly root: string; readonly remove: () => void } {
  if (!statSync(archive).isFile()) throw new Error('--forge-scripts must name cardsfolder.zip');
  const root = mkdtempSync(join(tmpdir(), 'mtg-legacy-cube-scripts-'));
  const extracted = spawnSync('unzip', ['-q', archive, '-d', root], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (extracted.status !== 0) {
    rmSync(root, { force: true, recursive: true });
    throw new Error(`unzip failed: ${extracted.stderr.trim() || extracted.stdout.trim()}`);
  }
  return {
    root,
    remove: () => {
      rmSync(root, { force: true, recursive: true });
    },
  };
}

export async function main(argv: readonly string[]): Promise<void> {
  if (argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(argv);
  const provenance = loadLegacyCubeProvenance(args.provenance);
  const archive = readFileSync(args.forgeScripts);
  const archiveHash = sha256(archive);
  if (archiveHash !== provenance.forge.cardScriptArchiveSha256) {
    throw new Error(
      `Forge archive checksum drift: expected ${provenance.forge.cardScriptArchiveSha256}, got ${archiveHash}`,
    );
  }

  const store = openStore(args.store, { readonly: true });
  const scripts = extractScripts(args.forgeScripts);
  try {
    verifyLegacyCubeStore(provenance, store);
    const catalog = buildLegacyCubePrintedCatalog(provenance, {
      resolveCard: (oracleId) => {
        const row = getCardByOracleId(store, oracleId);
        if (row === null) return null;
        return ScryfallCardSchema.parse(JSON.parse(row.rawJson) as unknown);
      },
      readForgeScript: (path) => {
        try {
          return readFileSync(join(scripts.root, path));
        } catch {
          return null;
        }
      },
    });
    const bytes = await format(JSON.stringify(catalog), {
      ...(await resolveConfig(process.cwd())),
      filepath: args.out,
    });
    writeFileSync(args.out, bytes, 'utf8');
    console.log(
      `wrote ${String(catalog.cards.length)} physical cards to ${args.out}; content ${catalog.contentSha256}; artifact ${sha256(new TextEncoder().encode(bytes))}`,
    );
  } finally {
    scripts.remove();
    closeStore(store);
  }
}

if (process.argv[1]?.endsWith('build-legacy-cube-catalog.ts')) {
  try {
    await main(process.argv.slice(2));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  }
}
