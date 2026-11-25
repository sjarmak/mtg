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

const dataRoot = new URL('../data/gpt/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Guildpact printed format sources', () => {
  const gptInput = JSON.parse(readData('gpt-printed-catalog-v1.json')) as unknown;
  const ravInput = JSON.parse(readData('rav-printed-catalog-v1.json')) as unknown;
  const gpt = parsePrintedCardCatalog(gptInput);
  const rav = parsePrintedCardCatalog(ravInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('gpt-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalogs, format and source pin to the build evidence', () => {
    expect(format.id).toBe('gpt');
    expect(format.draft.rounds).toEqual(['gpt-draft', 'rav-draft', 'rav-draft']);
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'GPT', cards: gpt.cards.length, contentSha256: gpt.contentSha256 },
      { code: 'RAV', cards: rav.cards.length, contentSha256: rav.contentSha256 },
    ]);
    expect(sha256(readData('gpt-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of [
      'gpt-printed-catalog-v1.json',
      'rav-printed-catalog-v1.json',
      'gpt-limited-format-v1.json',
    ]) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(gpt.cards).toHaveLength(167);
    expect(rav.cards).toHaveLength(306);
  });

  it('closes every script against the shared review table and reusable contracts', () => {
    expectPrintedCoverageClosed([gptInput, ravInput]);
  }, 180_000);

  it('binds every available script-created token and pins the unavailable pair', () => {
    const archive = readForgeScriptArchive();
    const created = catalogTokenScriptReferences(
      [...new Set([...gpt.cards, ...rav.cards].map((card) => card.forgeScript))],
      archive,
    ).map((script) => {
      const file = `${script}.txt`;
      const parsed = parseForgeTokenScript(file, readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${file}`, 'utf8'));
      if (parsed === undefined) throw new Error(`Forge token script ${file} states no token`);
      return parsed.name;
    });
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('gpt-token-printings-v1.json')));
    const bound = new Set(printings.tokens.flatMap((token) => token.observedNames));
    expect(created.filter((name) => !bound.has(name))).toEqual(['Sand Token', 'Weird Token']);
    expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
  }, 180_000);

  it('registers and ships legal Forge-admitted constructed pilot decks', () => {
    const registry = JSON.parse(
      readFileSync(new URL('../data/printed-formats-v1.json', import.meta.url), 'utf8'),
    ) as {
      formats: readonly { id: string; constructedFormatFile?: string }[];
    };
    expect(registry.formats.find((entry) => entry.id === 'gpt')?.constructedFormatFile).toBe(
      'gpt-constructed-format-v1.json',
    );

    const constructed = parsePrintedConstructedFormat(JSON.parse(readData('gpt-constructed-format-v1.json')));
    const printings = new Map([...gpt.cards, ...rav.cards].map((card) => [card.physicalId, card]));
    const admission = JSON.parse(readData('play-admission/admission.json')) as {
      readonly cards: readonly { readonly id: string; readonly review: string }[];
    };
    const admitted = new Set(
      admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
    );
    expect(constructed.decks.map((deck) => deck.id)).toEqual(['gruul-bloodthirst', 'izzet-replicate']);
    for (const deck of constructed.decks) {
      expect(checkStandardDeck(deck, printings)).toEqual({ legal: true, cards: 60, findings: [] });
      expect(deck.cards.every((slot) => admitted.has(slot.physicalId))).toBe(true);
    }
  });

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
    expect(catalogs).toEqual({ GPT: gpt.contentSha256, RAV: rav.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('gpt-limited-format-v1.json')),
      [gptInput, ravInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
  }, 180_000);
});
