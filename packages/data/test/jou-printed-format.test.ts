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

const dataRoot = new URL('../data/jou/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Journey into Nyx printed format sources', () => {
  const bngInput = JSON.parse(readData('bng-printed-catalog-v1.json')) as unknown;
  const jouInput = JSON.parse(readData('jou-printed-catalog-v1.json')) as unknown;
  const thsInput = JSON.parse(readData('ths-printed-catalog-v1.json')) as unknown;
  const bng = parsePrintedCardCatalog(bngInput);
  const jou = parsePrintedCardCatalog(jouInput);
  const ths = parsePrintedCardCatalog(thsInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('jou-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalogs, format and source pin to the build evidence', () => {
    expect(format.id).toBe('jou');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'BNG', cards: bng.cards.length, contentSha256: bng.contentSha256 },
      { code: 'JOU', cards: jou.cards.length, contentSha256: jou.contentSha256 },
      { code: 'THS', cards: ths.cards.length, contentSha256: ths.contentSha256 },
    ]);
    expect(sha256(readData('jou-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of [
      'bng-printed-catalog-v1.json',
      'jou-printed-catalog-v1.json',
      'ths-printed-catalog-v1.json',
      'jou-limited-format-v1.json',
    ]) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(bng.cards).toHaveLength(165);
    expect(jou.cards).toHaveLength(165);
    expect(ths.cards).toHaveLength(249);
    expect(new Set([...bng.cards, ...jou.cards, ...ths.cards].map((card) => card.forgeScript)).size).toBe(
      564,
    );
  });

  it('closes every script against the shared review table and the reusable contracts', () => {
    expectPrintedCoverageClosed([bngInput, jouInput, thsInput], { physicalCards: 579, scripts: 564 });
  }, 180_000);

  it('binds every token a script creates to a printing', () => {
    const archive = readForgeScriptArchive();
    const created = catalogTokenScriptReferences(
      [...new Set([...bng.cards, ...jou.cards, ...ths.cards].map((card) => card.forgeScript))],
      archive,
    ).map((script) => {
      const file = `${script}.txt`;
      const parsed = parseForgeTokenScript(file, readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${file}`, 'utf8'));
      if (parsed === undefined) throw new Error(`Forge token script ${file} states no token`);
      return parsed.name;
    });
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('jou-token-printings-v1.json')));
    const bound = new Set(printings.tokens.flatMap((token) => token.observedNames));
    expect(created).toHaveLength(25);
    expect(created.filter((name) => !bound.has(name))).toEqual([]);
    expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
  }, 180_000);

  it('names the three token pairs the play surface cannot tell apart', () => {
    // `printingFor` (packages/ui/src/routes/play/backend-position.ts) picks between same-named token
    // printings by their colors and, failing that, by age within one oracle id; two different oracle ids
    // with the same colors fail closed to a pending frame. The three catalogs mint a white 1/1 Soldier, a
    // blue 2/2 Bird and a black Zombie twice each, under different oracle ids, so those names fail closed
    // until that selector can see more.
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('jou-token-printings-v1.json')));
    const byNameAndColors = new Map<string, typeof printings.tokens>();
    for (const token of printings.tokens) {
      const key = `${token.observedNames.join('/')} ${[...token.colors].sort().join('')}`;
      byNameAndColors.set(key, [...(byNameAndColors.get(key) ?? []), token]);
    }
    const ambiguous = [...byNameAndColors].filter(([, tokens]) => tokens.length > 1);
    expect(ambiguous.map(([key]) => key).sort()).toEqual([
      'Bird Token U',
      'Soldier Token W',
      'Zombie Token B',
    ]);
    for (const [, tokens] of ambiguous) expect(new Set(tokens.map((token) => token.oracleId)).size).toBe(2);
    const printingsOf = (key: string) =>
      ambiguous
        .find(([name]) => name === key)![1]
        .map((token) => `${token.setCode} ${token.power}/${token.toughness}`)
        .sort();
    expect(printingsOf('Bird Token U')).toEqual(['TBNG 2/2', 'TTHS 2/2']);
    expect(printingsOf('Soldier Token W')).toEqual(['TBNG 1/1', 'TUGL 1/1']);
    expect(printingsOf('Zombie Token B')).toEqual(['TBNG 2/2', 'TJOU */*']);
  });

  it('re-verifies the installed play admission against the staged format and catalogs', () => {
    const root = fileURLToPath(new URL('play-admission-v24/', dataRoot)).replace(/[\\/]$/u, '');
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
    expect(catalogs).toEqual({
      BNG: bng.contentSha256,
      JOU: jou.contentSha256,
      THS: ths.contentSha256,
    });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('jou-limited-format-v1.json')),
      [bngInput, jouInput, thsInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
    const admission = JSON.parse(readEvidence('admission.json').toString('utf8')) as {
      cards: readonly unknown[];
      matchProbeIds: readonly string[];
    };
    expect(admission.cards).toHaveLength(bng.cards.length + jou.cards.length + ths.cards.length);
    expect(admission.matchProbeIds).toHaveLength(4);
  }, 180_000);
});
