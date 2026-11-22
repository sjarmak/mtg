/**
 * `npm run analyze -- --claims <file>`: the far end of the boundary.
 *
 * `@mtg/cube` writes that file because it cannot be imported here — it reaches
 * `better-sqlite3` through `@mtg/decklab` and this package is bundled for a
 * browser. So the document's claims block arrives as JSON from outside, and the
 * rule for outside data holds: it is validated on the way in, by the same
 * function the dashboard reads it with, so a block the surface would reject
 * fails the run that produced it instead of a later fetch.
 */
import { describe, expect, it } from 'vitest';
import { readRunClaims } from '../../src/routes/analysis/read';
import { parseArgs } from '../../tools/analyze';

const SET = 'out/XMP/set.json';

describe('the --claims flag', () => {
  it('is optional, and absent means the document states no capabilities', () => {
    expect(parseArgs([SET]).claimsPath).toBeUndefined();
  });

  it('carries the path it was given', () => {
    expect(parseArgs([SET, '--claims', 'out/claims.json']).claimsPath).toBe('out/claims.json');
  });
});

describe('the block that arrives from outside', () => {
  it('is refused when a measured claim carries no measurement', () => {
    expect(() =>
      readRunClaims(
        {
          claims: [
            {
              capability: 'size',
              subject: '',
              statement: '360 cards',
              status: 'met',
              measured: null,
              required: 360,
              distance: null,
              unit: 'cards',
              detail: '',
            },
          ],
          unclaimed: [],
          reported: [],
          limitsKind: 'not-attempted',
          limits: [],
          draftProvenance: null,
          ok: true,
        },
        'claims',
      ),
    ).toThrow(/measurement/u);
  });
});
