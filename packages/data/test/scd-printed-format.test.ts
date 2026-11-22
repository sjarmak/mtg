import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkCommanderDeck,
  parsePrintedCardCatalog,
  parsePrintedConstructedFormat,
  parsePrintedLimitedFormat,
} from '@mtg/printed-card';
import {
  verifiedPrintedFormat,
  verifyPrintedFormatPlayAdmission,
  verifyPrintedLimitedPlayAdmission,
} from '../src/printed-card/play-admission';
import { parseForgeDeckFile } from '../src/printed-card/forge-deck-file';
import { preconDeckId } from '../src/printed-card/precon-recipe';

const dataRoot = new URL('../data/scd/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Starter Commander Decks printed format sources', () => {
  const catalogInput = JSON.parse(readData('scd-printed-catalog-v1.json')) as unknown;
  const catalog = parsePrintedCardCatalog(catalogInput);
  const formatInput = JSON.parse(readData('scd-constructed-format-v1.json')) as unknown;
  const format = parsePrintedConstructedFormat(formatInput);
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    status: string;
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    forgeVersion: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalog, format and source pin to the build evidence', () => {
    expect(format.id).toBe('scd');
    expect(format.rules).toEqual({ variant: 'commander', startingLife: 40 });
    expect(evidence.status).toBe('catalog-only-not-play-admitted');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.forgeVersion).toBe('2.0.14');
    expect(evidence.catalogs).toEqual([
      { code: 'SCD', cards: catalog.cards.length, contentSha256: catalog.contentSha256 },
    ]);
    expect(sha256(readData('scd-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    expect(sha256(readData('onboarding-format-v1.json'))).toBe(evidence.artifactSha256['recipe.json']);
    for (const file of ['scd-printed-catalog-v1.json', 'scd-constructed-format-v1.json']) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(catalog.cards).toHaveLength(352);
    expect(new Set(catalog.cards.map((card) => card.forgeScript)).size).toBe(337);
  });

  it('holds the five precons Forge ships, each one commander over ninety-nine cards', () => {
    expect(format.decks.map((deck) => [deck.id, deck.commanders[0]?.name])).toEqual([
      ['chaos-incarnate', 'Kardur, Doomscourge'],
      ['draconic-destruction', 'Atarka, World Render'],
      ['first-flight', 'Isperia, Supreme Judge'],
      ['grave-danger', 'Gisa and Geralf'],
      ['token-triumph', 'Emmara, Soul of the Accord'],
    ]);
    const printings = new Map(catalog.cards.map((card) => [card.physicalId, card]));
    for (const deck of format.decks) {
      expect(deck.commanders).toHaveLength(1);
      expect(deck.cards.reduce((sum, slot) => sum + slot.count, 0)).toBe(99);
      for (const slot of [...deck.commanders, ...deck.cards]) {
        expect(printings.get(slot.physicalId)?.correctedName).toBe(slot.name);
      }
    }
  });

  it('passes every precon through the Commander deck check, each inside its commander’s colors', () => {
    const printings = new Map(catalog.cards.map((card) => [card.physicalId, card]));
    expect(
      format.decks.map((deck) => {
        const verdict = checkCommanderDeck(deck, printings);
        return [deck.id, verdict.legal, verdict.cards, verdict.colorIdentity.join(''), verdict.findings];
      }),
    ).toEqual([
      ['chaos-incarnate', true, 100, 'BR', []],
      ['draconic-destruction', true, 100, 'RG', []],
      ['first-flight', true, 100, 'WU', []],
      ['grave-danger', true, 100, 'UB', []],
      ['token-triumph', true, 100, 'WG', []],
    ]);
  });

  it('is the format Forge’s own precon files describe, card for card', () => {
    const shipped = JSON.parse(readData('onboarding-format-v1.json')) as {
      decks: readonly {
        id: string;
        commanders: readonly { name: string }[];
        cards: readonly { name: string; count: number }[];
      }[];
    };
    const preconDirectory = fileURLToPath(
      new URL('../../../tools/forge/dist/res/quest/commanderprecons/', import.meta.url),
    );
    const files = readdirSync(preconDirectory)
      .filter((name) => name.endsWith('.dck'))
      .map((name) => parseForgeDeckFile(readFileSync(join(preconDirectory, name), 'utf8')))
      .filter((file) => file.metadata.set?.toUpperCase() === 'SCD');
    expect(files.map((file) => preconDeckId(file.name)).sort()).toEqual(shipped.decks.map((deck) => deck.id));
    for (const deck of shipped.decks) {
      const file = files.find((entry) => preconDeckId(entry.name) === deck.id)!;
      expect(file.commanders.map((entry) => entry.name)).toEqual(deck.commanders.map((entry) => entry.name));
      const counts = new Map<string, number>();
      for (const entry of file.main) counts.set(entry.name, (counts.get(entry.name) ?? 0) + entry.count);
      const built = new Map<string, number>();
      for (const slot of deck.cards) built.set(slot.name, (built.get(slot.name) ?? 0) + slot.count);
      expect(built).toEqual(counts);
    }
  });

  it('is the identity a probe suite binds: the constructed format and its catalog, checksums re-derived', () => {
    const verified = verifiedPrintedFormat(formatInput, [catalogInput]);
    expect(verified.format.kind).toBe('printed-constructed-format');
    expect(verified.format.contentSha256).toBe(format.contentSha256);
    expect(verified.catalogs.map((entry) => entry.contentSha256)).toEqual([catalog.contentSha256]);
    const tampered = { ...(formatInput as Record<string, unknown>), name: 'Not the shipped decks' };
    expect(() => verifiedPrintedFormat(tampered, [catalogInput])).toThrow(/format checksum mismatch/u);
    expect(() => verifiedPrintedFormat(formatInput, [])).toThrow(/exactly the recipe source catalogs/u);
  });

  it('re-verifies the installed play admission against the shipped decks and their catalog', () => {
    const root = fileURLToPath(new URL('play-admission-v33/', dataRoot)).replace(/[\\/]$/u, '');
    const readEvidence = (relativePath: string) => {
      const path = resolve(root, relativePath);
      if (!path.startsWith(`${root}${sep}`))
        throw new Error(`Evidence path escapes admission: ${relativePath}`);
      return readFileSync(path);
    };
    const provenance = JSON.parse(readEvidence('provenance.json').toString('utf8')) as {
      subject: Record<string, unknown>;
    };
    const { formatId, formatSha256, catalogs, ...runtime } = provenance.subject;
    expect(formatId).toBe(format.id);
    expect(formatSha256).toBe(format.contentSha256);
    expect(catalogs).toEqual({ SCD: catalog.contentSha256 });
    const admissionBody = readEvidence('admission.json').toString('utf8');
    const verdict = verifyPrintedFormatPlayAdmission(
      admissionBody,
      formatInput,
      [catalogInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
    const admission = JSON.parse(admissionBody) as {
      cards: readonly unknown[];
      matchProbeIds: readonly string[];
    };
    expect(admission.cards).toHaveLength(catalog.cards.length);
    expect(admission.matchProbeIds).toHaveLength(4);
    expect(() => parsePrintedLimitedFormat(formatInput)).toThrow();
    expect(() =>
      verifyPrintedLimitedPlayAdmission(admissionBody, formatInput, [catalogInput], runtime, readEvidence),
    ).toThrow();
  }, 180_000);
});
