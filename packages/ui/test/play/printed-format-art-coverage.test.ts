/**
 * Pins oldest-printing selection against the real, committed ISD, AKH/HOU,
 * SOM and KLD/AER bundles, and verifies each format leaves zero cards or
 * tokens without art (`mtg-j4ucd.2`, `mtg-j4ucd.22`). DKA's two Vampires are
 * told apart by keyword against its real token printings (`mtg-oin1f`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ObjectView, SeatId, TableView } from '@mtg/engine';
import { loadPrintedFormat } from '../../src/lab/printed-format';
import type { LoadedPrintedFormat } from '../../src/lab/printed-format';
import { backendBoardPosition } from '../../src/routes/play/backend-position';
import type { PrintedCardPresentation } from '../../src/card/printed-card-art';

const readJson = (root: string, name: string): unknown => JSON.parse(readFileSync(`${root}/${name}`, 'utf8'));
const fetchFrom =
  (root: string) =>
  async (url: string): Promise<unknown> =>
    readJson(root, url.split('/').at(-1)!);

const availability = {
  browse: 'available' as const,
  draft: 'available' as const,
  sealed: 'available' as const,
  play: { status: 'unavailable' as const, reason: 'fixture only, no Forge admission asserted here' },
};

const isdRoot = 'packages/data/data/isd';
const isdRow = {
  id: 'isd',
  name: 'Innistrad',
  availability,
  formatUrl: 'formats/isd/isd-limited-format-v1.json',
  displayMetadataUrl: 'formats/isd/isd-display-metadata-v1.json',
  tokenPrintingsUrl: 'formats/isd/isd-token-printings-v1.json',
  catalogs: [{ code: 'ISD', url: 'formats/isd/isd-printed-catalog-v1.json' }],
};

const akhHouRoot = 'packages/data/data/akh-hou';
const akhHouRow = {
  id: 'akh-hou',
  name: 'Amonkhet / Hour of Devastation',
  availability,
  formatUrl: 'formats/akh-hou/akh-hou-limited-format-v1.json',
  displayMetadataUrl: 'formats/akh-hou/akh-hou-display-metadata-v1.json',
  tokenPrintingsUrl: 'formats/akh-hou/akh-hou-token-printings-v1.json',
  catalogs: ['AKH', 'HOU', 'MP2'].map((code) => ({
    code,
    url: `formats/akh-hou/${code.toLowerCase()}-printed-catalog-v1.json`,
  })),
};

const somRoot = 'packages/data/data/som';
const somRow = {
  id: 'som',
  name: 'Scars of Mirrodin',
  availability,
  formatUrl: 'formats/som/som-limited-format-v1.json',
  displayMetadataUrl: 'formats/som/som-display-metadata-v1.json',
  tokenPrintingsUrl: 'formats/som/som-token-printings-v1.json',
  catalogs: [{ code: 'SOM', url: 'formats/som/som-printed-catalog-v1.json' }],
};

const dkaRoot = 'packages/data/data/dka';
const dkaRow = {
  id: 'dka',
  name: 'Dark Ascension / Innistrad',
  availability,
  formatUrl: 'formats/dka/dka-limited-format-v1.json',
  displayMetadataUrl: 'formats/dka/dka-display-metadata-v1.json',
  tokenPrintingsUrl: 'formats/dka/dka-token-printings-v1.json',
  catalogs: [
    { code: 'DKA', url: 'formats/dka/dka-printed-catalog-v1.json' },
    { code: 'ISD', url: 'formats/dka/isd-printed-catalog-v1.json' },
  ],
};

const kldAerRoot = 'packages/data/data/kld-aer';
const kldAerRow = {
  id: 'kld-aer',
  name: 'Kaladesh / Aether Revolt',
  availability,
  formatUrl: 'formats/kld-aer/kld-aer-limited-format-v1.json',
  displayMetadataUrl: 'formats/kld-aer/kld-aer-display-metadata-v1.json',
  tokenPrintingsUrl: 'formats/kld-aer/kld-aer-token-printings-v1.json',
  catalogs: [
    { code: 'AER', url: 'formats/kld-aer/aer-printed-catalog-v1.json' },
    { code: 'KLD', url: 'formats/kld-aer/kld-printed-catalog-v1.json' },
    { code: 'MPS', url: 'formats/kld-aer/mps-printed-catalog-v1.json' },
  ],
};

/** The same rarity/setCode join `PrintedFormatRoute.ts` does for a live session. */
function presentations(loaded: LoadedPrintedFormat): readonly PrintedCardPresentation[] {
  const cards = loaded.catalogs.flatMap((source) =>
    source.catalog.cards.map((card) => ({
      ...card,
      setCode: source.code,
      ...(loaded.rarities[card.physicalId] === undefined ? {} : { rarity: loaded.rarities[card.physicalId] }),
    })),
  );
  return [...cards, ...loaded.tokens];
}

function permanent(
  oid: string,
  name: string,
  typeLine: string,
  stated: Partial<Pick<ObjectView, 'characteristics' | 'keywords'>> = {},
): ObjectView {
  return {
    oid,
    name,
    typeLine,
    power: null,
    toughness: null,
    tapped: false,
    attacking: false,
    damage: 0,
    controller: 0 as SeatId,
    counters: {},
    ...stated,
  };
}

function tableWith(object: ObjectView): TableView {
  return {
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
}

describe('printed-format art coverage (ISD, AKH/HOU, SOM, KLD/AER)', () => {
  it('ISD: every catalog card and every token printing carries art, none missing', async () => {
    const loaded = await loadPrintedFormat(isdRow, fetchFrom(isdRoot));
    const cards = presentations(loaded);
    expect(cards).toHaveLength(264 + 12);
    expect(cards.filter((card) => card.art.status === 'missing').map((card) => card.physicalId)).toEqual([]);
  });

  it('AKH/HOU: every catalog card across AKH, HOU and MP2, and every token printing, carries art', async () => {
    const loaded = await loadPrintedFormat(akhHouRow, fetchFrom(akhHouRoot));
    const cards = presentations(loaded);
    expect(cards).toHaveLength(287 + 209 + 54 + 12);
    expect(cards.filter((card) => card.art.status === 'missing').map((card) => card.physicalId)).toEqual([]);
  });

  it('SOM: every catalog card and every bound token printing carries art, none missing', async () => {
    const loaded = await loadPrintedFormat(somRow, fetchFrom(somRoot));
    const cards = presentations(loaded);
    expect(cards).toHaveLength(249 + 9);
    expect(cards.filter((card) => card.art.status === 'missing').map((card) => card.physicalId)).toEqual([]);
  });

  it("SOM: Wurmcoil Engine's two Phyrexian Wurm tokens are told apart by the keyword each has (mtg-bn1ah)", async () => {
    // Scryfall prints them as TSOM 8 and 9, "Wurm", type "Wurm"; Forge creates "Phyrexian Wurm Token" with
    // type "Phyrexian Wurm". The name-and-type binder still refuses the match, so both are bound with a
    // stated alias from the Forge name; the deathtouch/lifelink keyword each carries then separates them
    // the same way DKA's two Vampires are (`mtg-oin1f`).
    const loaded = await loadPrintedFormat(somRow, fetchFrom(somRoot));
    const cards = presentations(loaded);
    expect(cards.filter((card) => /wurm/iu.test(card.name) && /^Token\b/u.test(card.typeLine))).toHaveLength(
      2,
    );
    const wurm = (keywords: readonly string[] | undefined): string | undefined =>
      backendBoardPosition(
        tableWith(
          permanent('foreign:wurm:1', 'Phyrexian Wurm Token', 'Artifact Creature — Phyrexian Wurm', {
            characteristics: { colors: [], manaCost: null, token: true },
            ...(keywords === undefined ? {} : { keywords }),
          }),
        ),
        0,
        cards,
      ).you.battlefield.permanents[0]?.art?.printedFrame?.physicalId;

    expect(wurm(['deathtouch'])).toMatch(/^tsom-token:0008:/u);
    expect(wurm(['lifelink'])).toMatch(/^tsom-token:0009:/u);
    // A backend that reports no keywords states nothing that separates them.
    expect(wurm(undefined)).toMatch(/^observed:/u);
  });

  it('KLD/AER: every catalog card across AER, KLD and the Kaladesh Inventions masterpieces, and every bound token printing, carries art', async () => {
    const loaded = await loadPrintedFormat(kldAerRow, fetchFrom(kldAerRoot));
    const cards = presentations(loaded);
    expect(cards).toHaveLength(197 + 278 + 54 + 10);
    expect(cards.filter((card) => card.art.status === 'missing').map((card) => card.physicalId)).toEqual([]);
  });

  it("KLD/AER: Wurmcoil Engine's two Phyrexian Wurm tokens are told apart by the keyword each has (mtg-bn1ah)", async () => {
    // Wurmcoil Engine is reprinted as a Kaladesh Inventions (MPS) masterpiece; a masterpiece prints no token
    // sheet of its own, so the tokens it makes are bound from Scars of Mirrodin's own TSOM 8/9 printings,
    // the same stated alias and keyword split as the SOM case.
    const loaded = await loadPrintedFormat(kldAerRow, fetchFrom(kldAerRoot));
    const cards = presentations(loaded);
    expect(cards.filter((card) => /wurm/iu.test(card.name) && /^Token\b/u.test(card.typeLine))).toHaveLength(
      2,
    );
    const wurm = (keywords: readonly string[] | undefined): string | undefined =>
      backendBoardPosition(
        tableWith(
          permanent('foreign:wurm:1', 'Phyrexian Wurm Token', 'Artifact Creature — Phyrexian Wurm', {
            characteristics: { colors: [], manaCost: null, token: true },
            ...(keywords === undefined ? {} : { keywords }),
          }),
        ),
        0,
        cards,
      ).you.battlefield.permanents[0]?.art?.printedFrame?.physicalId;

    expect(wurm(['deathtouch'])).toMatch(/^tsom-token:0008:/u);
    expect(wurm(['lifelink'])).toMatch(/^tsom-token:0009:/u);
    expect(wurm(undefined)).toMatch(/^observed:/u);
  });

  it('DKA: the 1/1 lifelink and the 2/2 flying Vampire tokens are told apart by the keyword each has (mtg-oin1f)', async () => {
    // Both are black and both come out of Forge as "Vampire Token", from two different oracle ids, so
    // neither the colors nor the age of a printing separate them; the keyword the backend projects does.
    const loaded = await loadPrintedFormat(dkaRow, fetchFrom(dkaRoot));
    const cards = presentations(loaded);
    const vampire = (keywords: readonly string[] | undefined): string | undefined =>
      backendBoardPosition(
        tableWith(
          permanent('foreign:vampire:1', 'Vampire Token', 'Creature — Vampire', {
            characteristics: { colors: ['B'], manaCost: null, token: true },
            ...(keywords === undefined ? {} : { keywords }),
          }),
        ),
        0,
        cards,
      ).you.battlefield.permanents[0]?.art?.printedFrame?.physicalId;

    expect(vampire(['lifelink'])).toMatch(/^tdka-token:0002:/u);
    expect(vampire(['flying'])).toMatch(/^tisd-token:0005:/u);
    // A granted keyword leaves both printings fitting: withhold the picture rather than guess.
    expect(vampire(['lifelink', 'flying'])).toMatch(/^observed:/u);
    // A backend that reports no keywords states nothing that separates them.
    expect(vampire(undefined)).toMatch(/^observed:/u);
  });

  it("resolves ISD's real triple-printed Zombie token to its oldest, lowest-position TISD row rather than going blank", async () => {
    const loaded = await loadPrintedFormat(isdRow, fetchFrom(isdRoot));
    const cards = presentations(loaded);
    const view = tableWith(permanent('foreign:zombie:1', 'Zombie Token', 'Creature — Zombie'));
    const position = backendBoardPosition(view, 0, cards);
    expect(position.you.battlefield.permanents[0]?.art?.printedFrame?.physicalId).toBe(
      'tisd-token:0007:c9a85357-3cad-4a1e-805b-ea4146d8b05f',
    );
  });

  it('resolves AKH/HOU\'s real "Cinder Barrens" reprint to the older AKH row rather than going blank', async () => {
    const loaded = await loadPrintedFormat(akhHouRow, fetchFrom(akhHouRoot));
    const cards = presentations(loaded);
    const view = tableWith(permanent('foreign:cinder-barrens:1', 'Cinder Barrens', 'Land'));
    const position = backendBoardPosition(view, 0, cards);
    expect(position.you.battlefield.permanents[0]?.art?.printedFrame?.physicalId).toBe(
      'akh-printed-v1:0280:e12fa835-c13d-4d73-9d26-97bc2268e971',
    );
  });
});
