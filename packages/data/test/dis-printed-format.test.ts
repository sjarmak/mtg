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

const dataRoot = new URL('../data/dis/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Dissension printed format sources', () => {
  const disInput = JSON.parse(readData('dis-printed-catalog-v1.json')) as unknown;
  const gptInput = JSON.parse(readData('gpt-printed-catalog-v1.json')) as unknown;
  const ravInput = JSON.parse(readData('rav-printed-catalog-v1.json')) as unknown;
  const dis = parsePrintedCardCatalog(disInput);
  const gpt = parsePrintedCardCatalog(gptInput);
  const rav = parsePrintedCardCatalog(ravInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('dis-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalogs, format and source pin to the build evidence', () => {
    expect(format.id).toBe('dis');
    expect(format.draft.rounds).toEqual(['dis-draft', 'gpt-draft', 'rav-draft']);
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'DIS', cards: dis.cards.length, contentSha256: dis.contentSha256 },
      { code: 'GPT', cards: gpt.cards.length, contentSha256: gpt.contentSha256 },
      { code: 'RAV', cards: rav.cards.length, contentSha256: rav.contentSha256 },
    ]);
    expect(sha256(readData('dis-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of [
      'dis-printed-catalog-v1.json',
      'gpt-printed-catalog-v1.json',
      'rav-printed-catalog-v1.json',
      'dis-limited-format-v1.json',
    ]) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(dis.cards).toHaveLength(180);
    expect(gpt.cards).toHaveLength(167);
    expect(rav.cards).toHaveLength(306);
  });

  it('closes every script against the shared review table and reusable contracts', () => {
    expectPrintedCoverageClosed([disInput, gptInput, ravInput]);
  }, 180_000);

  it('re-verifies the installed play admission against the staged format and catalogs', () => {
    const root = fileURLToPath(new URL('play-admission-v7/', dataRoot)).replace(/[\\/]$/u, '');
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
    expect(catalogs).toEqual({ DIS: dis.contentSha256, GPT: gpt.contentSha256, RAV: rav.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('dis-limited-format-v1.json')),
      [disInput, gptInput, ravInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
  }, 180_000);

  it('records a complete bounded catalog sweep', () => {
    const report = JSON.parse(readData('catalog-coverage-sweep-v1/report.json')) as {
      formatId: string;
      summary: { requested: number; opened: number; finished: number; incomplete: number };
    };
    expect(report.formatId).toBe('dis');
    expect(report.summary).toEqual({ requested: 32, opened: 32, finished: 32, incomplete: 0 });
  });

  it('registers and ships legal Forge-admitted constructed pilot decks', () => {
    const registry = JSON.parse(
      readFileSync(new URL('../data/printed-formats-v1.json', import.meta.url), 'utf8'),
    ) as {
      formats: readonly { id: string; constructedFormatFile?: string }[];
    };
    expect(registry.formats.find((entry) => entry.id === 'dis')?.constructedFormatFile).toBe(
      'dis-constructed-format-v1.json',
    );

    const constructed = parsePrintedConstructedFormat(JSON.parse(readData('dis-constructed-format-v1.json')));
    const printings = new Map(
      [...dis.cards, ...gpt.cards, ...rav.cards].map((card) => [card.physicalId, card]),
    );
    const admission = JSON.parse(readData('play-admission-v7/admission.json')) as {
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
