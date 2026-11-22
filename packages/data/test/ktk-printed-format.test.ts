import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectPrintedCoverageClosed } from './printed-format-coverage';
import { createHash } from 'node:crypto';
import {
  checkStandardDeck,
  parsePrintedCardCatalog,
  parsePrintedConstructedFormat,
  parsePrintedLimitedFormat,
  parsePrintedTokenPrintings,
} from '@mtg/printed-card';
import { FORGE_TOKEN_SCRIPTS_PATH, readForgeScriptArchive } from '../src/printed-card/forge-install';
import { catalogTokenScriptReferences } from '../src/printed-card/token-references';
import { parseForgeTokenScript } from '../src/printed-card/token-printings';
import { verifyPrintedLimitedPlayAdmission } from '../src/printed-card/play-admission';

const dataRoot = new URL('../data/ktk/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Khans of Tarkir printed format sources', () => {
  const ktkInput = JSON.parse(readData('ktk-printed-catalog-v1.json')) as unknown;
  const ktk = parsePrintedCardCatalog(ktkInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('ktk-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalogs, format and source pin to the build evidence', () => {
    expect(format.id).toBe('ktk');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'KTK', cards: ktk.cards.length, contentSha256: ktk.contentSha256 },
    ]);
    expect(sha256(readData('ktk-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of ['ktk-printed-catalog-v1.json', 'ktk-limited-format-v1.json']) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(ktk.cards).toHaveLength(293);
    expect(new Set(ktk.cards.map((card) => card.forgeScript)).size).toBe(254);
  });

  it('closes every script against the shared review table and the reusable contracts', () => {
    expectPrintedCoverageClosed([ktkInput], { physicalCards: 293, scripts: 254 });
  }, 180_000);

  it('binds every token a script creates to a printing', () => {
    const archive = readForgeScriptArchive();
    const created = catalogTokenScriptReferences(
      [...new Set(ktk.cards.map((card) => card.forgeScript))],
      archive,
    ).map((script) => {
      const file = `${script}.txt`;
      const parsed = parseForgeTokenScript(file, readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${file}`, 'utf8'));
      if (parsed === undefined) throw new Error(`Forge token script ${file} states no token`);
      return parsed.name;
    });
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('ktk-token-printings-v1.json')));
    const bound = new Set(printings.tokens.flatMap((token) => token.observedNames));
    expect(created).toHaveLength(10);
    expect(created.filter((name) => !bound.has(name))).toEqual([]);
    expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
  }, 180_000);

  it('binds each token to one printing the play surface can tell apart', () => {
    // `printingFor` (packages/ui/src/routes/play/backend-position.ts) resolves a token by name, then by
    // color. Khans of Tarkir's ten token scripts carry nine distinct names (the plain and the haste Goblin
    // script share one name and one printing), so none of them depends on the color fallback.
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('ktk-token-printings-v1.json')));
    const keys = printings.tokens.map(
      (token) => `${token.observedNames.join('/')} ${[...token.colors].sort().join('')}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([
      'Bear Token G',
      'Bird Token W',
      'Goblin Token R',
      'Snake Token G',
      'Spirit Token W',
      'Spirit Warrior Token BG',
      'Vampire Token B',
      'Warrior Token W',
      'Zombie Token B',
    ]);
  });

  it('re-verifies the installed play admission against the staged format and catalogs', () => {
    const root = fileURLToPath(new URL('play-admission-v23/', dataRoot)).replace(/[\\/]$/u, '');
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
    expect(catalogs).toEqual({ KTK: ktk.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('ktk-limited-format-v1.json')),
      [ktkInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
    const admission = JSON.parse(readEvidence('admission.json').toString('utf8')) as {
      cards: readonly unknown[];
      matchProbeIds: readonly string[];
    };
    expect(admission.cards).toHaveLength(ktk.cards.length);
    expect(admission.matchProbeIds).toHaveLength(4);
  }, 180_000);

  it('ships only exact legal Forge-admitted constructed pilot decks', () => {
    const constructed = parsePrintedConstructedFormat(JSON.parse(readData('ktk-constructed-format-v1.json')));
    const printings = new Map(ktk.cards.map((card) => [card.physicalId, card]));
    const admission = JSON.parse(readData('play-admission-v23/admission.json')) as {
      readonly cards: readonly { readonly id: string; readonly review: string }[];
    };
    const admitted = new Set(
      admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
    );
    expect(constructed.decks.map((deck) => deck.id)).toEqual([
      'abzan-outlast',
      'jeskai-prowess',
      'sultai-delve',
      'mardu-raid',
      'temur-ferocious',
    ]);
    for (const deck of constructed.decks) {
      expect(checkStandardDeck(deck, printings)).toEqual({ legal: true, cards: 60, findings: [] });
      expect(deck.cards.every((slot) => admitted.has(slot.physicalId))).toBe(true);
    }
  });
});
