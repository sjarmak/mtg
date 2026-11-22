/**
 * The claims block on the way in.
 *
 * `@mtg/cube` measures it and `@mtg/ui` renders it, and nothing links the two:
 * the block crosses as JSON because `@mtg/cube` reaches `better-sqlite3` and
 * this package's `src/` is bundled for a browser. So the reader is the whole of
 * the seam's protection on this side, and the pairing it enforces is the one
 * the block exists for — an unmeasured capability carries a reason and never a
 * number. A document claiming both would render a measurement nobody made.
 */
import { describe, expect, it } from 'vitest';
import { AnalysisDataError, readAnalysisRun } from '../../src/routes/analysis/read';
import { fixtureJson } from './support/fixtures';

const MET = {
  capability: 'size',
  subject: '',
  statement: 'the list holds 360 cards',
  status: 'met',
  measured: 360,
  required: 360,
  distance: 0,
  unit: 'cards',
  detail: 'the list holds 360 cards, and it does',
};

const UNMEASURED = {
  capability: 'archetype-support',
  subject: 'boros aggro',
  statement: 'boros aggro has 24 playable cards in WR',
  status: 'unmeasured',
  measured: null,
  required: 24,
  distance: null,
  unit: 'cards',
  detail: 'nothing tagged which cards serve which archetype',
};

const BLOCK = {
  claims: [MET, UNMEASURED],
  unclaimed: [],
  reported: [],
  limitsKind: 'not-drafted',
  limits: [{ id: 'dsl-cards-only', what: 'the draft runtime drafts DSL cards' }],
  draftProvenance: null,
  ok: true,
};

function withClaims(claims: unknown): unknown {
  const draft = JSON.parse(JSON.stringify(fixtureJson('run-a'))) as Record<string, unknown>;
  draft['claims'] = claims;
  return draft;
}

describe('the claims block on an analysis document', () => {
  it('reads a block holding a measured and an unmeasured capability', () => {
    const run = readAnalysisRun(withClaims(BLOCK));

    expect(run.claims?.ok).toBe(true);
    expect(run.claims?.claims.map((claim) => claim.status)).toEqual(['met', 'unmeasured']);
    expect(run.claims?.claims[1]?.measured, 'an unmeasured claim came back with a number').toBeNull();
    expect(run.claims?.limits.map((limit) => limit.id)).toEqual(['dsl-cards-only']);
  });

  it('treats an absent block and a null block the same', () => {
    const absent = JSON.parse(JSON.stringify(fixtureJson('run-a'))) as Record<string, unknown>;

    expect(readAnalysisRun(absent).claims).toBeNull();
    expect(readAnalysisRun(withClaims(null)).claims).toBeNull();
  });

  it('every committed fixture predates the block and still loads', () => {
    for (const name of ['run-a', 'run-b', 'run-strict', 'run-sparse'] as const) {
      expect(readAnalysisRun(fixtureJson(name)).claims, `${name} grew a claims block`).toBeNull();
    }
  });

  it('refuses an unmeasured capability that carries a measurement anyway', () => {
    const lying = { ...BLOCK, claims: [{ ...UNMEASURED, measured: 0, distance: -24 }] };

    expect(() => readAnalysisRun(withClaims(lying))).toThrowError(AnalysisDataError);
    expect(() => readAnalysisRun(withClaims(lying))).toThrowError(/carries no measurement/);
  });

  it('refuses a measured capability with its measurement withheld', () => {
    const hollow = { ...BLOCK, claims: [{ ...MET, measured: null }] };

    expect(() => readAnalysisRun(withClaims(hollow))).toThrowError(/must carry its measurement/);
  });

  it('refuses a distance that exists without a measurement, and the reverse', () => {
    const oneWay = { ...BLOCK, claims: [{ ...UNMEASURED, distance: -24 }] };
    const other = { ...BLOCK, claims: [{ ...MET, distance: null }] };

    expect(() => readAnalysisRun(withClaims(oneWay))).toThrowError(/a distance exists exactly when/);
    expect(() => readAnalysisRun(withClaims(other))).toThrowError(/a distance exists exactly when/);
  });

  it('names the field when a status or a unit is not one it knows', () => {
    const status = { ...BLOCK, claims: [{ ...MET, status: 'probably' }] };
    const unit = { ...BLOCK, claims: [{ ...MET, unit: 'furlongs' }] };

    expect(() => readAnalysisRun(withClaims(status))).toThrowError(/claims\.claims\[0\]\.status/);
    expect(() => readAnalysisRun(withClaims(unit))).toThrowError(/claims\.claims\[0\]\.unit/);
  });

  it('reads the provenance every share is out of', () => {
    const drafted = {
      ...BLOCK,
      limitsKind: 'shares-measured',
      draftProvenance: { seed: 'cube/availability/v0', drafts: 25, seatDrafts: 200 },
    };

    expect(readAnalysisRun(withClaims(drafted)).claims?.draftProvenance).toEqual({
      seed: 'cube/availability/v0',
      drafts: 25,
      seatDrafts: 200,
    });
  });
});
