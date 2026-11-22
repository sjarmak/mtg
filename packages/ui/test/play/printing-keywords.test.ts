/**
 * `mtg-oin1f`: two same-named tokens of different cards, told apart by the
 * keywords the backend says the object has. The fixtures are Wurmcoil Engine's
 * pair (the same name, colors, power and toughness; deathtouch against
 * lifelink), because that is the case nothing else the projection carries can
 * separate.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectView, TableView } from '@mtg/engine';
import type { PrintedCardPresentation } from '../../src/card/printed-card-art';
import { narrowByKeywords, printedKeywordsOf } from '../../src/card/printed-keywords';
import { OFFICIAL_TOKEN_PRINTINGS } from '../../src/card/token-printings';
import { backendBoardPosition } from '../../src/routes/play/backend-position';

const BASE = OFFICIAL_TOKEN_PRINTINGS[0]!;

function wurm(physicalId: string, oracleId: string, oracleText: string | null): PrintedCardPresentation {
  return {
    ...BASE,
    physicalId,
    oracleId,
    scryfallId: `00000000-0000-0000-0000-${oracleId.slice(-12)}`,
    name: 'Phyrexian Wurm',
    observedNames: ['Phyrexian Wurm Token'],
    typeLine: 'Token Artifact Creature — Phyrexian Wurm',
    power: '3',
    toughness: '3',
    colors: [],
    faces: [{ ...BASE.faces[0]!, name: 'Phyrexian Wurm', oracleText, colors: [] }],
  };
}

const DEATHTOUCH = wurm('tsom-token:0008', '00000000-0000-0000-0000-00000000000a', 'Deathtouch');
const LIFELINK = wurm('tsom-token:0009', '00000000-0000-0000-0000-00000000000b', 'Lifelink');

function token(keywords: readonly string[] | undefined): ObjectView {
  return {
    oid: 'foreign:wurm:1',
    name: 'Phyrexian Wurm Token',
    typeLine: 'Artifact Creature — Phyrexian Wurm',
    power: 3,
    toughness: 3,
    tapped: false,
    attacking: false,
    damage: 0,
    controller: 0,
    counters: {},
    characteristics: { colors: [], manaCost: null, token: true },
    ...(keywords === undefined ? {} : { keywords }),
  };
}

function frameOf(object: ObjectView, candidates: readonly PrintedCardPresentation[]): string | undefined {
  const view: TableView = {
    version: 4,
    turn: { number: 1, active: 0, phase: 'main', step: 'main' },
    priority: 0,
    stack: [],
    seats: [
      {
        id: 0,
        name: 'North',
        life: 20,
        hand: [],
        handSize: 0,
        librarySize: 0,
        graveyard: [],
        exile: [],
        battlefield: [object],
      },
      {
        id: 1,
        name: 'South',
        life: 20,
        hand: null,
        handSize: 0,
        librarySize: 0,
        graveyard: [],
        exile: [],
        battlefield: [],
      },
    ],
  };
  return backendBoardPosition(view, 0, candidates).you.battlefield.permanents[0]?.art?.printedFrame
    ?.physicalId;
}

describe('printedKeywordsOf', () => {
  it('reads a keyword line, lowercased, and drops reminder text', () => {
    const printing = wurm(
      'a',
      '00000000-0000-0000-0000-00000000000c',
      'Flying, first strike\nLifelink (Damage dealt gains life.)',
    );

    expect([...printedKeywordsOf(printing)].sort()).toEqual(['first strike', 'flying', 'lifelink']);
  });

  it('counts a whole fragment only, so a sentence that mentions a keyword states none', () => {
    const grants = wurm('a', '00000000-0000-0000-0000-00000000000c', 'Creatures you control have flying.');
    const vanilla = wurm('b', '00000000-0000-0000-0000-00000000000d', null);

    expect([...printedKeywordsOf(grants)]).toEqual([]);
    expect([...printedKeywordsOf(vanilla)]).toEqual([]);
  });
});

describe('narrowByKeywords', () => {
  it('keeps the printing whose keywords are exactly the ones the object has', () => {
    expect(narrowByKeywords(token(['lifelink']), [DEATHTOUCH, LIFELINK])).toEqual([LIFELINK]);
    expect(narrowByKeywords(token(['deathtouch']), [DEATHTOUCH, LIFELINK])).toEqual([DEATHTOUCH]);
  });

  it('compares inside the vocabulary, so a keyword it cannot name does not unseat a match', () => {
    expect(narrowByKeywords(token(['lifelink', 'protection from red']), [DEATHTOUCH, LIFELINK])).toEqual([
      LIFELINK,
    ]);
  });

  it('leaves both when a granted keyword makes each printing fit', () => {
    expect(narrowByKeywords(token(['deathtouch', 'lifelink']), [DEATHTOUCH, LIFELINK])).toEqual([
      DEATHTOUCH,
      LIFELINK,
    ]);
  });

  it('leaves every candidate when nothing fits or the backend reports no keywords', () => {
    expect(narrowByKeywords(token([]), [DEATHTOUCH, LIFELINK])).toEqual([DEATHTOUCH, LIFELINK]);
    expect(narrowByKeywords(token(['flying']), [DEATHTOUCH, LIFELINK])).toEqual([DEATHTOUCH, LIFELINK]);
    expect(narrowByKeywords(token(undefined), [DEATHTOUCH, LIFELINK])).toEqual([DEATHTOUCH, LIFELINK]);
  });

  it('drops a printing whose keyword the object no longer has, and never a vanilla one', () => {
    const vanilla = wurm('v', '00000000-0000-0000-0000-00000000000e', null);

    // Neither is exact, and a printing that states no keyword fits any token, so a gained keyword
    // leaves the vanilla one and the lifelink one both standing: the caller sees two, not one.
    expect(narrowByKeywords(token(['lifelink', 'flying']), [vanilla, LIFELINK])).toEqual([vanilla, LIFELINK]);
    expect(narrowByKeywords(token(['flying']), [vanilla, LIFELINK])).toEqual([vanilla]);
  });
});

describe('the board draws the printing the token is', () => {
  it('resolves each of two same-named, same-colored, same-sized tokens by its keyword', () => {
    expect(frameOf(token(['lifelink']), [DEATHTOUCH, LIFELINK])).toBe(LIFELINK.physicalId);
    expect(frameOf(token(['deathtouch']), [DEATHTOUCH, LIFELINK])).toBe(DEATHTOUCH.physicalId);
  });

  it('does not move with the order the catalog lists them in', () => {
    expect(frameOf(token(['lifelink']), [LIFELINK, DEATHTOUCH])).toBe(LIFELINK.physicalId);
  });

  it('draws the labeled pending frame when a granted keyword leaves both fitting', () => {
    expect(frameOf(token(['deathtouch', 'lifelink']), [DEATHTOUCH, LIFELINK])).toMatch(/^observed:/u);
  });

  it('draws the labeled pending frame when the backend reports no keywords', () => {
    expect(frameOf(token(undefined), [DEATHTOUCH, LIFELINK])).toMatch(/^observed:/u);
  });
});
