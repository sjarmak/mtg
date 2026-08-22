import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeStore,
  ingestBulkFile,
  openStore,
  saveVocabularyFiles,
  setMeta,
  CardTypesFileSchema,
  EnumValuesFileSchema,
  KeywordsFileSchema,
} from '@mtg/data';
import { main } from '../src/cli';
import { InvalidInputError, describeError, errorPayload } from '../src/errors';
import { flagInteger, parseArgs } from '../src/cli/args';
import {
  FIXTURES,
  ORACLE_IDS,
  ORACLE_UPDATED_AT,
  RULINGS_UPDATED_AT,
  descriptorFor,
  readFixtureJson,
} from './helpers';

describe('cli argument parsing', () => {
  const spec = { valued: ['db', 'limit'], boolean: ['json', 'force'], repeated: ['kind'] } as const;

  it('parses flags, repeats and positionals', () => {
    const args = parseArgs(
      ['Lightning Bolt', '--kind', 'oracle_cards', '--kind=rulings', '--limit', '5', '--force'],
      spec,
    );
    expect(args.positionals).toEqual(['Lightning Bolt']);
    expect(args.repeated['kind']).toEqual(['oracle_cards', 'rulings']);
    expect(flagInteger(args, 'limit')).toBe(5);
    expect(args.flags['force']).toBe(true);
  });

  it('refuses unknown flags and missing values instead of ignoring them', () => {
    expect(() => parseArgs(['--nonsense', 'x'], spec)).toThrow(InvalidInputError);
    expect(() => parseArgs(['--limit'], spec)).toThrow(InvalidInputError);
    expect(() => parseArgs(['--limit', '--force'], spec)).toThrow(InvalidInputError);
    expect(() => parseArgs(['--json=yes'], spec)).toThrow(InvalidInputError);
    expect(() => flagInteger(parseArgs(['--limit', 'zero'], spec), 'limit')).toThrow(InvalidInputError);
  });
});

describe('cli commands', () => {
  let dbPath: string;
  let directory: string;
  let out: string[];
  let errors: string[];

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'mtg-data-cli-'));
    dbPath = join(directory, 'mtg.sqlite');
    out = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => out.push(parts.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => errors.push(parts.join(' ')));

    const store = openStore(dbPath, { now: () => '2026-08-09T12:00:00.000Z' });
    await ingestBulkFile(store, descriptorFor('oracle_cards', ORACLE_UPDATED_AT), FIXTURES.oracleCards);
    await ingestBulkFile(store, descriptorFor('rulings', RULINGS_UPDATED_AT), FIXTURES.rulings);
    saveVocabularyFiles(store, {
      cardTypes: CardTypesFileSchema.parse(readFixtureJson(FIXTURES.cardTypes)),
      keywords: KeywordsFileSchema.parse(readFixtureJson(FIXTURES.keywords)),
      enumValues: EnumValuesFileSchema.parse(readFixtureJson(FIXTURES.enumValues)),
    });
    closeStore(store);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('prints usage with no command', async () => {
    expect(await main([])).toBe(0);
    expect(out.join('\n')).toContain('mtg-data');
  });

  it('reports statistics and the attribution envelope', async () => {
    expect(await main(['stats', '--db', dbPath])).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('oracle cards : 6');
    expect(text).toContain('rulings      : 13');
    expect(text).toContain('Fan Content Policy');
  });

  it('finds cards, shows details and lists rulings', async () => {
    expect(await main(['find', 'bolt', '--db', dbPath])).toBe(0);
    expect(out.join('\n')).toContain('Lightning Bolt');

    out.length = 0;
    expect(await main(['card', ORACLE_IDS.fireIce, '--db', dbPath])).toBe(0);
    expect(out.join('\n')).toContain('Fire // Ice');
    expect(out.join('\n')).toContain('DMR');

    out.length = 0;
    expect(await main(['rulings', ORACLE_IDS.fireIce, '--db', dbPath])).toBe(0);
    expect(out.join('\n').split('\n').length).toBeGreaterThan(1);
  });

  it('shows a card by name, not just by oracle id', async () => {
    expect(await main(['card', 'Lightning Bolt', '--db', dbPath])).toBe(0);
    expect(out.join('\n')).toContain(`oracle_id=${ORACLE_IDS.lightningBolt}`);

    out.length = 0;
    expect(await main(['card', 'grizzly', '--db', dbPath])).toBe(0);
    expect(out.join('\n')).toContain('Grizzly Bears');

    out.length = 0;
    expect(await main(['rulings', 'Fire // Ice', '--db', dbPath])).toBe(0);
    expect(out).toHaveLength(7);

    // Rulings ingest independently of cards: this oracle id has no card row.
    out.length = 0;
    expect(await main(['rulings', ORACLE_IDS.tarmogoyf, '--db', dbPath])).toBe(0);
    expect(out).toHaveLength(5);
  });

  it('names the disambiguating command when a reference matches several cards', async () => {
    expect(await main(['card', 'of', '--db', dbPath])).toBe(1);
    const text = errors.join('\n');
    expect(text).toContain('matches 2 cards');
    expect(text).toContain(ORACLE_IDS.wrathOfGod);
    expect(text).toContain(ORACLE_IDS.delver);
    expect(text).toContain('find');
  });

  it('fails with a usable message when nothing matches', async () => {
    expect(await main(['card', 'Jace, Wielder of Nonsense', '--db', dbPath])).toBe(1);
    expect(errors.join('\n')).toContain('no card matches "Jace, Wielder of Nonsense"');
    expect(errors.join('\n')).toContain('find');
  });

  it('queries by set and by color identity', async () => {
    expect(await main(['set', 'cmm', '--db', dbPath])).toBe(0);
    expect(out.join('\n')).toContain('Wrath of God');

    out.length = 0;
    expect(await main(['colors', 'UR', '--mode', 'subset', '--db', dbPath])).toBe(0);
    expect(out.join('\n')).toContain('Fire // Ice');
    expect(out.join('\n')).not.toContain('Wrath of God');
  });

  it('emits JSON when asked', async () => {
    expect(await main(['find', 'Grizzly Bears', '--exact', '--json', '--db', dbPath])).toBe(0);
    const parsed = JSON.parse(out.join('\n')) as Array<{ name: string; oracleId: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.oracleId).toBe(ORACLE_IDS.grizzlyBears);
  });

  it('lists records refused at the boundary', async () => {
    expect(await main(['rejects', '--kind', 'oracle_cards', '--db', dbPath])).toBe(0);
    expect(out.join('\n')).toContain('line 7');
  });

  it('cross-checks keywords against the stored MTGJSON vocabulary', async () => {
    expect(await main(['check-vocab', 'flying', 'firstStrike', 'menace', '--db', dbPath])).toBe(0);
    expect(out.join('\n')).toContain('3/3 recognized');

    out.length = 0;
    expect(await main(['check-vocab', 'wibble', '--db', dbPath])).toBe(0);
    expect(out.join('\n')).toContain('unknown: wibble');
  });

  it('exits non-zero on unknown commands and bad arguments', async () => {
    expect(await main(['frobnicate'])).toBe(2);
    expect(errors.join('\n')).toContain('unknown command');

    errors.length = 0;
    expect(await main(['colors', 'WU', '--mode', 'sideways', '--db', dbPath])).toBe(1);
    expect(errors.join('\n')).toContain('--mode must be');

    errors.length = 0;
    expect(await main(['find', '--db', dbPath])).toBe(1);
    expect(errors.join('\n')).toContain('missing required card name');
  });

  describe('--json failures', () => {
    /** The one document a failing `--json` run is contracted to leave on stdout. */
    function envelope(): { name: string; message: string } {
      const parsed: unknown = JSON.parse(out.join('\n'));
      if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) {
        throw new Error(`stdout is not an error envelope: ${out.join('\n')}`);
      }
      return (parsed as { error: { name: string; message: string } }).error;
    }

    it('reports an unresolved card reference as an envelope, not as bare stderr text', async () => {
      expect(await main(['card', 'Jace, Wielder of Nonsense', '--json', '--db', dbPath])).toBe(1);
      expect(envelope().name).toBe('InvalidInputError');
      expect(envelope().message).toContain('no card matches');
    });

    it('reports an ambiguous reference with the candidate ids inside the envelope', async () => {
      expect(await main(['card', 'of', '--json', '--db', dbPath])).toBe(1);
      expect(envelope().message).toContain('matches 2 cards');
      expect(envelope().message).toContain(ORACLE_IDS.wrathOfGod);
    });

    it('covers every failure layer, not just the unresolved reference', async () => {
      const cases: ReadonlyArray<readonly [readonly string[], string]> = [
        // Argument layer, thrown out of cli/args.ts before any command runs.
        [['find', 'bolt', '--nonsense', 'x'], 'unknown flag --nonsense'],
        [['find', '--limit', '0', 'bolt'], '--limit must be a positive integer'],
        [['find'], 'missing required card name'],
        // Command validation.
        [['colors', 'WU', '--mode', 'sideways'], '--mode must be'],
        [['check-vocab'], 'at least one keyword'],
        // Reference resolution on the other command that resolves one.
        [['rulings', 'Jace, Wielder of Nonsense'], 'no card matches'],
      ];
      for (const [argv, expected] of cases) {
        out.length = 0;
        expect(await main([...argv, '--json', '--db', dbPath])).toBe(1);
        expect(envelope().message).toContain(expected);
      }
    });

    it('names the store-boundary error class so a caller can branch on the cause', async () => {
      const store = openStore(dbPath);
      setMeta(store, 'schema_version', '999');
      closeStore(store);

      expect(await main(['stats', '--json', '--db', dbPath])).toBe(1);
      expect(envelope().name).toBe('SchemaVersionError');
      expect(envelope().message).toContain('schema version 999');
    });

    it('keeps the unknown-command exit code at 2 while still emitting an envelope', async () => {
      expect(await main(['frobnicate', '--json'])).toBe(2);
      expect(envelope().message).toContain('unknown command "frobnicate"');
      // The usage block belongs on stderr, not inside a machine-readable message.
      expect(envelope().message).not.toContain('Global flags');
      expect(errors.join('\n')).toContain('Global flags');
    });

    it('adds the stdout channel without taking the stderr one away', async () => {
      expect(await main(['card', 'nope', '--json', '--db', dbPath])).toBe(1);
      expect(errors.join('\n')).toContain('no card matches');

      // …and without --json stdout stays empty, as it was before.
      out.length = 0;
      errors.length = 0;
      expect(await main(['card', 'nope', '--db', dbPath])).toBe(1);
      expect(out).toEqual([]);
      expect(errors.join('\n')).toContain('no card matches');
    });

    it('leaves a successful --json run carrying its result, not an envelope', async () => {
      expect(await main(['find', 'Grizzly Bears', '--exact', '--json', '--db', dbPath])).toBe(0);
      const parsed: unknown = JSON.parse(out.join('\n'));
      expect(Array.isArray(parsed)).toBe(true);
      expect(errors).toEqual([]);
    });
  });
});

/**
 * `errorPayload` runs inside the CLI's last catch. A throw there costs both
 * guarantees `--json` documents at once — the envelope on stdout and the human
 * line on stderr — and surfaces a stack trace in place of the contract. So it
 * has to survive every thrown value, not just the ones a dependency is likely
 * to produce.
 */
describe('reducing a thrown value that is not an Error', () => {
  it('renders a plain object as its contents rather than [object Object]', () => {
    expect(errorPayload({ code: 'ENOENT' })).toEqual({
      name: 'NonError',
      message: '{"code":"ENOENT"}',
    });
  });

  it('keeps undefined visible, which JSON.stringify alone drops', () => {
    expect(describeError(undefined)).toBe('NonError: undefined');
  });

  it('survives a BigInt, which JSON.stringify throws on', () => {
    expect(errorPayload(7n)).toEqual({ name: 'NonError', message: '7' });
  });

  it('survives a circular structure, which JSON.stringify throws on', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(errorPayload(circular).message).toBe('[object Object]');
  });

  it('survives a value that neither JSON.stringify nor String can render', () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    hostile['self'] = hostile;
    expect(errorPayload(hostile)).toEqual({
      name: 'NonError',
      message: '<unrenderable object>',
    });
  });
});
