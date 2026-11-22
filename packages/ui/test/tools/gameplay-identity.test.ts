/**
 * Which set a game's card ids name, and what is refused.
 *
 * `../../tools/gameplay-identity.ts` is the one place a recorded game learns
 * its set, so the rules are pinned here: the basics a set never prints still
 * resolve, coverage picks between two sets and every id must then be inside the
 * winner, and the hashes are of the staged document and of the sorted ids.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '@mtg/sim';
import { identifyCards, setIdentitySources } from '../../tools/gameplay-identity';
import type { SetIdentitySource } from '../../tools/gameplay-identity';
import type { ResolvedSet } from '../../tools/resolve-set';

const TIDEGLASS = readFileSync('packages/setgen/fixtures/sets/tideglass-reach.set.json', 'utf8');

function resolved(json: string, what: string): ResolvedSet {
  return { ok: true, path: `/staged/${what}.json`, what, cardCount: 0, json };
}

const FIXTURE: SetIdentitySource = {
  code: 'SLC',
  sha256: 'a'.repeat(64),
  cards: [...FIXTURE_DECK_RW.cards, ...FIXTURE_DECK_UB.cards],
};

describe('a staged set as an identity source', () => {
  const [source] = setIdentitySources([{ set: resolved(TIDEGLASS, 'tideglass'), selected: true }]);
  if (source === undefined) throw new Error('no source');

  it('carries the set code, the sha256 of the document, and the basics it never printed', () => {
    const document = JSON.parse(TIDEGLASS) as { set: { code: string }; cards: unknown[] };
    expect(source.code).toBe(document.set.code);
    expect(source.sha256).toBe(createHash('sha256').update(TIDEGLASS).digest('hex'));
    const ids = source.cards.map((card) => card.id);
    expect(ids).toContain(`${document.set.code.toLowerCase()}-swamp`);
    expect(ids.length).toBeGreaterThan(document.cards.length);
  });

  it('resolves a deck built with the minted basics', () => {
    const swamp = `${source.code.toLowerCase()}-swamp`;
    const printed = source.cards[0];
    if (printed === undefined) throw new Error('no cards');
    const identity = identifyCards([printed.id, swamp, swamp], [source]);
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    expect(identity.setCode).toBe(source.code);
    expect(identity.setSha256).toBe(source.sha256);
    expect(identity.cardById.get(swamp)?.name).toBe('Swamp');
  });
});

describe('identifying a game by its card ids', () => {
  const ids = FIXTURE_DECK_RW.cards.map((card) => card.id);

  it('hashes the sorted distinct ids, so deck order does not change the identity', () => {
    const forward = identifyCards(ids, [FIXTURE]);
    const reversed = identifyCards([...ids].reverse(), [FIXTURE]);
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(forward.cardsSha256).toBe(reversed.cardsSha256);
    const expected = createHash('sha256')
      .update([...new Set(ids)].sort().join('\n'))
      .digest('hex');
    expect(forward.cardsSha256).toBe(expected);
  });

  it('refuses an id no staged set prints, naming it', () => {
    const refused = identifyCards([...ids, 'elsewhere-dragon'], [FIXTURE]);
    expect(refused).toMatchObject({ ok: false });
    if (refused.ok) return;
    expect(refused.message).toContain('"elsewhere-dragon"');
    expect(identifyCards(['elsewhere-dragon'], [])).toMatchObject({
      ok: false,
      message: expect.stringContaining('no sets were staged'),
    });
    expect(identifyCards([], [FIXTURE])).toMatchObject({ ok: false, message: 'the game names no cards' });
  });

  it('picks the set covering the most ids and then requires every id to be inside it', () => {
    const [shared, ...rest] = FIXTURE_DECK_RW.cards;
    if (shared === undefined) throw new Error('no cards');
    const narrow: SetIdentitySource = { code: 'NAR', sha256: 'b'.repeat(64), cards: [shared] };
    const wide: SetIdentitySource = { code: 'WID', sha256: 'c'.repeat(64), cards: [shared, ...rest] };
    const won = identifyCards(ids, [narrow, wide]);
    expect(won).toMatchObject({ ok: true, setCode: 'WID', setSha256: 'c'.repeat(64) });

    const rw = new Set(ids);
    const sharedUb = FIXTURE_DECK_UB.cards.find((card) => !rw.has(card.id));
    if (sharedUb === undefined) throw new Error('no card outside the RW deck');
    const other: SetIdentitySource = { code: 'OTH', sha256: 'd'.repeat(64), cards: [sharedUb] };
    const split = identifyCards([...ids, sharedUb.id], [wide, other]);
    expect(split).toMatchObject({ ok: false });
    if (split.ok) return;
    expect(split.message).toContain('WID');
    expect(split.message).toContain(JSON.stringify(sharedUb.id));

    // A tie goes to the first entry, which is the launcher's own ranking.
    expect(identifyCards([shared.id], [narrow, wide])).toMatchObject({ ok: true, setCode: 'NAR' });
  });
});
