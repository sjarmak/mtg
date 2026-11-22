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

const dataRoot = new URL('../data/kld-aer/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Kaladesh / Aether Revolt printed format sources', () => {
  const aerInput = JSON.parse(readData('aer-printed-catalog-v1.json')) as unknown;
  const kldInput = JSON.parse(readData('kld-printed-catalog-v1.json')) as unknown;
  const mpsInput = JSON.parse(readData('mps-printed-catalog-v1.json')) as unknown;
  const aer = parsePrintedCardCatalog(aerInput);
  const kld = parsePrintedCardCatalog(kldInput);
  const mps = parsePrintedCardCatalog(mpsInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('kld-aer-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalogs, format and source pin to the build evidence', () => {
    expect(format.id).toBe('kld-aer');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'AER', cards: aer.cards.length, contentSha256: aer.contentSha256 },
      { code: 'KLD', cards: kld.cards.length, contentSha256: kld.contentSha256 },
      { code: 'MPS', cards: mps.cards.length, contentSha256: mps.contentSha256 },
    ]);
    expect(sha256(readData('kld-aer-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of [
      'aer-printed-catalog-v1.json',
      'kld-printed-catalog-v1.json',
      'mps-printed-catalog-v1.json',
      'kld-aer-limited-format-v1.json',
    ]) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(aer.cards).toHaveLength(197);
    expect(kld.cards).toHaveLength(278);
    expect(mps.cards).toHaveLength(54);
    expect(new Set([...aer.cards, ...kld.cards, ...mps.cards].map((card) => card.forgeScript)).size).toBe(
      504,
    );
  });

  it('pins the merged draft recipe over both sets, the AKH/HOU precedent', () => {
    expect(format.draft.rounds).toEqual(['aer-draft', 'aer-draft', 'kld-draft']);
    const sourceSetCodes = Object.fromEntries(
      format.products.map((product) => [product.id, product.sourceSetCodes]),
    );
    expect(sourceSetCodes).toEqual({
      'aer-draft': ['AER', 'KLD', 'MPS'],
      'kld-draft': ['KLD', 'MPS'],
    });
  });

  it('closes every script against the shared review table and the reusable contracts', () => {
    expectPrintedCoverageClosed([aerInput, kldInput, mpsInput], { physicalCards: 529, scripts: 504 });
  }, 180_000);

  it('binds all ten tokens the merged scripts create to a printing (mtg-bn1ah)', () => {
    // Wurmcoil Engine is reprinted as a Kaladesh Inventions (MPS) masterpiece. Its two Phyrexian
    // Wurm tokens are the same pair SOM's own binder refuses (Scryfall prints them as TSOM 8/9,
    // named "Wurm" with type "Wurm", while Forge's two scripts are both "Phyrexian Wurm Token",
    // type "Phyrexian Wurm"): a masterpiece has no token sheet of its own, so both are bound here
    // from TSOM 8/9 with a stated alias, same as SOM. The other eight bind automatically:
    // Kaladesh's own five (Servo, Beast, Construct, Thopter, Wolf) plus three Aether Revolt adds
    // (Gremlin, Etherium Cell, and the Ragavan copy token).
    const archive = readForgeScriptArchive();
    const created = catalogTokenScriptReferences(
      [...new Set([...aer.cards, ...kld.cards, ...mps.cards].map((card) => card.forgeScript))],
      archive,
    ).map((script) => {
      const file = `${script}.txt`;
      const parsed = parseForgeTokenScript(file, readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${file}`, 'utf8'));
      if (parsed === undefined) throw new Error(`Forge token script ${file} states no token`);
      return parsed.name;
    });
    const printings = parsePrintedTokenPrintings(JSON.parse(readData('kld-aer-token-printings-v1.json')));
    const bound = new Set(printings.tokens.flatMap((token) => token.observedNames));
    expect(created).toHaveLength(10);
    expect(created.filter((name) => !bound.has(name)).sort()).toEqual([]);
    expect(printings.tokens.filter((token) => token.art.status !== 'available')).toEqual([]);
    expect(printings.tokens).toHaveLength(10);
  }, 180_000);

  it('re-verifies the installed play admission against the staged format and catalogs', () => {
    const root = fileURLToPath(new URL('play-admission-v19/', dataRoot)).replace(/[\\/]$/u, '');
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
      AER: aer.contentSha256,
      KLD: kld.contentSha256,
      MPS: mps.contentSha256,
    });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('kld-aer-limited-format-v1.json')),
      [aerInput, kldInput, mpsInput],
      runtime,
      readEvidence,
    );
    expect(verdict).toEqual({ admitted: true, reasons: [] });
    const admission = JSON.parse(readEvidence('admission.json').toString('utf8')) as {
      cards: readonly unknown[];
      matchProbeIds: readonly string[];
    };
    expect(admission.cards).toHaveLength(aer.cards.length + kld.cards.length + mps.cards.length);
    expect(admission.matchProbeIds).toHaveLength(4);
  }, 180_000);
});
