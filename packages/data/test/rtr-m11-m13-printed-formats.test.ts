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

const formats = [
  {
    id: 'rtr',
    code: 'RTR',
    name: 'Return to Ravnica',
    cards: 274,
    scripts: 254,
    tokens: 12,
    constructedDecks: 5,
    admissionDirectory: 'play-admission-v15',
  },
  {
    id: 'm11',
    code: 'M11',
    name: 'Magic 2011',
    cards: 249,
    scripts: 234,
    tokens: 6,
    constructedDecks: 1,
    admissionDirectory: 'play-admission-v15',
  },
  {
    id: 'm13',
    code: 'M13',
    name: 'Magic 2013',
    cards: 249,
    scripts: 234,
    tokens: 10,
    constructedDecks: 5,
    admissionDirectory: 'play-admission-v15',
  },
] as const;

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe.each(formats)(
  '$name printed format',
  ({ id, code, cards, scripts, tokens, constructedDecks, admissionDirectory }) => {
    const dataRoot = new URL(`../data/${id}/`, import.meta.url);
    const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
    const catalogInput = JSON.parse(readData(`${id}-printed-catalog-v1.json`)) as unknown;
    const catalog = parsePrintedCardCatalog(catalogInput);
    const limited = parsePrintedLimitedFormat(JSON.parse(readData(`${id}-limited-format-v1.json`)));

    it('binds one standalone catalog and three-pack draft to its build evidence', () => {
      const evidence = JSON.parse(readData('build-evidence.json')) as {
        formatId: string;
        formatSha256: string;
        sourceSha256: string;
        catalogs: readonly { code: string; cards: number; contentSha256: string }[];
        artifactSha256: Record<string, string>;
      };
      const catalogFile = `${id}-printed-catalog-v1.json`;
      const formatFile = `${id}-limited-format-v1.json`;
      expect(limited.id).toBe(id);
      expect(limited.draft.rounds).toEqual([`${id}-draft`, `${id}-draft`, `${id}-draft`]);
      expect(evidence.formatId).toBe(id);
      expect(evidence.formatSha256).toBe(limited.contentSha256);
      expect(evidence.catalogs).toEqual([{ code, cards, contentSha256: catalog.contentSha256 }]);
      expect(sha256(readData(`${id}-printed-sources-v1.json`))).toBe(evidence.sourceSha256);
      expect(sha256(readData(catalogFile))).toBe(evidence.artifactSha256[catalogFile]);
      expect(sha256(readData(formatFile))).toBe(evidence.artifactSha256[formatFile]);
    });

    it('closes every script and binds each available token printing', () => {
      expectPrintedCoverageClosed([catalogInput], { physicalCards: cards, scripts });
      const printings = parsePrintedTokenPrintings(JSON.parse(readData(`${id}-token-printings-v1.json`)));
      expect(printings.tokens).toHaveLength(tokens);
      expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
    }, 180_000);

    it('re-verifies its installed admission', () => {
      const root = fileURLToPath(new URL(`${admissionDirectory}/`, dataRoot)).replace(/[\\/]$/u, '');
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
      expect(formatId).toBe(limited.id);
      expect(formatSha256).toBe(limited.contentSha256);
      expect(catalogs).toEqual({ [code]: catalog.contentSha256 });
      expect(
        verifyPrintedLimitedPlayAdmission(
          readEvidence('admission.json').toString('utf8'),
          JSON.parse(readData(`${id}-limited-format-v1.json`)),
          [catalogInput],
          runtime,
          readEvidence,
        ),
      ).toEqual({ admitted: true, reasons: [] });
    }, 180_000);

    it('ships its legal Forge-admitted constructed decks', () => {
      const constructed = parsePrintedConstructedFormat(
        JSON.parse(readData(`${id}-constructed-format-v1.json`)),
      );
      const printings = new Map(catalog.cards.map((card) => [card.physicalId, card]));
      const admission = JSON.parse(readData(`${admissionDirectory}/admission.json`)) as {
        readonly cards: readonly { readonly id: string; readonly review: string }[];
        readonly matchProbeIds: readonly string[];
      };
      const admitted = new Set(
        admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
      );
      expect(admission.cards).toHaveLength(cards);
      expect(admission.matchProbeIds).toHaveLength(4);
      expect(constructed.decks).toHaveLength(constructedDecks);
      for (const deck of constructed.decks) {
        expect(checkStandardDeck(deck, printings)).toEqual({ legal: true, cards: 60, findings: [] });
        expect(deck.cards.every((slot) => admitted.has(slot.physicalId))).toBe(true);
      }
    });
  },
);
