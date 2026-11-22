import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkStandardDeck,
  parsePrintedCardCatalog,
  parsePrintedConstructedFormat,
  parsePrintedLimitedFormat,
} from '@mtg/printed-card';
import { describe, expect, it } from 'vitest';
import { verifyPrintedLimitedPlayAdmission } from '../src/printed-card/play-admission';
import { expectPrintedCoverageClosed } from './printed-format-coverage';

const dataRoot = new URL('../data/zen/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Zendikar printed format sources', () => {
  const catalogInput = JSON.parse(readData('zen-printed-catalog-v1.json')) as unknown;
  const catalog = parsePrintedCardCatalog(catalogInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('zen-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the catalog, Limited product and source pin to the build evidence', () => {
    expect(format.id).toBe('zen');
    expect(format.draft.rounds).toEqual(['zen-draft', 'zen-draft', 'zen-draft']);
    expect(format.sealed.boosters).toHaveLength(6);
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'ZEN', cards: catalog.cards.length, contentSha256: catalog.contentSha256 },
    ]);
    expect(sha256(readData('zen-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of ['zen-printed-catalog-v1.json', 'zen-limited-format-v1.json']) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(catalog.cards).toHaveLength(269);
    expect(new Set(catalog.cards.map((card) => card.forgeScript)).size).toBe(234);
  });

  it('closes every script against the shared review table and reusable contracts', () => {
    expectPrintedCoverageClosed([catalogInput], { physicalCards: 269, scripts: 234 });
  }, 180_000);

  it('re-verifies the installed play admission against the staged format and catalog', () => {
    const root = fileURLToPath(new URL('play-admission-v14/', dataRoot)).replace(/[\\/]$/u, '');
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
    expect(catalogs).toEqual({ ZEN: catalog.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('zen-limited-format-v1.json')),
      [catalogInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
    const admission = JSON.parse(readEvidence('admission.json').toString('utf8')) as {
      cards: readonly unknown[];
      matchProbeIds: readonly string[];
    };
    expect(admission.cards).toHaveLength(catalog.cards.length);
    expect(admission.matchProbeIds).toHaveLength(4);
  }, 180_000);

  it('registers the supported Limited and Constructed surfaces', () => {
    const registry = JSON.parse(
      readFileSync(new URL('../data/printed-formats-v1.json', import.meta.url), 'utf8'),
    ) as {
      formats: readonly {
        id: string;
        admissionDirectory?: string;
        constructedFormatFile?: string;
        displayMetadataFile?: string;
        tokenPrintingsFile?: string;
      }[];
    };
    expect(registry.formats.find((entry) => entry.id === 'zen')).toMatchObject({
      admissionDirectory: 'play-admission-v14',
      constructedFormatFile: 'zen-constructed-format-v1.json',
      displayMetadataFile: 'zen-display-metadata-v1.json',
      tokenPrintingsFile: 'zen-token-printings-v1.json',
    });
  });

  it('ships only exact legal Forge-admitted constructed pilot decks', () => {
    const constructed = parsePrintedConstructedFormat(JSON.parse(readData('zen-constructed-format-v1.json')));
    const printings = new Map(catalog.cards.map((card) => [card.physicalId, card]));
    const admission = JSON.parse(readData('play-admission-v14/admission.json')) as {
      readonly cards: readonly { readonly id: string; readonly review: string }[];
    };
    const admitted = new Set(
      admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
    );
    expect(constructed.decks.map((deck) => deck.id)).toEqual([
      'kor-armory',
      'pumped-up',
      'rise-of-the-vampires',
      'the-adventurers',
      'unstable-terrain',
    ]);
    for (const deck of constructed.decks) {
      expect(checkStandardDeck(deck, printings)).toEqual({ legal: true, cards: 60, findings: [] });
      expect(deck.cards.every((slot) => admitted.has(slot.physicalId))).toBe(true);
    }
  });
});
