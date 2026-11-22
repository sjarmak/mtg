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
import { FORGE_TOKEN_SCRIPTS_PATH, readForgeScriptArchive } from '../src/printed-card/forge-install';
import { verifyPrintedLimitedPlayAdmission } from '../src/printed-card/play-admission';
import { catalogTokenScriptReferences } from '../src/printed-card/token-references';
import { parseForgeTokenScript } from '../src/printed-card/token-printings';
import { expectPrintedCoverageClosed } from './printed-format-coverage';

const dataRoot = new URL('../data/lrw/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Lorwyn printed format sources', () => {
  const catalogInput = JSON.parse(readData('lrw-printed-catalog-v1.json')) as unknown;
  const catalog = parsePrintedCardCatalog(catalogInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('lrw-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalog, format and source pin to the build evidence', () => {
    expect(format.id).toBe('lrw');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'LRW', cards: catalog.cards.length, contentSha256: catalog.contentSha256 },
    ]);
    expect(sha256(readData('lrw-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of ['lrw-printed-catalog-v1.json', 'lrw-limited-format-v1.json']) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(catalog.cards).toHaveLength(301);
    expect(catalog.cards.filter((card) => card.art.status !== 'available')).toEqual([]);
  });

  it('closes every script against the shared review table and the reusable contracts', () => {
    expectPrintedCoverageClosed([catalogInput], {
      physicalCards: 301,
      scripts: new Set(catalog.cards.map((card) => card.forgeScript)).size,
    });
  }, 180_000);

  it('binds every token a script creates to a printing', () => {
    const archive = readForgeScriptArchive();
    const created = catalogTokenScriptReferences(
      [...new Set(catalog.cards.map((card) => card.forgeScript))],
      archive,
    ).map((script) => {
      const file = `${script}.txt`;
      const parsed = parseForgeTokenScript(file, readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${file}`, 'utf8'));
      if (parsed === undefined) throw new Error(`Forge token script ${file} states no token`);
      return parsed.name;
    });
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('lrw-token-printings-v1.json')));
    const bound = new Set(printings.tokens.flatMap((token) => token.observedNames));
    expect(created.filter((name) => !bound.has(name))).toEqual([]);
    expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
  }, 180_000);

  it('ships its legal Forge-admitted constructed decks', () => {
    const registry = JSON.parse(
      readFileSync(new URL('../data/printed-formats-v1.json', import.meta.url), 'utf8'),
    ) as {
      readonly formats: readonly { readonly id: string; readonly constructedFormatFile?: string }[];
    };
    const registered = registry.formats.find((entry) => entry.id === 'lrw');
    expect(registered?.constructedFormatFile).toBe('lrw-constructed-format-v1.json');
    const constructed = parsePrintedConstructedFormat(JSON.parse(readData('lrw-constructed-format-v1.json')));
    const printings = new Map(catalog.cards.map((card) => [card.physicalId, card]));
    const admission = JSON.parse(readData('play-admission-v13/admission.json')) as {
      readonly cards: readonly { readonly id: string; readonly review: string }[];
    };
    const admitted = new Set(
      admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
    );
    expect(constructed.decks.map((deck) => deck.id)).toEqual([
      'white-blue-merfolk',
      'five-color-elementals',
      'white-black-green-treefolk',
    ]);
    for (const deck of constructed.decks) {
      expect(checkStandardDeck(deck, printings)).toEqual({ legal: true, cards: 60, findings: [] });
      expect(deck.cards.every((slot) => admitted.has(slot.physicalId))).toBe(true);
    }
  });

  it('re-verifies the installed play admission against the staged format and catalog', () => {
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
    expect(catalogs).toEqual({ LRW: catalog.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('lrw-limited-format-v1.json')),
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
});
