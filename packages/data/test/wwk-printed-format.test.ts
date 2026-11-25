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

const dataRoot = new URL('../data/wwk/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Worldwake printed format sources', () => {
  const wwkInput = JSON.parse(readData('wwk-printed-catalog-v1.json')) as unknown;
  const zenInput = JSON.parse(readData('zen-printed-catalog-v1.json')) as unknown;
  const wwk = parsePrintedCardCatalog(wwkInput);
  const zen = parsePrintedCardCatalog(zenInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('wwk-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds both catalogs, the Limited product and source pin to the build evidence', () => {
    expect(format.id).toBe('wwk');
    expect(format.draft.rounds).toEqual(['wwk-draft', 'zen-draft', 'zen-draft']);
    expect(format.sealed.boosters).toEqual([
      'wwk-draft',
      'wwk-draft',
      'zen-draft',
      'zen-draft',
      'zen-draft',
      'zen-draft',
    ]);
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'WWK', cards: wwk.cards.length, contentSha256: wwk.contentSha256 },
      { code: 'ZEN', cards: zen.cards.length, contentSha256: zen.contentSha256 },
    ]);
    expect(sha256(readData('wwk-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of [
      'wwk-printed-catalog-v1.json',
      'zen-printed-catalog-v1.json',
      'wwk-limited-format-v1.json',
    ]) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(wwk.cards).toHaveLength(145);
    expect(zen.cards).toHaveLength(269);
    expect(new Set([...wwk.cards, ...zen.cards].map((card) => card.forgeScript)).size).toBe(379);
  });

  it('closes every script against the shared review table and reusable contracts', () => {
    expectPrintedCoverageClosed([wwkInput, zenInput], { physicalCards: 414, scripts: 379 });
  }, 180_000);

  it('re-verifies the installed play admission against the staged format and catalogs', () => {
    const root = fileURLToPath(new URL('play-admission/', dataRoot)).replace(/[\\/]$/u, '');
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
    expect(catalogs).toEqual({ WWK: wwk.contentSha256, ZEN: zen.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('wwk-limited-format-v1.json')),
      [wwkInput, zenInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
    const admission = JSON.parse(readEvidence('admission.json').toString('utf8')) as {
      cards: readonly unknown[];
      matchProbeIds: readonly string[];
    };
    expect(admission.cards).toHaveLength(wwk.cards.length + zen.cards.length);
    expect(admission.matchProbeIds).toHaveLength(4);
  }, 180_000);

  it('registers and ships legal Forge-admitted constructed pilot decks', () => {
    const registry = JSON.parse(
      readFileSync(new URL('../data/printed-formats-v1.json', import.meta.url), 'utf8'),
    ) as {
      formats: readonly { id: string; constructedFormatFile?: string }[];
    };
    expect(registry.formats.find((entry) => entry.id === 'wwk')?.constructedFormatFile).toBe(
      'wwk-constructed-format-v1.json',
    );

    const constructed = parsePrintedConstructedFormat(JSON.parse(readData('wwk-constructed-format-v1.json')));
    const printings = new Map([...wwk.cards, ...zen.cards].map((card) => [card.physicalId, card]));
    const admission = JSON.parse(readData('play-admission/admission.json')) as {
      readonly cards: readonly { readonly id: string; readonly review: string }[];
    };
    const admitted = new Set(
      admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
    );
    expect(constructed.decks.length).toBeGreaterThan(0);
    for (const deck of constructed.decks) {
      expect(checkStandardDeck(deck, printings)).toEqual({ legal: true, cards: 60, findings: [] });
      expect(deck.cards.every((slot) => admitted.has(slot.physicalId))).toBe(true);
    }
  });
});
