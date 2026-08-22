/**
 * The anti-contamination guarantee `tools/adjudicate.ts` claims in its own
 * docblock: it must be structurally unable to read a critic verdict before
 * The playtester records her own judgment, because a human who has seen the
 * critic's answer first cannot un-see it, and the measurement this bead exists
 * to produce depends on her judgment being independent.
 *
 * This is a source-text check rather than a runtime one on purpose: the
 * property being guarded is "no code path imports the verdict side", and the
 * only way to verify the absence of a code path is to inspect what the file
 * imports, not to run it and see what it happens to do this time.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools');
const ADJUDICATE_SOURCE = readFileSync(join(TOOLS_DIR, 'adjudicate.ts'), 'utf8');

/** Identifiers that belong to the verdict-reading half of `records.ts`, never the adjudication half. */
const VERDICT_IDENTIFIERS = [
  'loadVerdictsFile',
  'saveVerdictsFile',
  'VerdictsFileSchema',
  'VerdictRecordSchema',
  'VerdictRecord',
  'VerdictsFile',
];

/** What `adjudicate.ts` is allowed to import from `../src/critic/records`. */
const ALLOWED_RECORDS_IMPORTS = new Set([
  'loadAdjudicationFile',
  'saveAdjudicationFile',
  'AdjudicationAnswer',
  'AdjudicationCriterionAnswer',
  'AdjudicationFile',
]);

describe('adjudicate.ts contamination guard', () => {
  it('never imports the critic module that produces a verdict', () => {
    expect(ADJUDICATE_SOURCE).not.toMatch(/from ['"].*critic\/critic['"]/);
    expect(ADJUDICATE_SOURCE).not.toContain('judgeFaithfulness');
  });

  it('never imports the run-critic tool that writes verdicts', () => {
    expect(ADJUDICATE_SOURCE).not.toMatch(/from ['"].*run-critic['"]/);
  });

  it('never names a verdict-reading identifier anywhere in its source', () => {
    for (const identifier of VERDICT_IDENTIFIERS) {
      expect(ADJUDICATE_SOURCE).not.toContain(identifier);
    }
  });

  it('imports from records.ts only the adjudication-side bindings', () => {
    const importBlock = /import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*['"]\.\.\/src\/critic\/records['"];?/g;
    const matches = [...ADJUDICATE_SOURCE.matchAll(importBlock)];
    expect(matches.length).toBeGreaterThan(0); // the file does read/write adjudication files
    for (const match of matches) {
      const names = (match[1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      for (const name of names) {
        expect(ALLOWED_RECORDS_IMPORTS.has(name)).toBe(true);
      }
    }
  });

  it('never opens the verdicts output path a run-critic.ts run would write to', () => {
    expect(ADJUDICATE_SOURCE).not.toContain('verdicts-');
  });
});
