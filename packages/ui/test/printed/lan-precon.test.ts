/**
 * The LAN press beside the Forge one, without a server behind it.
 *
 * `mtg-r9vgk`. The press is a value the lab builds and the Commander route
 * draws (`../../src/routes/printed/lan-precon.ts`), which is what makes the
 * whole of it checkable here: what it sends, what it does with the two seat
 * links it is answered with, and what it says when the lab refuses. The
 * refusal it draws beside a dark button is the lab's own sentence rather than
 * one written here, so a page can never offer a press that 404s.
 *
 * `mtg-ei4n5` added the host's own deck to the press, so the cases below also
 * watch what the seat callback is handed: the table's token is half of where
 * the page has to go, and the deck the band was showing is the other half.
 */
import { expect, it } from 'vitest';
import type { DeckRef, MatchRules } from '@mtg/engine';
import { LAN_PRECON_LABEL, preconLanPlay } from '../../src/routes/printed/lan-precon';
import type { ObservedTableStart, startObservedTable } from '../../src/net/observed-table';

const RULES: MatchRules = { variant: 'commander', startingLife: 40 };
const GUEST_DECK: DeckRef = {
  name: 'Token Triumph',
  cards: [{ name: 'Emmara, Soul of the Accord', count: 1 }],
  commanders: [{ name: 'Emmara, Soul of the Accord', count: 1 }],
};

/** One call of the seat callback: the token it was handed, and the host's own deck. */
interface Seating {
  readonly token: string;
  readonly deck: string;
}

/** A `startObservedTable` that records what it was asked and answers what it was told to. */
type OpenRequest = Parameters<typeof startObservedTable>[1];

function fakeStart(answer: ObservedTableStart) {
  const sent: { readonly base: string; readonly request: OpenRequest }[] = [];
  const start: typeof startObservedTable = (base, request) => {
    sent.push({ base, request });
    return Promise.resolve(answer);
  };
  return { sent, start };
}

it('reports the lab’s own sentence when its Forge will not seat this format', () => {
  const { start } = fakeStart({ ok: true, table: 't', host: 'obs-h', guest: 'obs-g' });
  const refused = preconLanPlay({
    base: '/api',
    format: 'commander',
    rules: RULES,
    availability: { status: 'unavailable', reason: 'This lab was started without a Forge backend.' },
    seat: () => undefined,
    start,
  });
  expect(refused.label).toBe(LAN_PRECON_LABEL);
  expect(refused.refusal).toBe('This lab was started without a Forge backend.');
  const ready = preconLanPlay({
    base: '/api',
    format: 'commander',
    rules: RULES,
    availability: { status: 'ready' },
    seat: () => undefined,
    start,
  });
  expect(ready.refusal).toBeNull();
});

it('sends the format, printed content, rules and guest deck, then seats the host it is answered with', async () => {
  const seated: Seating[] = [];
  const { sent, start } = fakeStart({ ok: true, table: 'tbl', host: 'obs-host', guest: 'obs-guest' });
  const play = preconLanPlay({
    base: '/api',
    format: 'commander',
    rules: RULES,
    availability: { status: 'ready' },
    seat: (token, deck) => seated.push({ token, deck }),
    start,
  });
  expect(await play.onPress('chaos-incarnate', GUEST_DECK)).toBeNull();
  // The body `StartForgeTable` already sends, and nothing else: a second
  // contract with the same route is a second thing to keep in step with it.
  expect(sent).toEqual([
    {
      base: '/api',
      request: {
        format: 'commander',
        content: { kind: 'printed', format: 'commander' },
        seed: null,
        maximumTurns: null,
        rules: RULES,
        deck: GUEST_DECK,
      },
    },
  ]);
  expect(seated).toEqual([{ token: 'obs-host', deck: 'chaos-incarnate' }]);
});

it('states no rules for a format that has none', async () => {
  const { sent, start } = fakeStart({ ok: true, table: 't', host: 'obs-h', guest: 'obs-g' });
  const play = preconLanPlay({
    base: '/api',
    format: 'legacy-cube',
    rules: undefined,
    availability: { status: 'ready' },
    seat: () => undefined,
    start,
  });
  await play.onPress('any-deck', GUEST_DECK);
  expect(Object.keys(sent[0]!.request)).not.toContain('rules');
});

it('resolves the server’s refusal and seats nobody when the open is refused', async () => {
  const seated: Seating[] = [];
  const { start } = fakeStart({ ok: false, message: 'the lab answered 503' });
  const play = preconLanPlay({
    base: '/api',
    format: 'commander',
    rules: RULES,
    availability: { status: 'ready' },
    seat: (token, deck) => seated.push({ token, deck }),
    start,
  });
  // `mtg-ei4n5`. A refused open writes nothing at all: the route the seat would
  // be written to is the one the page is already on, so half a write would move
  // the reader's deck under him and seat him at no table.
  expect(await play.onPress('chaos-incarnate', GUEST_DECK)).toBe('the lab answered 503');
  expect(seated).toEqual([]);
});

it('seats the host on the deck he chose, so the table opens where the landing was', async () => {
  const seated: Seating[] = [];
  const { start } = fakeStart({ ok: true, table: 'tbl', host: 'obs-host', guest: 'obs-guest' });
  const play = preconLanPlay({
    base: '/api',
    format: 'commander',
    rules: RULES,
    availability: { status: 'ready' },
    seat: (token, deck) => seated.push({ token, deck }),
    start,
  });
  // `mtg-ei4n5`. The seat page reads its deck off the route and falls back to
  // the format's first one, so the token alone opened the table on whichever
  // deck ships first rather than on the one the band was showing. Both go in
  // one call, which is what `LabApp` turns into one params write.
  expect(await play.onPress('token-triumph', GUEST_DECK)).toBeNull();
  expect(seated).toEqual([{ token: 'obs-host', deck: 'token-triumph' }]);
});
