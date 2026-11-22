/**
 * The boundary the Analysis tab reads across.
 *
 * `@mtg/ui` cannot import this package — the arrow runs through `@mtg/decklab`
 * to `better-sqlite3` and `@mtg/ui` is bundled for a browser — so the block
 * crosses as a file. What that costs is checked here: the flags cannot write
 * somewhere no flag named, a tags file that is not card-id-to-names is refused
 * rather than coerced, and the block this tool emits is one the reader accepts.
 *
 * The last case is the acceptance criterion. A run with no tags file is a run
 * with no model key, and it has to produce a verdict naming the missing half.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SET_FILE_VERSION } from '@mtg/setgen';
// Reached by path, not by dependency: this is the seam the block crosses, and
// the test exists to prove both ends agree about it. `@mtg/cube` must never
// gain a dependency on `@mtg/ui`, nor the reverse.
import { readRunClaims } from '../../ui/src/routes/analysis/read';
import { UNTAGGED_REASON } from '../src/set-claims';
import { buildClaimsFile, parseClaimsArgs, readTags } from '../tools/analysis-claims';
import { DRAFTABLE_CRITERIA_INPUT, DRAFTABLE_SET } from './support/draftable-cube';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'cube-claims-'));
}

/** The set on disk the way a `setgen` run leaves it. */
function setFile(dir: string): string {
  const path = join(dir, 'set.json');
  writeFileSync(
    path,
    JSON.stringify({
      formatVersion: SET_FILE_VERSION,
      set: {
        code: DRAFTABLE_SET.code,
        name: DRAFTABLE_SET.name,
        theme: 'a drafted fixture',
        seed: 'cube/analysis-claims/test',
        profile: 'fixture v1',
      },
      cards: DRAFTABLE_SET.cards,
    }),
    'utf8',
  );
  return path;
}

function criteriaFile(dir: string): string {
  const path = join(dir, 'criteria.json');
  writeFileSync(path, JSON.stringify(DRAFTABLE_CRITERIA_INPUT), 'utf8');
  return path;
}

const REQUIRED = (dir: string): readonly string[] => [
  '--set',
  setFile(dir),
  '--criteria',
  criteriaFile(dir),
  '--out',
  join(dir, 'claims.json'),
];

describe('the claims tool flags', () => {
  it('refuses to write an artifact no flag named', () => {
    const dir = scratch();
    expect(() => parseClaimsArgs(['--set', setFile(dir), '--criteria', criteriaFile(dir)])).toThrow(
      '--out is required',
    );
  });

  it('refuses an unknown flag and a flag with no value', () => {
    const dir = scratch();
    expect(() => parseClaimsArgs([...REQUIRED(dir), '--nope', 'x'])).toThrow('unknown flag --nope');
    expect(() => parseClaimsArgs([...REQUIRED(dir), '--tags'])).toThrow('--tags needs a value');
  });

  it('reads the drafting dials and lets --no-draft say so without a value', () => {
    const dir = scratch();
    const args = parseClaimsArgs([...REQUIRED(dir), '--drafts', '3', '--draft-seed', 'abc', '--no-draft']);
    expect({ drafts: args.drafts, draftSeed: args.draftSeed, draft: args.draft }).toEqual({
      drafts: 3,
      draftSeed: 'abc',
      draft: false,
    });
    expect(() => parseClaimsArgs([...REQUIRED(dir), '--drafts', '0'])).toThrow('positive integer');
  });
});

describe('the tags file', () => {
  it('is validated rather than cast', () => {
    expect(() => readTags('[]', 'tags.json')).toThrow('card id to archetype names');
    expect(() => readTags('{"a": "azorius control"}', 'tags.json')).toThrow('array of archetype names');
    expect([...readTags('{"a": ["azorius control"]}', 'tags.json')]).toEqual([['a', ['azorius control']]]);
  });
});

describe('the block that crosses the boundary', () => {
  it('is one the Analysis reader accepts, and abstains on the model half with no tags', () => {
    const dir = scratch();
    const built = buildClaimsFile(parseClaimsArgs([...REQUIRED(dir), '--no-draft']));
    const block = readRunClaims(JSON.parse(built.json), 'claims');

    const archetypes = block.claims.filter((claim) => claim.capability === 'archetype-support');
    expect(archetypes.length).toBeGreaterThan(0);
    expect(archetypes.every((claim) => claim.status === 'unmeasured')).toBe(true);
    expect(archetypes.every((claim) => claim.detail === UNTAGGED_REASON)).toBe(true);
    expect(archetypes.every((claim) => claim.measured === null)).toBe(true);
    // The list this fixture states is four seats wider than the list it holds,
    // so the verdict is a miss with a number rather than a pass, and it is the
    // stated capacity that misses rather than the absent model.
    expect(built.ok).toBe(false);
    expect(
      block.claims
        .filter((claim) => claim.status === 'missed')
        .map((claim) => [claim.capability, claim.distance]),
    ).toEqual([['draft-capacity', -84]]);
    expect(block.claims.some((claim) => claim.capability === 'size' && claim.status === 'met')).toBe(true);
  });

  it('measures the tagged archetypes when it is handed the model half', () => {
    const dir = scratch();
    const tags = join(dir, 'tags.json');
    writeFileSync(
      tags,
      JSON.stringify(
        Object.fromEntries(
          DRAFTABLE_SET.cards.map((card) => [
            card.id,
            (card.kind === 'land' ? card.producesMana : card.colors).includes('G')
              ? ['mono-green stompy']
              : ['azorius control', 'azorius tempo'],
          ]),
        ),
      ),
      'utf8',
    );
    const built = buildClaimsFile(parseClaimsArgs([...REQUIRED(dir), '--tags', tags, '--drafts', '2']));
    const block = readRunClaims(JSON.parse(built.json), 'claims');

    expect(
      block.claims
        .filter((claim) => claim.capability === 'archetype-support')
        .every((claim) => claim.status !== 'unmeasured'),
    ).toBe(true);
    expect(block.draftProvenance?.drafts).toBe(2);
  });
});
