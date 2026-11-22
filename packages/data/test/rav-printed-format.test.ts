import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkStandardDeck,
  parsePrintedCardCatalog,
  parsePrintedConstructedFormat,
  parsePrintedLimitedFormat,
  parsePrintedTokenPrintings,
} from '@mtg/printed-card';
import { describe, expect, it } from 'vitest';
import { verifyPrintedLimitedPlayAdmission } from '../src/printed-card/play-admission';
import { expectPrintedCoverageClosed } from './printed-format-coverage';

const dataRoot = new URL('../data/rav/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Ravnica: City of Guilds printed format', () => {
  const catalogInput = JSON.parse(readData('rav-printed-catalog-v1.json')) as unknown;
  const catalog = parsePrintedCardCatalog(catalogInput);
  const formatInput = JSON.parse(readData('rav-limited-format-v1.json')) as unknown;
  const format = parsePrintedLimitedFormat(formatInput);

  it('binds the standalone catalog and three-pack draft to its build evidence', () => {
    const catalogFile = 'rav-printed-catalog-v1.json';
    const formatFile = 'rav-limited-format-v1.json';
    const evidence = JSON.parse(readData('build-evidence.json')) as {
      formatId: string;
      formatSha256: string;
      sourceSha256: string;
      catalogs: readonly { code: string; cards: number; contentSha256: string }[];
      artifactSha256: Record<string, string>;
    };

    expect(format.id).toBe('rav');
    expect(format.draft.rounds).toEqual(['rav-draft', 'rav-draft', 'rav-draft']);
    expect(catalog.cards).toHaveLength(306);
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'RAV', cards: catalog.cards.length, contentSha256: catalog.contentSha256 },
    ]);
    expect(sha256(readData('rav-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    expect(sha256(readData(catalogFile))).toBe(evidence.artifactSha256[catalogFile]);
    expect(sha256(readData(formatFile))).toBe(evidence.artifactSha256[formatFile]);
  });

  it('closes every script and binds each available token printing', () => {
    expectPrintedCoverageClosed([catalogInput], { physicalCards: 306, scripts: 291 });
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('rav-token-printings-v1.json')));
    expect(printings.tokens).toHaveLength(8);
    expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
  }, 180_000);

  it('registers and ships legal Forge-admitted constructed pilot decks', () => {
    const registry = JSON.parse(
      readFileSync(new URL('../data/printed-formats-v1.json', import.meta.url), 'utf8'),
    ) as {
      formats: readonly { id: string; constructedFormatFile?: string }[];
    };
    expect(registry.formats.find((entry) => entry.id === 'rav')?.constructedFormatFile).toBe(
      'rav-constructed-format-v1.json',
    );

    const constructed = parsePrintedConstructedFormat(JSON.parse(readData('rav-constructed-format-v1.json')));
    const printings = new Map(catalog.cards.map((card) => [card.physicalId, card]));
    const admission = JSON.parse(readData('play-admission-v13/admission.json')) as {
      readonly cards: readonly { readonly id: string; readonly review: string }[];
    };
    const admitted = new Set(
      admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
    );
    expect(constructed.decks.map((deck) => deck.id)).toEqual([
      'boros-tempo',
      'golgari-graveyard',
      'selesnya-tokens',
    ]);
    for (const deck of constructed.decks) {
      expect(checkStandardDeck(deck, printings)).toEqual({ legal: true, cards: 60, findings: [] });
      expect(deck.cards.every((slot) => admitted.has(slot.physicalId))).toBe(true);
    }
  });

  it('re-verifies its installed admission', () => {
    const root = fileURLToPath(new URL('play-admission-v13/', dataRoot)).replace(/[\\/]$/u, '');
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
    expect(catalogs).toEqual({ RAV: catalog.contentSha256 });
    expect(
      verifyPrintedLimitedPlayAdmission(
        readEvidence('admission.json').toString('utf8'),
        formatInput,
        [catalogInput],
        runtime,
        readEvidence,
      ),
    ).toEqual({ admitted: true, reasons: [] });
  }, 180_000);
});
