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

const dataRoot = new URL('../data/avr/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Avacyn Restored printed format sources', () => {
  const avrInput = JSON.parse(readData('avr-printed-catalog-v1.json')) as unknown;
  const avr = parsePrintedCardCatalog(avrInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('avr-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalogs, format and source pin to the build evidence', () => {
    expect(format.id).toBe('avr');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'AVR', cards: avr.cards.length, contentSha256: avr.contentSha256 },
    ]);
    expect(sha256(readData('avr-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of ['avr-printed-catalog-v1.json', 'avr-limited-format-v1.json']) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(avr.cards).toHaveLength(244);
    expect(new Set(avr.cards.map((card) => card.forgeScript)).size).toBe(234);
  });

  it('closes every script against the shared review table and the reusable contracts', () => {
    expectPrintedCoverageClosed([avrInput], { physicalCards: 244, scripts: 234 });
  }, 180_000);

  it('binds every token a script creates to a printing', () => {
    const archive = readForgeScriptArchive();
    const created = catalogTokenScriptReferences(
      [...new Set(avr.cards.map((card) => card.forgeScript))],
      archive,
    ).map((script) => {
      const file = `${script}.txt`;
      const parsed = parseForgeTokenScript(file, readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${file}`, 'utf8'));
      if (parsed === undefined) throw new Error(`Forge token script ${file} states no token`);
      return parsed.name;
    });
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('avr-token-printings-v1.json')));
    const bound = new Set(printings.tokens.flatMap((token) => token.observedNames));
    expect(created).toHaveLength(7);
    expect(created.filter((name) => !bound.has(name))).toEqual([]);
    expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
  }, 180_000);

  it('binds each same-named token to a printing the play surface can tell apart by color', () => {
    // `printingFor` (packages/ui/src/routes/play/backend-position.ts) picks between same-named token
    // printings by their colors. Avacyn Restored's two repeated names differ in color (Spirit: blue TAVR,
    // white TSHM; Human: red TAVR, white TDKA), so neither falls back to a pending frame.
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('avr-token-printings-v1.json')));
    const keys = printings.tokens.map(
      (token) => `${token.observedNames.join('/')} ${[...token.colors].sort().join('')}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([
      'Angel Token W',
      'Demon Token B',
      'Human Token R',
      'Human Token W',
      'Spirit Token U',
      'Spirit Token W',
      'Zombie Token B',
    ]);
  });

  it('re-verifies the installed play admission against the staged format and catalogs', () => {
    const root = fileURLToPath(new URL('play-admission-v25/', dataRoot)).replace(/[\\/]$/u, '');
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
    expect(catalogs).toEqual({ AVR: avr.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('avr-limited-format-v1.json')),
      [avrInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
    const admission = JSON.parse(readEvidence('admission.json').toString('utf8')) as {
      cards: readonly unknown[];
      matchProbeIds: readonly string[];
    };
    expect(admission.cards).toHaveLength(avr.cards.length);
    expect(admission.matchProbeIds).toHaveLength(4);
  }, 180_000);
});
