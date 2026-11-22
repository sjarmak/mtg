import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PrintedPlayAdmissionSchema,
  parsePrintedCardCatalog,
  validatePrintedDisplayMetadata,
} from '@mtg/printed-card';
import {
  installedPrintedAdmissions,
  loadPrintedAdmissionSource,
  parsePrintedFormatRegistry,
  stageableFormats,
} from '../../tools/printed-format-registry';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const registry = {
  schemaVersion: 1,
  formats: [
    {
      id: 'akh-hou',
      formatFile: 'akh-hou-limited-format-v1.json',
      displayMetadataFile: 'akh-hou-display-metadata-v1.json',
      availability: {
        browse: 'available',
        draft: 'available',
        sealed: 'available',
        play: { status: 'supported', reason: 'Verified Forge admission is installed.' },
      },
      admissionDirectory: 'play-admission-v1',
      catalogs: [{ code: 'AKH', name: 'Amonkhet', file: 'akh-printed-catalog-v1.json' }],
    },
  ],
};

describe('printed format launcher registry', () => {
  it('turns checked data rows into staging sources rooted in the repository data directory', () => {
    expect(parsePrintedFormatRegistry('/repo', registry)).toEqual([
      {
        ...registry.formats[0],
        directory: resolve('/repo/packages/data/data/akh-hou'),
        admissionDirectory: resolve('/repo/packages/data/data/akh-hou/play-admission-v1'),
      },
    ]);
  });

  it('rejects duplicate formats, unsafe filenames, and unsupported capability labels', () => {
    expect(() =>
      parsePrintedFormatRegistry('/repo', {
        ...registry,
        formats: [registry.formats[0], registry.formats[0]],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      parsePrintedFormatRegistry('/repo', {
        ...registry,
        formats: [{ ...registry.formats[0], formatFile: '../outside.json' }],
      }),
    ).toThrow();
    expect(() =>
      parsePrintedFormatRegistry('/repo', {
        ...registry,
        formats: [{ ...registry.formats[0], admissionDirectory: undefined }],
      }),
    ).toThrow(/supported play requires admission/i);
    expect(() =>
      parsePrintedFormatRegistry('/repo', {
        ...registry,
        formats: [
          {
            ...registry.formats[0],
            availability: {
              ...registry.formats[0]!.availability,
              play: { status: 'ready', reason: 'ambiguous' },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it('loads the installed supported format and its complete admission evidence', () => {
    const installedRegistry = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/data/data/printed-formats-v1.json'), 'utf8'),
    ) as unknown;
    const [source] = parsePrintedFormatRegistry(REPO_ROOT, installedRegistry);
    expect(source?.availability.play.status).toBe('supported');
    if (source === undefined) throw new Error('AKH/HOU is absent from the installed registry');
    const installed = loadPrintedAdmissionSource(source);
    if (installed === undefined) throw new Error('AKH/HOU admission evidence is absent');
    const admission = PrintedPlayAdmissionSchema.parse(JSON.parse(installed.evidence.body));
    expect((installed.format as { id?: unknown }).id).toBe('akh-hou');
    expect(admission.subject.formatId).toBe('akh-hou');
    expect(admission.cards).toHaveLength(550);
    expect(admission.probes).toHaveLength(1022);
    expect(admission.matchProbeIds).toHaveLength(4);
    expect(installed.evidence.read(admission.probes[0]!.evidence!.path).byteLength).toBeGreaterThan(0);
  });

  it('registers the Commander precon format as browsable and playable through its installed admission', () => {
    const installedRegistry = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/data/data/printed-formats-v1.json'), 'utf8'),
    ) as unknown;
    const source = parsePrintedFormatRegistry(REPO_ROOT, installedRegistry).find(
      (entry) => entry.formatFile === 'scd-constructed-format-v1.json',
    );
    if (source === undefined) throw new Error('SCD is absent from the installed registry');
    expect(source.availability).toEqual({
      browse: 'available',
      draft: 'unavailable',
      sealed: 'unavailable',
      play: { status: 'supported', reason: expect.stringMatching(/command-zone contracts are witnessed/) },
    });
    expect(source.admissionDirectory).toBe(resolve(REPO_ROOT, 'packages/data/data/scd/play-admission-v33'));
    const installed = loadPrintedAdmissionSource(source);
    if (installed === undefined) throw new Error('SCD admission is not installed');
    const admission = PrintedPlayAdmissionSchema.parse(JSON.parse(installed.evidence.body));
    expect(admission.subject.formatId).toBe('scd');
    expect(admission.cards).toHaveLength(352);
    expect(admission.probes).toHaveLength(678);
    expect(admission.matchProbeIds).toHaveLength(4);
    expect(source.catalogs).toEqual([
      { code: 'SCD', name: 'Starter Commander Decks 2022', file: 'scd-printed-catalog-v1.json' },
    ]);
    expect(source.directory).toBe(resolve(REPO_ROOT, 'packages/data/data/scd'));
  });

  it('registers Momir Basic with its global creature pool and oldest-printing presentation catalog', () => {
    const installedRegistry = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/data/data/printed-formats-v1.json'), 'utf8'),
    ) as unknown;
    const source = parsePrintedFormatRegistry(REPO_ROOT, installedRegistry).find(
      (entry) => entry.formatFile === 'momir-basic-constructed-format-v1.json',
    );
    if (source === undefined) throw new Error('Momir Basic is absent from the installed registry');
    expect(source.availability).toEqual({
      browse: 'available',
      draft: 'unavailable',
      sealed: 'unavailable',
      play: { status: 'supported', reason: expect.stringMatching(/global creature pool/) },
    });
    expect(source.presentationCatalog).toBe('momir-oldest-creatures');
    expect(source.admissionDirectory).toBe(
      resolve(REPO_ROOT, 'packages/data/data/momir-basic/play-admission-v14'),
    );
    const installed = loadPrintedAdmissionSource(source);
    if (installed === undefined) throw new Error('Momir Basic admission is not installed');
    const admission = PrintedPlayAdmissionSchema.parse(JSON.parse(installed.evidence.body));
    expect(admission.subject.formatId).toBe('momir-basic');
    expect(admission.generatedObjectPolicy).toBe('forge-momir-global-creatures');
    expect(admission.cards).toHaveLength(249);
    expect(admission.matchProbeIds).toEqual(['momir-match-engine-v1', 'momir-match-local-v1']);
  });

  it('carries each installed format’s token printings file through to its staging source', () => {
    const installedRegistry = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/data/data/printed-formats-v1.json'), 'utf8'),
    ) as unknown;
    const sources = parsePrintedFormatRegistry(REPO_ROOT, installedRegistry);
    expect(sources.map((source) => source.tokenPrintingsFile)).toEqual([
      'akh-hou-token-printings-v1.json',
      'isd-token-printings-v1.json',
      'scd-token-printings-v1.json',
      'som-token-printings-v1.json',
      'mbs-token-printings-v1.json',
      'roe-token-printings-v1.json',
      'm12-token-printings-v1.json',
      'dka-token-printings-v1.json',
      'avr-token-printings-v1.json',
      'gtc-token-printings-v1.json',
      'nph-token-printings-v1.json',
      'm15-token-printings-v1.json',
      'm14-token-printings-v1.json',
      'ths-token-printings-v1.json',
      'bng-token-printings-v1.json',
      'jou-token-printings-v1.json',
      'dgm-token-printings-v1.json',
      'ktk-token-printings-v1.json',
      'ori-token-printings-v1.json',
      'xln-token-printings-v1.json',
      'kld-aer-token-printings-v1.json',
      'rtr-token-printings-v1.json',
      'm11-token-printings-v1.json',
      'm13-token-printings-v1.json',
      undefined,
      'm10-token-printings-v1.json',
      'zen-token-printings-v1.json',
      'wwk-token-printings-v1.json',
      'rav-token-printings-v1.json',
      'gpt-token-printings-v1.json',
      'lrw-token-printings-v1.json',
      'dis-token-printings-v1.json',
      'commander-precons-token-printings-v1.json',
    ]);
    expect(() =>
      parsePrintedFormatRegistry('/repo', {
        ...registry,
        formats: [{ ...registry.formats[0], tokenPrintingsFile: '../outside.json' }],
      }),
    ).toThrow();
  });

  it('registers Guildpact as GPT-RAV-RAV without replacing standalone Ravnica', () => {
    const installedRegistry = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/data/data/printed-formats-v1.json'), 'utf8'),
    ) as unknown;
    const sources = parsePrintedFormatRegistry(REPO_ROOT, installedRegistry);
    const guildpact = sources.find((entry) => entry.formatFile === 'gpt-limited-format-v1.json');
    const ravnica = sources.find((entry) => entry.directory === resolve(REPO_ROOT, 'packages/data/data/rav'));
    if (guildpact === undefined) throw new Error('GPT is absent from the installed registry');
    if (ravnica === undefined) throw new Error('RAV is absent from the installed registry');
    expect(guildpact.catalogs.map((catalog) => catalog.code)).toEqual(['GPT', 'RAV']);
    expect(guildpact.admissionDirectory).toBe(
      resolve(REPO_ROOT, 'packages/data/data/gpt/play-admission-v10'),
    );
    expect(ravnica.catalogs.map((catalog) => catalog.code)).toEqual(['RAV']);
    expect(ravnica.admissionDirectory).toBe(resolve(REPO_ROOT, 'packages/data/data/rav/play-admission-v15'));
  });

  it('registers Dissension as DIS-GPT-RAV with its own admission', () => {
    const installedRegistry = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/data/data/printed-formats-v1.json'), 'utf8'),
    ) as unknown;
    const sources = parsePrintedFormatRegistry(REPO_ROOT, installedRegistry);
    const dissension = sources.find((entry) => entry.formatFile === 'dis-limited-format-v1.json');
    if (dissension === undefined) throw new Error('DIS is absent from the installed registry');
    expect(dissension.catalogs.map((catalog) => catalog.code)).toEqual(['DIS', 'GPT', 'RAV']);
    expect(dissension.admissionDirectory).toBe(
      resolve(REPO_ROOT, 'packages/data/data/dis/play-admission-v8'),
    );
  });

  it('loads every installed admission for both launchers, the Commander precons included', () => {
    const { formats, admissions } = installedPrintedAdmissions(REPO_ROOT);
    const installed = formats.filter((format) => format.admissionDirectory !== undefined);
    expect(admissions).toHaveLength(installed.length);
    const subjects = admissions.map(
      (admission) => PrintedPlayAdmissionSchema.parse(JSON.parse(admission.evidence.body)).subject.formatId,
    );
    expect(subjects).toContain('scd');
  });

  it('validates every installed format’s display metadata against that format’s own catalogs', () => {
    // A block set stages its own copy of a block-mate's catalog, identical card
    // for card but carrying its own provenance, so the copy's `contentSha256`
    // differs from the block-mate's. Dragon's Maze landed with display metadata
    // built against Gatecrash's copies of the GTC and RTR catalogs rather than
    // its own, and `npm run play` refused to start for EVERY format with
    // "Display metadata source mismatch: gtc-printed-v1". The launcher was the
    // only thing checking this, so the failure surfaced after the merge.
    const installedRegistry = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/data/data/printed-formats-v1.json'), 'utf8'),
    ) as unknown;
    const checked: string[] = [];
    for (const source of parsePrintedFormatRegistry(REPO_ROOT, installedRegistry)) {
      const displayMetadataFile = source.displayMetadataFile;
      if (displayMetadataFile === undefined) continue;
      const catalogs = source.catalogs.map((catalog) =>
        parsePrintedCardCatalog(JSON.parse(readFileSync(join(source.directory, catalog.file), 'utf8'))),
      );
      const metadata = JSON.parse(
        readFileSync(join(source.directory, displayMetadataFile), 'utf8'),
      ) as unknown;
      expect(() => validatePrintedDisplayMetadata(metadata, catalogs)).not.toThrow();
      checked.push(basename(source.directory));
    }
    // A format may carry no display metadata, so the loop can skip; a run that
    // skipped every format would pass while checking nothing.
    expect(checked).toContain('dgm');
  });

  it('starts the standalone gateway with those admissions rather than none', () => {
    // `npm run backend` once routed only the Legacy Cube: it never read the
    // registry, so a page attached to it was refused every printed format the
    // page's own staged files said was installed.
    const tool = readFileSync(resolve(REPO_ROOT, 'packages', 'ui', 'tools', 'backend.ts'), 'utf8');
    expect(tool).toContain('printedAdmissions: installedPrintedAdmissions(repoRoot).admissions');
  });
});

/**
 * A fresh clone has no card store, and `npm run play` built Momir Basic's
 * presentation catalog from it unconditionally, so the launcher died before
 * Vite started on every checkout but the one that ingested the store.
 */
describe('formats a checkout without the card store can stage', () => {
  const installed = installedPrintedAdmissions(REPO_ROOT).formats;

  it('leaves out exactly the formats whose catalog the store builds', () => {
    const { kept, skipped } = stageableFormats(installed, false);
    expect(skipped).toContain('momir-basic');
    expect(kept.some((format) => format.presentationCatalog !== undefined)).toBe(false);
    expect(kept.length + skipped.length).toBe(installed.length);
    expect(kept.map((format) => format.id)).toContain('m11');
  });

  it('keeps every format when the store is present', () => {
    expect(stageableFormats(installed, true)).toEqual({ kept: installed, skipped: [] });
  });
});
