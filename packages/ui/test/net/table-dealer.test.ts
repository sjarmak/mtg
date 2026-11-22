/**
 * What the Play page's button actually deals.
 *
 * `tools/table-dealer.ts` is the function `npm run play` hands to the game
 * server, and it is where a press turns into a game. The claims worth pinning
 * are the ones a person would notice being wrong:
 *
 *  - Two seats, two tokens, and the *host's* token is the one the caller keeps.
 *    Handing back the guest's would seat the person who pressed the button in
 *    the seat they meant to give away.
 *  - The invite carries the guest and not the host. That is `netplay-links.ts`'s
 *    rule and this is the second caller of it, so the second chance to get it
 *    wrong.
 *  - Every table is a new table. A dealer that reused a seed would deal one
 *    person's shuffle to everybody who pressed the button after them.
 *  - Written decks when the set has two of them, sealed pools otherwise, which
 *    is the rule `netplay.ts` follows from a flag and this one follows from what
 *    is on disk.
 *  - The addresses are read at deal time, not at boot. A laptop that joined a
 *    network after the lab started has an address the launcher never saw.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { PRECON_FORMAT_VERSION } from '@mtg/deckbuild';
import type { PreconFile } from '@mtg/deckbuild';
import type { DealtSeats } from '@mtg/netplay';
import type { InterfaceInfo } from '../../tools/lan-address';
import { DEALER_NAMES, roomDealer, tableDealer } from '../../tools/table-dealer';

const CARDS = EXAMPLE_CARDS;

/** One LAN interface, which is what a link is built from. */
const INTERFACES: Readonly<Record<string, readonly InterfaceInfo[] | undefined>> = {
  eth0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
};

/** The basic every written deck here is filled out with. */
const PLAINS = 'Plains';

/**
 * Every card name the host seat can see, which is the deck it was dealt.
 *
 * The library is concealed from its own seat and its entries are opaque strings,
 * so counting them says nothing about which branch dealt them; the objects the
 * seat can see carry real cards, and the two branches deal different ones.
 */
function dealtNames(dealt: DealtSeats): ReadonlySet<string> {
  const names = new Set<string>();
  for (const object of Object.values(dealt.table.snapshotFor(0).state.objects)) {
    names.add(object.card.name);
  }
  return names;
}

function ids(): () => string {
  let n = 0;
  return (): string => {
    n += 1;
    return `id-${String(n)}`;
  };
}

/** Two written decks over one example card, which is all `seatsTwo` looks at. */
function preconFile(): PreconFile {
  const first = CARDS[0];
  if (first === undefined) throw new Error('the DSL example set is empty');
  const deck = (id: string, name: string): PreconFile['decks'][number] => ({
    id,
    name,
    plan: 'Cast the one card it has, repeatedly.',
    payoff: first.id,
    spells: [{ id: first.id, count: 24 }],
    basics: { W: 16 },
    deckSize: 40,
  });
  return {
    formatVersion: PRECON_FORMAT_VERSION,
    setCode: 'EXA',
    decks: [deck('one', 'Deck one'), deck('two', 'Deck two')],
  };
}

describe('the table the Play button deals', () => {
  it('keeps the host seat and hands out the other one', () => {
    const deal = tableDealer({
      set: CARDS,
      precons: null,
      webPort: 5173,
      interfaces: () => INTERFACES,
      newId: ids(),
    });
    const dealt = deal();

    // Seat 0's token, which is `HOST_SEAT` and the seat the invite deals from.
    expect(dealt.table.seatOf(dealt.hostToken)).toBe(0);
    expect(dealt.invite?.hostSeat).toBe(0);
    // One guest, addressed by a link, and the host's own capability is not in it.
    expect(dealt.invite?.guests).toHaveLength(1);
    expect(JSON.stringify(dealt.invite)).not.toContain(dealt.hostToken);
    const url = dealt.invite?.guests[0]?.links[0]?.url ?? '';
    expect(url).toContain('http://192.168.1.20:5173/#/play/constructed?table=');
    // And that link addresses the other seat, rather than being decoration.
    const guestToken = url.slice(url.indexOf('table=') + 'table='.length);
    expect(dealt.table.seatOf(guestToken)).toBe(1);
  });

  it('names both seats, so the invite says who the link is for', () => {
    const deal = tableDealer({
      set: CARDS,
      precons: null,
      webPort: 5173,
      interfaces: () => INTERFACES,
      newId: ids(),
    });
    expect(deal().invite?.guests[0]?.name).toBe(DEALER_NAMES[1]);
  });

  it('deals a different table every time it is pressed', () => {
    const deal = tableDealer({
      set: CARDS,
      precons: null,
      webPort: 5173,
      interfaces: () => INTERFACES,
      newId: ids(),
    });
    const first = deal();
    const second = deal();
    expect(second.hostToken).not.toBe(first.hostToken);
    expect(second.table.id).not.toBe(first.table.id);
    // Neither table answers to the other's link, which is what makes two
    // simultaneous games two games.
    expect(second.table.seatOf(first.hostToken)).toBeNull();
  });

  it('seats the written decks when the set has two, and sealed pools when it has none', () => {
    const shared = {
      set: CARDS,
      webPort: 5173,
      interfaces: (): typeof INTERFACES => INTERFACES,
    };
    const written = tableDealer({ ...shared, precons: preconFile(), newId: ids() })();
    const sealed = tableDealer({ ...shared, precons: null, newId: ids() })();

    // Read off the seat rather than off the deal: the snapshot is what the page
    // is handed, and the cards on it are the deck that was dealt.
    const writtenCards = dealtNames(written);
    expect(writtenCards.size).toBeGreaterThan(0);
    // The written deck is 24 copies of one spell and 16 Plains, and its whole
    // vocabulary is those two names. A sealed pool is cut from boosters and is
    // not that, so the two branches cannot be each other.
    expect([...writtenCards].sort()).toEqual([PLAINS, CARDS[0]?.name]);
    expect([...dealtNames(sealed)]).not.toEqual([...writtenCards]);
  });

  it('asks what addresses this machine has when the table is dealt, not when the lab started', () => {
    let asked = 0;
    const deal = tableDealer({
      set: CARDS,
      precons: null,
      webPort: 5173,
      interfaces: () => {
        asked += 1;
        return INTERFACES;
      },
      newId: ids(),
    });
    expect(asked).toBe(0);
    deal();
    deal();
    expect(asked).toBe(2);
  });
});

/**
 * The other press: a room, which is the same seating with no decks in it.
 *
 * A room and a table are dealt by one function on purpose (`seat` in
 * `table-dealer.ts`), so what is worth pinning here is the two places they are
 * not the same — the link says `room`, and there is no game until somebody
 * builds — plus the one place they must stay identical, which is who the host
 * is. A room whose host token seated seat 1 would put the person who pressed
 * the button in the seat they meant to hand over, and the pool they build from
 * would be the other player's.
 */
describe('the room the second Play button opens', () => {
  const shared = {
    set: CARDS,
    webPort: 5173,
    interfaces: (): typeof INTERFACES => INTERFACES,
  };

  it('keeps the host seat and hands out the other one, addressed as a room', () => {
    const opened = roomDealer({ ...shared, newId: ids() })();

    expect(opened.room.seatOf(opened.hostToken)).toBe(0);
    expect(opened.invite?.hostSeat).toBe(0);
    expect(opened.invite?.guests).toHaveLength(1);
    expect(JSON.stringify(opened.invite)).not.toContain(opened.hostToken);
    const url = opened.invite?.guests[0]?.links[0]?.url ?? '';
    // `?room=`, not `?table=`: the page reads which screen to open off the link,
    // so a room handed out as a table would open a board with no game behind it.
    expect(url).toContain('http://192.168.1.20:5173/#/play/sealed?room=');
    const guestToken = url.slice(url.indexOf('room=') + 'room='.length);
    expect(opened.room.seatOf(guestToken)).toBe(1);
  });

  it('deals each seat its own pool out of the same set', () => {
    const opened = roomDealer({ ...shared, newId: ids() })();
    const mine = opened.room.viewFor(0).pool;
    const theirs = opened.room.viewFor(1).pool;
    const printed = new Set(CARDS.map((card) => card.id));

    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    for (const id of [...mine, ...theirs]) expect(printed.has(id)).toBe(true);
    // Two pools rather than one dealt twice, which is what sealed means.
    expect(theirs).not.toEqual(mine);
  });

  it('has no game in it until somebody builds one', () => {
    const opened = roomDealer({ ...shared, newId: ids() })();
    expect(opened.room.viewFor(0).phase).toBe('build');
    expect(opened.room.table()).toBeNull();
  });

  it('opens a different room every time it is pressed', () => {
    const open = roomDealer({ ...shared, newId: ids() });
    const first = open();
    const second = open();
    expect(second.hostToken).not.toBe(first.hostToken);
    expect(second.room.seatOf(first.hostToken)).toBeNull();
    expect(second.room.viewFor(0).pool).not.toEqual(first.room.viewFor(0).pool);
  });

  it('asks what addresses this machine has when the room is opened', () => {
    let asked = 0;
    const open = roomDealer({
      ...shared,
      interfaces: () => {
        asked += 1;
        return INTERFACES;
      },
      newId: ids(),
    });
    expect(asked).toBe(0);
    open();
    expect(asked).toBe(1);
  });
});

/**
 * The same dealer with `draft` set: the third Play button.
 *
 * What must hold is that it is the *same room* — one seating, one invite, one
 * token from the first pack to the last turn — and that the cards reach a seat
 * a pick at a time instead of a pool at a time. A drafting room that handed out
 * a second link, or seated the host in seat 1, would be a separate lane to keep
 * in sync, and the whole reason this is an option rather than a second dealer
 * is that there is nothing to keep in sync.
 */
describe('the drafting room the third Play button opens', () => {
  const shared = {
    set: CARDS,
    webPort: 5173,
    interfaces: (): typeof INTERFACES => INTERFACES,
    draft: {},
  };

  it('deals packs rather than pools, and owes each seat a pick', () => {
    const opened = roomDealer({ ...shared, newId: ids() })();
    const view = opened.room.viewFor(0);

    expect(view.phase).toBe('draft');
    // Nothing drafted yet, so the pool is empty and the pack is what there is.
    expect(view.pool).toEqual([]);
    expect(view.pack?.cards.length).toBeGreaterThan(0);
    expect(view.pack?.round).toBe(1);
    expect(view.pack?.pickNumber).toBe(1);
    expect(opened.room.table()).toBeNull();
  });

  it('prints only cards from the set it was opened over', () => {
    const opened = roomDealer({ ...shared, newId: ids() })();
    const printed = new Set(CARDS.map((card) => card.id));
    for (const seat of [0, 1] as const) {
      for (const id of opened.room.viewFor(seat).pack?.cards ?? []) expect(printed.has(id)).toBe(true);
    }
  });

  it('is one room under one token, addressed the way a sealed room is', () => {
    const opened = roomDealer({ ...shared, newId: ids() })();

    expect(opened.room.seatOf(opened.hostToken)).toBe(0);
    const url = opened.invite?.guests[0]?.links[0]?.url ?? '';
    // `?room=` and not a fourth param: the phase is what the screen reads, so a
    // drafting room and the game it becomes are one address.
    expect(url).toContain('http://192.168.1.20:5173/#/play/sealed?room=');
    const guestToken = url.slice(url.indexOf('room=') + 'room='.length);
    expect(opened.room.seatOf(guestToken)).toBe(1);
  });

  it('opens a sealed room when the option is left off, which is the default', () => {
    const opened = roomDealer({ set: CARDS, webPort: 5173, interfaces: () => INTERFACES, newId: ids() })();
    expect(opened.room.viewFor(0).phase).toBe('build');
    expect(opened.room.viewFor(0).pack).toBeNull();
  });
});
