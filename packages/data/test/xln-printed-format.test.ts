import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectPrintedCoverageClosed } from './printed-format-coverage';
import { createHash } from 'node:crypto';
import { parsePrintedCardCatalog, parsePrintedLimitedFormat } from '@mtg/printed-card';
import { verifyPrintedLimitedPlayAdmission } from '../src/printed-card/play-admission';

const dataRoot = new URL('../data/xln/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

describe('Ixalan printed format sources', () => {
  const catalogInput = JSON.parse(readData('xln-printed-catalog-v1.json')) as unknown;
  const catalog = parsePrintedCardCatalog(catalogInput);
  const format = parsePrintedLimitedFormat(JSON.parse(readData('xln-limited-format-v1.json')));
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    formatId: string;
    formatSha256: string;
    sourceSha256: string;
    archiveSha256: string;
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalog, format and source pin to the build evidence', () => {
    expect(format.id).toBe('xln');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.catalogs).toEqual([
      { code: 'XLN', cards: catalog.cards.length, contentSha256: catalog.contentSha256 },
    ]);
    expect(sha256(readData('xln-printed-sources-v1.json'))).toBe(evidence.sourceSha256);
    for (const file of ['xln-printed-catalog-v1.json', 'xln-limited-format-v1.json']) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
    expect(catalog.cards).toHaveLength(289);
  });

  it('closes every script against the shared review table and the reusable contracts', () => {
    expectPrintedCoverageClosed([catalogInput]);
  }, 180_000);

  it('re-verifies the installed play admission against the staged format and catalog', () => {
    const root = fileURLToPath(new URL('play-admission-v22/', dataRoot)).replace(/[\\/]$/u, '');
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
    expect(catalogs).toEqual({ XLN: catalog.contentSha256 });
    const verdict = verifyPrintedLimitedPlayAdmission(
      readEvidence('admission.json').toString('utf8'),
      JSON.parse(readData('xln-limited-format-v1.json')),
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
