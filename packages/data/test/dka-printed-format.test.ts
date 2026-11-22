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

const dataRoot = new URL('../data/dka/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Dark Ascension printed format sources', () => {
  const dkaInput = JSON.parse(readData('dka-printed-catalog-v1.json')) as unknown;
  const isdInput = JSON.parse(readData('isd-printed-catalog-v1.json')) as unknown;
  const dka = parsePrintedCardCatalog(dkaInput);
  const isd = parsePrintedCardCatalog(isdInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('dka-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalogs, format and source pin to the build evidence', () => {
    expect(format.id).toBe('dka');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'DKA', cards: dka.cards.length, contentSha256: dka.contentSha256 },
      { code: 'ISD', cards: isd.cards.length, contentSha256: isd.contentSha256 },
    ]);
    expect(sha256(readData('dka-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of [
      'dka-printed-catalog-v1.json',
      'isd-printed-catalog-v1.json',
      'dka-limited-format-v1.json',
    ]) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(dka.cards).toHaveLength(158);
    expect(isd.cards).toHaveLength(264);
    expect(new Set([...dka.cards, ...isd.cards].map((card) => card.forgeScript)).size).toBe(412);
  });

  it('closes every script against the shared review table and the reusable contracts', () => {
    expectPrintedCoverageClosed([dkaInput, isdInput], { physicalCards: 422, scripts: 412 });
  }, 180_000);

  it('binds every token a script creates to a printing', () => {
    const archive = readForgeScriptArchive();
    const created = catalogTokenScriptReferences(
      [...new Set([...dka.cards, ...isd.cards].map((card) => card.forgeScript))],
      archive,
    ).map((script) => {
      const file = `${script}.txt`;
      const parsed = parseForgeTokenScript(file, readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${file}`, 'utf8'));
      if (parsed === undefined) throw new Error(`Forge token script ${file} states no token`);
      return parsed.name;
    });
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('dka-token-printings-v1.json')));
    const bound = new Set(printings.tokens.flatMap((token) => token.observedNames));
    expect(created).toHaveLength(12);
    expect(created.filter((name) => !bound.has(name))).toEqual([]);
    expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
  }, 180_000);

  it('names the one token pair colors cannot tell apart, and the rules text that does', () => {
    // `printingFor` (packages/ui/src/routes/play/backend-position.ts) picks between same-named token
    // printings by their colors, then by the keywords the object has now (`mtg-oin1f`), and failing both,
    // by age within one oracle id; two different oracle ids it cannot separate fail closed to a pending
    // frame. The Wolves differ in color (black 1/1 TISD, green 2/2 TLRW). The two black Vampires (1/1
    // lifelink TDKA, 2/2 flying TISD) share colors, so what separates them is the keyword line each
    // printing's rules text states, which the selector reads (packages/ui/test/play/
    // printed-format-art-coverage.test.ts resolves them against these very rows).
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('dka-token-printings-v1.json')));
    const byNameAndColors = new Map<string, typeof printings.tokens>();
    for (const token of printings.tokens) {
      const key = `${token.observedNames.join('/')} ${[...token.colors].sort().join('')}`;
      byNameAndColors.set(key, [...(byNameAndColors.get(key) ?? []), token]);
    }
    const ambiguous = [...byNameAndColors].filter(([, tokens]) => tokens.length > 1);
    expect(ambiguous.map(([key]) => key)).toEqual(['Vampire Token B']);
    const vampires = ambiguous[0]![1];
    expect(new Set(vampires.map((token) => token.oracleId)).size).toBe(2);
    expect(vampires.map((token) => `${token.setCode} ${token.power}/${token.toughness}`).sort()).toEqual([
      'TDKA 1/1',
      'TISD 2/2',
    ]);
    expect(
      Object.fromEntries(
        vampires.map((token) => [token.setCode, token.faces.map((face) => face.oracleText)]),
      ),
    ).toEqual({ TDKA: ['Lifelink'], TISD: ['Flying'] });
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
    expect(catalogs).toEqual({ DKA: dka.contentSha256, ISD: isd.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('dka-limited-format-v1.json')),
      [dkaInput, isdInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
    const admission = JSON.parse(readEvidence('admission.json').toString('utf8')) as {
      cards: readonly unknown[];
      matchProbeIds: readonly string[];
    };
    expect(admission.cards).toHaveLength(dka.cards.length + isd.cards.length);
    expect(admission.matchProbeIds).toHaveLength(4);
  }, 180_000);
});
