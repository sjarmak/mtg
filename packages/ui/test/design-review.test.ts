/**
 * The proof sheet: `tools/design-review-page.ts` and its argument reader.
 *
 * Two claims here are the reason the tool exists, and everything else is a
 * refusal.
 *
 * The first is **self-containment**. The page's whole job is to be one file a
 * reviewer opens on a machine that is not this one, behind a content policy
 * that blocks every origin but the font host. A page that reaches out for its
 * illustrations looks identical here and arrives as a grid of broken frames
 * there, so the only place that difference is visible is a test that reads the
 * emitted markup and refuses an outside origin.
 *
 * The second is that the faces are **the real faces**. The tool renders the
 * same `Card` component the lab draws and the same stylesheet, rather than a
 * second drawing of a card that would be free to disagree with the one the set
 * actually prints — the reviewer's flags are only worth acting on if the thing
 * they flagged is the thing that ships.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCards } from '@mtg/dsl';
import { CHANGE_STATES, readChanges, readDesignReviewArgs, readThumbs } from '../tools/design-review-args';
import { reviewPage, reviewRows } from '../tools/design-review-page';
import type { ChangeNote, Thumb } from '../tools/design-review-page';

const FIXTURE = new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url);

function setDocument(): { readonly set: { readonly name: string }; readonly cards: readonly unknown[] } {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    set: { name: string };
    cards: readonly unknown[];
  };
}

/** A one-pixel WebP, so a thumbnail in a test is a real data URI and not a stub string. */
const PIXEL = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

const CHANGES: readonly ChangeNote[] = [
  { asked: 'There are no enchantments.', state: 'done', now: '9 enchantments', note: 'Auras and statics.' },
  { asked: 'Removal is hyper powerful.', state: 'open', now: '40 removal effects', note: 'Unmoved.' },
];

describe('the flags the proof sheet is driven by', () => {
  it('needs a set, a thumbnail map and a destination, and says which is missing', () => {
    expect(readDesignReviewArgs(['--thumbs', 't.json', '--out', 'o.html'])).toContain('--set is required');
    expect(readDesignReviewArgs(['--set', 's.json', '--out', 'o.html'])).toContain('--thumbs is required');
    expect(readDesignReviewArgs(['--set', 's.json', '--thumbs', 't.json'])).toContain('--out is required');
  });

  it('refuses a bare word where a flag belongs, rather than reading past it', () => {
    expect(readDesignReviewArgs(['s.json', '--thumbs', 't.json'])).toContain('expected a --flag');
    expect(readDesignReviewArgs(['--set'])).toContain('--set needs a value');
  });

  it('reads the optional flags and leaves them undefined when absent', () => {
    const args = readDesignReviewArgs(['--set', 's.json', '--thumbs', 't.json', '--out', 'o.html']);
    expect(typeof args).not.toBe('string');
    if (typeof args === 'string') return;
    expect(args).toEqual({
      set: 's.json',
      thumbs: 't.json',
      out: 'o.html',
      changes: undefined,
      title: undefined,
      setName: undefined,
    });
  });
});

describe('the thumbnail map', () => {
  it('refuses a thumbnail the page would have to fetch', () => {
    expect(() => readThumbs({ 'a-card': { src: 'https://example.test/a.webp' } }, 'thumbs.json')).toThrow(
      /no data: URI/,
    );
  });

  it('refuses an entry that is not an object, naming the card it was under', () => {
    expect(() => readThumbs({ 'a-card': 'a.webp' }, 'thumbs.json')).toThrow(/a-card is not an object/);
    expect(() => readThumbs([], 'thumbs.json')).toThrow(/not an object of card id to thumbnail/);
  });

  it('takes a missing alt as empty rather than refusing the entry', () => {
    const thumbs = readThumbs({ 'a-card': { src: PIXEL } }, 'thumbs.json');
    expect(thumbs.get('a-card')).toEqual({ src: PIXEL, alt: '' });
  });
});

describe('the change notes', () => {
  it('refuses a state nobody defined', () => {
    const note = { asked: 'a', now: 'b', note: 'c', state: 'nearly' };
    expect(() => readChanges([note], 'changes.json')).toThrow(/state must be one of/);
    for (const state of CHANGE_STATES) {
      expect(readChanges([{ ...note, state }], 'changes.json')[0]?.state).toBe(state);
    }
  });

  it('refuses an empty field rather than printing a blank row', () => {
    expect(() => readChanges([{ asked: '', now: 'b', note: 'c', state: 'open' }], 'changes.json')).toThrow(
      /\.asked must be a non-empty string/,
    );
    expect(() => readChanges({}, 'changes.json')).toThrow(/not an array of change notes/);
  });
});

describe('the rows the sheet is built from', () => {
  it('refuses anything that is not a set document', () => {
    expect(() => reviewRows({}, new Map())).toThrow(/no "cards"/);
    expect(() => reviewRows({ cards: 'all of them' }, new Map())).toThrow(/is not an array/);
  });

  it('prints every card of the set once, in collector order', () => {
    const document = setDocument();
    const rows = reviewRows({ ...document, cards: [...document.cards].reverse() }, new Map());
    expect(rows).toHaveLength(document.cards.length);
    const numbers = rows.map((row) => row.card.set.collectorNumber);
    expect(numbers).toEqual([...numbers].sort((left, right) => left - right));
  });

  it('attaches a thumbnail by card id and leaves the rest without art', () => {
    const document = setDocument();
    const first = parseCards(document.cards)[0];
    if (first === undefined) throw new Error('the fixture has no cards');
    const thumbs = new Map<string, Thumb>([[first.id, { src: PIXEL, alt: 'a picture' }]]);
    const rows = reviewRows(document, thumbs);
    const withArt = rows.filter((row) => row.art !== null);
    expect(withArt).toHaveLength(1);
    expect(withArt[0]?.art).toEqual({ src: PIXEL, alt: 'a picture' });
    expect(rows.filter((row) => row.art === null)).toHaveLength(rows.length - 1);
  });

  it("carries the drafter's own valuation rather than a second one", () => {
    const rows = reviewRows(setDocument(), new Map());
    expect(rows.every((row) => Number.isFinite(row.score))).toBe(true);
    expect(new Set(rows.map((row) => row.score)).size).toBeGreaterThan(1);
    expect(rows.every((row) => row.manaValue >= 0)).toBe(true);
  });
});

describe('the page a reviewer is handed', () => {
  const document = setDocument();
  const cards = parseCards(document.cards);
  const thumbs = new Map<string, Thumb>(
    cards.slice(0, 3).map((card) => [card.id, { src: PIXEL, alt: `${card.name} illustration` }] as const),
  );
  const html = reviewPage({
    title: 'Tideglass Proof Sheet',
    setName: document.set.name,
    document,
    thumbs,
    changes: CHANGES,
  });

  it('reaches no host but the font host', () => {
    const origins = [...html.matchAll(/https?:\/\/[^"'\s)]+/g)].map(([url]) => new URL(url).host);
    expect(new Set(origins)).toEqual(new Set(['fonts.googleapis.com', 'fonts.gstatic.com']));
    expect(html).not.toContain('src="/');
    expect(html).not.toContain('href="/');
  });

  it('inlines each illustration it was given and draws its own mana symbols', () => {
    expect([...html.matchAll(/data:image\/webp;base64,/g)]).toHaveLength(thumbs.size);
    expect(html).not.toContain('/symbols/');
    expect(html).not.toContain('svgs.scryfall.io');
  });

  it('names the set and the round in the head and the masthead', () => {
    expect(html).toContain('<title>Tideglass Proof Sheet</title>');
    expect(html).toContain(document.set.name);
    for (const change of CHANGES) {
      expect(html).toContain(change.asked);
      expect(html).toContain(change.now);
    }
  });

  it('gives every card a tile the filter bar can find it by', () => {
    const tiles = [...html.matchAll(/data-index="\d+"/g)];
    expect(tiles).toHaveLength(cards.length);
    for (const facet of ['data-identity=', 'data-rarity=', 'data-type=', 'data-mv=', 'data-search=']) {
      expect([...html.matchAll(new RegExp(facet, 'g'))].length).toBeGreaterThanOrEqual(cards.length);
    }
  });

  it('carries the flag control and the copy-out, so the pass needs no server', () => {
    expect([...html.matchAll(/>Flag</g)]).toHaveLength(cards.length);
    expect(html).toContain('Copy flagged cards');
    expect(html).not.toContain('fetch(');
    expect(html).not.toContain('XMLHttpRequest');
  });
});
