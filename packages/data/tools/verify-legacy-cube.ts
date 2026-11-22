/** Deterministic verifier for the pinned official 2021 MTGO Legacy Cube. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  LEGACY_CUBE_PROVENANCE_PATH,
  closeStore,
  describeError,
  loadLegacyCubeProvenance,
  openStore,
  verifyForgeCubeSnapshot,
  verifyForgeScriptEntries,
  verifyLegacyCubeProvenance,
  verifyLegacyCubeSnapshot,
  verifyLegacyCubeStore,
  type ForgeScriptEntry,
} from '@mtg/data';

interface Io {
  readonly out: (line: string) => void;
  readonly error: (line: string) => void;
}

const STDIO: Io = {
  out: (line) => console.log(line),
  error: (line) => console.error(line),
};

interface Args {
  readonly artifact: string;
  readonly snapshot?: string;
  readonly fetch: boolean;
  readonly store?: string;
  readonly storeBulk?: string;
  readonly forgeScripts?: string;
  readonly forgeCube?: string;
}

const USAGE = `verify-legacy-cube [options]

Checks the committed, schema-validated artifact by default. Untracked and
network inputs are opt-in so the flagless gate is a function of tracked state.

  --artifact PATH       provenance JSON (default: committed v1 artifact)
  --snapshot PATH       verify supplied raw MTGO HTML bytes
  --fetch               explicitly fetch and verify the official URL
  --store PATH          verify the pinned SQLite store and all 600 identities
  --store-bulk PATH     verify the pinned Scryfall bulk-file checksum
  --forge-scripts PATH  verify the pinned cardsfolder.zip and all 600 scripts
  --forge-cube PATH     verify the bundled 2021-08 .dck contradictions
  --help                 print this text`;

function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a path`);
  return value;
}

function parseArgs(argv: readonly string[]): Args {
  let artifact = LEGACY_CUBE_PROVENANCE_PATH;
  let snapshot: string | undefined;
  let fetch = false;
  let store: string | undefined;
  let storeBulk: string | undefined;
  let forgeScripts: string | undefined;
  let forgeCube: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case '--artifact':
        artifact = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--snapshot':
        snapshot = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--fetch':
        fetch = true;
        break;
      case '--store':
        store = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--store-bulk':
        storeBulk = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--forge-scripts':
        forgeScripts = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--forge-cube':
        forgeCube = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--help':
        throw new HelpRequested();
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  if (snapshot !== undefined && fetch) throw new Error('--snapshot and --fetch are mutually exclusive');
  return {
    artifact,
    fetch,
    ...(snapshot === undefined ? {} : { snapshot }),
    ...(store === undefined ? {} : { store }),
    ...(storeBulk === undefined ? {} : { storeBulk }),
    ...(forgeScripts === undefined ? {} : { forgeScripts }),
    ...(forgeCube === undefined ? {} : { forgeCube }),
  };
}

class HelpRequested extends Error {}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function filesUnder(root: string): readonly string[] {
  const paths: string[] = [];
  const visit = (directory: string): void => {
    const entries: Dirent[] = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else paths.push(path);
    }
  };
  visit(root);
  return paths;
}

function readForgeScriptArchive(path: string): {
  readonly files: number;
  readonly entries: readonly ForgeScriptEntry[];
} {
  const extraction = mkdtempSync(join(tmpdir(), 'mtg-legacy-forge-scripts-'));
  try {
    const result = spawnSync('unzip', ['-qq', path, '-d', extraction], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error !== undefined || result.status !== 0) {
      const processDetail = result.stderr.trim() || `exit ${String(result.status)}`;
      throw new Error(`unzip failed for ${path}: ${result.error?.message ?? processDetail}`);
    }
    const scripts = filesUnder(extraction).filter((candidate) => candidate.endsWith('.txt'));
    const entries: ForgeScriptEntry[] = [];
    for (const script of scripts) {
      const name = readFileSync(script, 'utf8')
        .match(/^Name:(.+)$/m)?.[1]
        ?.trim();
      if (name !== undefined) {
        entries.push({ name, path: relative(extraction, script).split(sep).join('/') });
      }
    }
    return { files: scripts.length, entries };
  } finally {
    rmSync(extraction, { recursive: true, force: true });
  }
}

async function explicitlyFetch(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html',
      'user-agent': 'mtg-lab/0.1 Legacy Cube provenance verifier (non-commercial research)',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function main(argv: readonly string[], io: Io = STDIO): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof HelpRequested) {
      io.out(USAGE);
      return 0;
    }
    io.error(describeError(error));
    io.error(USAGE);
    return 2;
  }

  try {
    const artifact = loadLegacyCubeProvenance(args.artifact);
    verifyLegacyCubeProvenance(artifact);
    io.out(
      `tracked artifact: ${String(artifact.sourceRows.length)} Full Cardlist rows, ` +
        `raw ${artifact.source.rawSha256}, normalized ${artifact.normalization.sha256}`,
    );

    if (args.snapshot !== undefined || args.fetch) {
      const snapshot =
        args.snapshot === undefined
          ? await explicitlyFetch(artifact.source.url)
          : readFileSync(args.snapshot);
      verifyLegacyCubeSnapshot(artifact, snapshot);
      io.out(`official page snapshot: ${String(snapshot.byteLength)} bytes match`);
    }

    if (args.storeBulk !== undefined) {
      if (basename(args.storeBulk) !== artifact.store.bulkFile) {
        throw new Error(`store bulk filename drift: expected ${artifact.store.bulkFile}`);
      }
      const hash = sha256File(args.storeBulk);
      if (hash !== artifact.store.bulkSha256) {
        throw new Error(`store bulk checksum drift: expected ${artifact.store.bulkSha256}, got ${hash}`);
      }
      io.out(`store bulk: ${artifact.store.bulkFile} matches ${hash}`);
    }

    if (args.store !== undefined) {
      const store = openStore(args.store, { readonly: true });
      try {
        verifyLegacyCubeStore(artifact, store);
      } finally {
        closeStore(store);
      }
      io.out(`card store: all ${String(artifact.identities.length)} corrected identities resolve uniquely`);
    }

    if (args.forgeScripts !== undefined) {
      const hash = sha256File(args.forgeScripts);
      if (hash !== artifact.forge.cardScriptArchiveSha256) {
        throw new Error(
          `Forge card-script archive checksum drift: expected ${artifact.forge.cardScriptArchiveSha256}, got ${hash}`,
        );
      }
      const archive = readForgeScriptArchive(args.forgeScripts);
      if (archive.files !== artifact.forge.cardScriptFiles) {
        throw new Error(
          `Forge card-script file-count drift: expected ${String(artifact.forge.cardScriptFiles)}, ` +
            `got ${String(archive.files)}`,
        );
      }
      verifyForgeScriptEntries(artifact, archive.entries);
      io.out(
        `Forge ${artifact.forge.version}: all ${String(artifact.identities.length)} corrected identities own one script`,
      );
    }

    if (args.forgeCube !== undefined) {
      verifyForgeCubeSnapshot(artifact, readFileSync(args.forgeCube));
      io.out('Forge bundled cube: exactly the three recorded membership contradictions');
    }

    if (
      args.snapshot === undefined &&
      !args.fetch &&
      args.store === undefined &&
      args.storeBulk === undefined &&
      args.forgeScripts === undefined &&
      args.forgeCube === undefined
    ) {
      io.out(
        'optional external inputs were not checked; pass --help for explicit snapshot/store/Forge flags',
      );
    }
    return 0;
  } catch (error) {
    io.error(describeError(error));
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
