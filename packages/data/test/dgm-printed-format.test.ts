import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectPrintedCoverageClosed } from './printed-format-coverage';
import { createHash } from 'node:crypto';
import {
  parsePrintedCardCatalog,
  parsePrintedLimitedFormat,
  parsePrintedTokenPrintings,
} from '@mtg/printed-card';
import { FORGE_TOKEN_SCRIPTS_PATH, readForgeScriptArchive } from '../src/printed-card/forge-install';
import { catalogTokenScriptReferences } from '../src/printed-card/token-references';
import { parseForgeTokenScript } from '../src/printed-card/token-printings';
import { verifyPrintedLimitedPlayAdmission } from '../src/printed-card/play-admission';

const dataRoot = new URL('../data/dgm/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe("Dragon's Maze printed format sources", () => {
  const dgmInput = JSON.parse(readData('dgm-printed-catalog-v1.json')) as unknown;
  const gtcInput = JSON.parse(readData('gtc-printed-catalog-v1.json')) as unknown;
  const rtrInput = JSON.parse(readData('rtr-printed-catalog-v1.json')) as unknown;
  const dgm = parsePrintedCardCatalog(dgmInput);
  const gtc = parsePrintedCardCatalog(gtcInput);
  const rtr = parsePrintedCardCatalog(rtrInput);
  const allCards = [...dgm.cards, ...gtc.cards, ...rtr.cards];
  const format = parsePrintedLimitedFormat(JSON.parse(readData('dgm-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalogs, format and source pin to the build evidence', () => {
    expect(format.id).toBe('dgm');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'DGM', cards: dgm.cards.length, contentSha256: dgm.contentSha256 },
      { code: 'GTC', cards: gtc.cards.length, contentSha256: gtc.contentSha256 },
      { code: 'RTR', cards: rtr.cards.length, contentSha256: rtr.contentSha256 },
    ]);
    expect(sha256(readData('dgm-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of [
      'dgm-printed-catalog-v1.json',
      'gtc-printed-catalog-v1.json',
      'rtr-printed-catalog-v1.json',
      'dgm-limited-format-v1.json',
    ]) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(dgm.cards).toHaveLength(156);
    expect(gtc.cards).toHaveLength(249);
    expect(rtr.cards).toHaveLength(274);
    expect(new Set(allCards.map((card) => card.forgeScript)).size).toBe(649);
  });

  it('closes every script against the shared review table and the reusable contracts', () => {
    expectPrintedCoverageClosed([dgmInput, gtcInput, rtrInput], { physicalCards: 679, scripts: 649 });
  }, 180_000);

  it('binds every token a script creates to a printing', () => {
    const archive = readForgeScriptArchive();
    const created = catalogTokenScriptReferences(
      [...new Set(allCards.map((card) => card.forgeScript))],
      archive,
    ).map((script) => {
      const file = `${script}.txt`;
      const parsed = parseForgeTokenScript(file, readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${file}`, 'utf8'));
      if (parsed === undefined) throw new Error(`Forge token script ${file} states no token`);
      return parsed.name;
    });
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('dgm-token-printings-v1.json')));
    const bound = new Set(printings.tokens.flatMap((token) => token.observedNames));
    expect(created).toHaveLength(20);
    expect(created.filter((name) => !bound.has(name))).toEqual([]);
    expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
  }, 180_000);

  it('names the one same-named token pair the play surface cannot tell apart by color', () => {
    // `printingFor` (packages/ui/src/routes/play/backend-position.ts) picks between same-named token
    // printings by their colors and, failing that, by age within one oracle id. Two names repeat here.
    // The Soldier pair differs in color (TUGL white, TGTC red-white). The Elemental pair does not: the
    // Dragon's Maze */* and the Return to Ravnica 8/8 vigilance are both green-white with different oracle
    // ids, so that lookup returns nothing and the object draws the labeled pending frame. Rules play is
    // unaffected; the pair is pinned so a new same-colored duplicate cannot arrive unnoticed.
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('dgm-token-printings-v1.json')));
    const byNameAndColors = new Map<string, typeof printings.tokens>();
    for (const token of printings.tokens) {
      const key = `${token.observedNames.join('/')} ${[...token.colors].sort().join('')}`;
      byNameAndColors.set(key, [...(byNameAndColors.get(key) ?? []), token]);
    }
    expect(
      [...byNameAndColors]
        .filter(([, tokens]) => tokens.length > 1)
        .map(([key, tokens]) => [key, tokens.map((t) => t.setCode).sort()]),
    ).toEqual([['Elemental Token GW', ['TDGM', 'TRTR']]]);
    const soldiers = printings.tokens.filter((token) => token.observedNames.includes('Soldier Token'));
    expect(soldiers.map((token) => `${token.setCode} ${[...token.colors].sort().join('')}`).sort()).toEqual([
      'TGTC RW',
      'TUGL W',
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
    expect(catalogs).toEqual({ DGM: dgm.contentSha256, GTC: gtc.contentSha256, RTR: rtr.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('dgm-limited-format-v1.json')),
      [dgmInput, gtcInput, rtrInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
    const admission = JSON.parse(readEvidence('admission.json').toString('utf8')) as {
      cards: readonly unknown[];
      matchProbeIds: readonly string[];
    };
    expect(admission.cards).toHaveLength(allCards.length);
    expect(admission.matchProbeIds).toHaveLength(4);
  }, 180_000);
});
