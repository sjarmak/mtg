/**
 * One `canonicalJson`, measured against everything in the checkout that a
 * change to it would silently move.
 *
 * `@mtg/dsl` and `@mtg/llm` each declared a canonicalizer until mtg-bc2.135
 * merged them. The allowlist entry that kept them apart claimed merging "would
 * change what card fingerprints hash to"; both halves of that were measured
 * false, and this file is what keeps the measurement rather than the claim.
 *
 * Two corpora, because the function feeds two hashes in two packages:
 *
 *  - **Fixture keys.** Every recorded response is stored as `<key>.json`, where
 *    the key is `sha256(canonicalJson({v, system, prompt, schema}))` truncated
 *    to 32 characters. Re-deriving each key from the request the file itself
 *    records and comparing it to the file name is the strongest available proof
 *    that no key moved: a shifted canonicalizer orphans every fixture behind it
 *    and turns a hermetic run into `FixtureMissingError`.
 *  - **Card fingerprints.** The committed `tideglass-reach` set is 90 real
 *    generated cards, digested here as one line per card. `@mtg/dsl`'s own
 *    `canonical-json.test.ts` pins the sixteen example cards individually; this
 *    is the wider corpus.
 *
 * A failure here is not a number to update. It means fingerprints or fixture
 * keys have moved, and moving either is a re-record, not a refactor.
 *
 * The card digest has been re-recorded twice. First when slice A of the
 * ability model (mtg-bc2.132.1) gave every card an `abilities` field and
 * `normalize`, a deny list, carried it into both hashes: deleting `abilities`
 * from the normalized record reproduced the previous digest over all 90 cards
 * exactly, so the field was the whole of the move. Second when the cost-
 * modification work (mtg-bc2.152.6) gave every card a `costReduction` field
 * (CR 601.2f) and every cost a `manaCost.hasX` field (CR 601.2b/107.3f):
 * neither is in `normalize`'s deny list, because a spell that reduces costs or
 * carries an announced X is mechanically a different card, which is the same
 * argument `abilities` settled. Stripping both fields from the normalized
 * record reproduced the previous digest over all 90 cards exactly (every card
 * in this fixture prints `costReduction: null` and `hasX: false`, so the two
 * fields alone account for the whole move). The fixture-key half did not move
 * at all in either re-recording, which is the check above and is what keeps
 * the recorded responses reachable.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardFingerprint, mechanicalFingerprint, parseCards } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { FIXTURE_KEY_VERSION, fixtureKey } from '@mtg/llm';

const ROOT = new URL('../../../', import.meta.url).pathname;

/** The set `npm run play` falls back to, and the widest committed card corpus. */
const SET_PATH = join(ROOT, 'packages/setgen/fixtures/sets/tideglass-reach.set.json');

/** `sha256` of one `id cardFingerprint mechanicalFingerprint` line per card. */
const SET_DIGEST = '699c76a9da6b8097be948dd1ec77dbea37a10628f189fc512cec2eaeda26aedb';

/** Recorded at the merge. New recordings add to the corpus; none may leave it. */
const RECORDED_FIXTURES = 24;

interface Recorded {
  readonly file: string;
  readonly key: string;
  readonly system: string;
  readonly prompt: string;
  readonly schema: Record<string, unknown>;
}

/** Every `<key>.json` under a package's `fixtures/llm`, read as its request identity. */
function recordedFixtures(): readonly Recorded[] {
  const out: Recorded[] = [];
  for (const pkg of readdirSync(join(ROOT, 'packages')).sort()) {
    const dir = join(ROOT, 'packages', pkg, 'fixtures', 'llm');
    let names: readonly string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
      const doc = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
        key?: unknown;
        request?: { system?: unknown; prompt?: unknown; schema?: unknown };
      };
      const request = doc.request;
      if (
        typeof doc.key !== 'string' ||
        request === undefined ||
        typeof request.system !== 'string' ||
        typeof request.prompt !== 'string' ||
        request.schema === null ||
        typeof request.schema !== 'object'
      ) {
        throw new Error(`${pkg}/${name} is not a recorded fixture: it states no keyed request`);
      }
      out.push({
        file: `${pkg}/${name}`,
        key: doc.key,
        system: request.system,
        prompt: request.prompt,
        schema: request.schema as Record<string, unknown>,
      });
    }
  }
  return out;
}

/** The set document's `cards`, parsed rather than trusted: a bad fixture is a red test. */
function committedSetCards(): readonly Card[] {
  const doc = JSON.parse(readFileSync(SET_PATH, 'utf8')) as { cards?: unknown };
  if (!Array.isArray(doc.cards)) throw new Error(`${SET_PATH} states no card list`);
  return parseCards(doc.cards);
}

const FIXTURES = recordedFixtures();
const CARDS = committedSetCards();

describe('the corpus behind the canonicalJson merge', () => {
  it('is populated on both sides, so nothing below passes vacuously', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(RECORDED_FIXTURES);
    expect(new Set(FIXTURES.map((fixture) => fixture.file.split('/')[0])).size).toBeGreaterThanOrEqual(3);
    expect(CARDS.length).toBe(90);
    expect(FIXTURE_KEY_VERSION).toBe(1);
  });

  it('re-derives every recorded fixture key from the request the fixture states', () => {
    const moved = FIXTURES.filter(
      (fixture) =>
        fixtureKey({ system: fixture.system, prompt: fixture.prompt, jsonSchema: fixture.schema }) !==
        fixture.key,
    );
    expect(moved.map((fixture) => fixture.file)).toEqual([]);
  });

  it('stores every fixture under the file name its key derives', () => {
    const misfiled = FIXTURES.filter((fixture) => !fixture.file.endsWith(`/${fixture.key}.json`));
    expect(misfiled.map((fixture) => fixture.file)).toEqual([]);
  });

  it('fingerprints the committed set to the digest recorded above', () => {
    const lines = CARDS.map((card) => `${card.id} ${cardFingerprint(card)} ${mechanicalFingerprint(card)}`);
    const digest = createHash('sha256')
      .update(`${lines.join('\n')}\n`, 'utf8')
      .digest('hex');
    expect(digest).toBe(SET_DIGEST);
  });
});
