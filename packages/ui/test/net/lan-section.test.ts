// @vitest-environment jsdom
/**
 * The Play chooser's network column: a button that deals a table.
 *
 * The playtester's instruction is the thing this file guards — "it shouldnt make you
 * do anything in a terminal you should just be able to press a button in the UI"
 * — so the load-bearing assertion here is that pressing the button deals a table
 * and seats this page at it, with no command in between.
 *
 * The three answers stay separate, because the section says a different sentence
 * to each and only one of them is a button. A lab that deals gets the press; a
 * server already holding a table dealt from a terminal gets told so, since
 * offering to start a second one there would offer to replace the game somebody
 * came to play; nothing listening gets the command that starts a lab which can
 * deal.
 *
 * And the beat of silence: a section that rendered its no-table sentence before
 * the probe answered would tell somebody to run a command a moment before
 * telling them not to.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  LanSection,
  PLAY_LAN_DRAFT_LABEL,
  PLAY_LAN_ROOM_LABEL,
  PLAY_LAN_COMMAND,
  PLAY_LAN_COPIED_LABEL,
  PLAY_LAN_COPY_LABEL,
  PLAY_LAN_LABEL,
  PLAY_LAN_START_LABEL,
  lanNotOffered,
} from '../../src/routes/play/LanSection';

/**
 * The DOM, reached through what is actually there.
 *
 * No `lib: dom` under the workspace tsconfig, so this is how every jsdom test in
 * the package reads an element it rendered.
 */
interface ElementLike {
  readonly querySelectorAll: (selector: string) => ArrayLike<ElementLike> & Iterable<ElementLike>;
  readonly textContent: string;
}

function like(node: unknown): ElementLike {
  return node as ElementLike;
}

let restore: (() => void) | null = null;

function stubFetch(answer: (url: string, init?: { method?: string }) => Promise<Response>): void {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: answer });
  restore = (): void => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  };
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

function answering(body: unknown, status = 200): () => Promise<Response> {
  return () => json(body, status);
}

/** A clipboard, which jsdom does not have and an insecure origin does not either. */
function stubClipboard(): { written: string[] } {
  const written: string[] = [];
  const previous = restore;
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string): Promise<void> => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
  restore = (): void => {
    previous?.();
    if (original === undefined) delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
    else Object.defineProperty(globalThis.navigator, 'clipboard', original);
  };
  return { written };
}

/** A lab that deals a table when the page asks for one. */
const DEALING = { ok: true, protocol: 3, deals: true };

/** A lab that also opens rooms, which is what the second button needs. */
const ROOMING = { ok: true, protocol: 3, deals: true, rooms: true };

/** A lab one further on: it drafts the pools before anybody builds from them. */
const DRAFTING = { ok: true, protocol: 3, deals: true, rooms: true, drafts: true };

/** A launcher holding a table it dealt itself, which cannot deal another. */
const SEATED = { ok: true, protocol: 3, deals: false };

/**
 * A lab that answers both routes: the probe, and the deal.
 *
 * The requests are recorded so a test can assert that the press actually posted
 * — a button that flipped a local flag and navigated would satisfy every
 * assertion about labels.
 */
function lab(deal: () => Promise<Response>): {
  readonly fetch: (url: string, init?: { method?: string }) => Promise<Response>;
  readonly asked: { url: string; method: string }[];
} {
  const asked: { url: string; method: string }[] = [];
  return {
    asked,
    fetch: (url: string, init?: { method?: string }): Promise<Response> => {
      asked.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/health')) return json(DEALING);
      if (url.endsWith('/tables')) return deal();
      return json({ refused: 'no such route' }, 404);
    },
  };
}

beforeEach(() => {
  restore = null;
});

afterEach(() => {
  cleanup();
  if (restore !== null) restore();
});

function section(): ElementLike | null {
  const found = screen.queryByRole('region', { name: PLAY_LAN_LABEL });
  return found === null ? null : like(found);
}

async function drawn(): Promise<ElementLike> {
  return waitFor(() => {
    const found = section();
    if (found === null) throw new Error('no section yet');
    return found;
  });
}

function noop(): void {
  return undefined;
}

describe('the LAN section', () => {
  it('deals a table when the button is pressed, and seats this page at it', async () => {
    const server = lab(() => json({ token: 'host-token', protocol: 3, table: 'dealt' }, 201));
    stubFetch(server.fetch);
    const seated: string[] = [];
    render(
      h(LanSection, {
        base: '/api',
        kind: 'table',
        onSeat: (token: string): void => {
          seated.push(token);
        },
      }),
    );

    const button = await screen.findByRole('button', { name: PLAY_LAN_START_LABEL });
    fireEvent.click(button);
    await waitFor(() => {
      expect(seated).toEqual(['host-token']);
    });
    // Dealt over the wire, with the method the route requires. Nothing here
    // could have been satisfied by a page that only changed its own mind.
    expect(server.asked).toContainEqual({ url: '/api/tables', method: 'POST' });
    // And no terminal in the sentence above the button.
    expect((await drawn()).textContent).not.toContain('npm run');
  });

  it('says why the press did nothing, and leaves the button to press again', async () => {
    const server = lab(() => json({ refused: 'this server is already holding 8 tables' }, 429));
    stubFetch(server.fetch);
    const seated: string[] = [];
    render(
      h(LanSection, {
        base: '/api',
        kind: 'table',
        onSeat: (token: string): void => {
          seated.push(token);
        },
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: PLAY_LAN_START_LABEL }));
    await waitFor(() => {
      expect(like(section()).textContent).toContain('already holding 8 tables');
    });
    expect(seated).toEqual([]);
    await screen.findByRole('button', { name: PLAY_LAN_START_LABEL });
  });

  it('refuses to seat a page at a table dealt by a protocol it does not speak', async () => {
    const server = lab(() => json({ token: 'host-token', protocol: 2 }, 201));
    stubFetch(server.fetch);
    const seated: string[] = [];
    render(
      h(LanSection, {
        base: '/api',
        kind: 'table',
        onSeat: (token: string): void => {
          seated.push(token);
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: PLAY_LAN_START_LABEL }));
    await waitFor(() => {
      expect(like(section()).textContent).toContain('protocol this page does not');
    });
    expect(seated).toEqual([]);
  });

  it('says a table is already up rather than offering to deal a second one', async () => {
    stubFetch(answering(SEATED));
    render(h(LanSection, { base: '/api', kind: 'table', onSeat: noop }));
    const found = await drawn();
    expect(found.textContent).toContain('already running');
    expect(found.querySelectorAll('button')).toHaveLength(0);
  });

  it('names the command when nothing is listening, and has nothing to press that deals', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    stubClipboard();
    render(h(LanSection, { base: '/api', kind: 'table', onSeat: noop }));
    const found = await drawn();
    expect(found.textContent).toContain(PLAY_LAN_COMMAND);
    // Every button in it copies. None of them deals.
    const labels = [...found.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual([PLAY_LAN_COPY_LABEL]);
  });

  it('treats a server speaking another protocol as no lab at all', async () => {
    stubFetch(answering({ ok: true, protocol: 2, deals: true }));
    render(h(LanSection, { base: '/api', kind: 'table', onSeat: noop }));
    await waitFor(() => {
      expect(like(section()).textContent).toContain(PLAY_LAN_COMMAND);
    });
  });

  it('keeps the command as readable text where there is no clipboard to copy it to', async () => {
    // Which is every origin this feature is used on that is not localhost.
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    render(h(LanSection, { base: '/api', kind: 'table', onSeat: noop }));
    const found = await drawn();
    expect(found.textContent).toContain(PLAY_LAN_COMMAND);
    expect(found.querySelectorAll('button')).toHaveLength(0);
  });

  it('draws nothing at all until the probe answers', async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    render(h(LanSection, { base: '/api', kind: 'table', onSeat: noop }));
    await new Promise((done) => setTimeout(done, 50));
    expect(section()).toBeNull();
  });

  it('copies the command, and says it did', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const { written } = stubClipboard();
    render(h(LanSection, { base: '/api', kind: 'table', onSeat: noop }));
    const button = await screen.findByRole('button', { name: PLAY_LAN_COPY_LABEL });
    fireEvent.click(button);
    await waitFor(() => {
      expect(written).toEqual([PLAY_LAN_COMMAND]);
    });
    await screen.findByRole('button', { name: PLAY_LAN_COPIED_LABEL });
  });
});

/**
 * The second button: the game the two players build the decks for.
 *
 * Two conditions gate it and both are read rather than assumed — the lab says it
 * opens rooms, and this page has somewhere to put the seat. A lab older than the
 * build screen deals tables and 404s rooms, and that is a state somebody is
 * running today, so a button drawn there would be a button that fails.
 */
describe('the LAN section, asked for a room', () => {
  function labWithRooms(open: () => Promise<Response>): {
    readonly fetch: (url: string, init?: { method?: string }) => Promise<Response>;
    readonly asked: { url: string; method: string }[];
  } {
    const asked: { url: string; method: string }[] = [];
    return {
      asked,
      fetch: (url: string, init?: { method?: string }): Promise<Response> => {
        asked.push({ url, method: init?.method ?? 'GET' });
        if (url.endsWith('/health')) return json(ROOMING);
        if (url.endsWith('/rooms')) return open();
        return json({ refused: 'no such route' }, 404);
      },
    };
  }

  it('opens a room when the button is pressed, and seats this page in it', async () => {
    const server = labWithRooms(() => json({ token: 'host-token', protocol: 3, room: 'room-1' }, 201));
    stubFetch(server.fetch);
    const seated: string[] = [];
    render(
      h(LanSection, {
        base: '/api',
        kind: 'room',
        onSeat: (token: string): void => {
          seated.push(token);
        },
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: PLAY_LAN_ROOM_LABEL }));
    await waitFor(() => {
      expect(seated).toEqual(['host-token']);
    });
    // The room route, not the table one: the two produce different links and
    // land on different screens, and a press that hit the wrong one would deal a
    // game with the decks already built.
    expect(server.asked).toContainEqual({ url: '/api/rooms', method: 'POST' });
    expect(server.asked.map((ask) => ask.url)).not.toContain('/api/tables');
  });

  it('says the lab on this origin does not open rooms, rather than offering a table instead', async () => {
    stubFetch(lab(() => json({ token: 'host-token', protocol: 3 }, 201)).fetch);
    render(h(LanSection, { base: '/api', kind: 'room', onSeat: noop }));
    // The section drew and said which press it has not got. The table press is
    // not offered in its place: the sub asked for a room, and a table is a
    // different game with the decks already built.
    expect((await drawn()).textContent).toContain(lanNotOffered('room'));
    expect(screen.queryByRole('button', { name: PLAY_LAN_ROOM_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: PLAY_LAN_START_LABEL })).toBeNull();
  });

  it('offers only the table when that is the press the sub asked for, on a lab that opens rooms', async () => {
    stubFetch(answering(ROOMING));
    render(h(LanSection, { base: '/api', kind: 'table', onSeat: noop }));
    await screen.findByRole('button', { name: PLAY_LAN_START_LABEL });
    expect(screen.queryByRole('button', { name: PLAY_LAN_ROOM_LABEL })).toBeNull();
  });

  it('says why the press did nothing, and leaves the button to press again', async () => {
    const server = labWithRooms(() => json({ refused: 'this server is already holding 8 tables' }, 429));
    stubFetch(server.fetch);
    const seated: string[] = [];
    render(
      h(LanSection, {
        base: '/api',
        kind: 'room',
        onSeat: (token: string): void => {
          seated.push(token);
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: PLAY_LAN_ROOM_LABEL }));
    await waitFor(() => {
      expect(like(section()).textContent).toContain('already holding 8 tables');
    });
    expect(seated).toEqual([]);
    await screen.findByRole('button', { name: PLAY_LAN_ROOM_LABEL });
    expect(screen.queryByRole('button', { name: PLAY_LAN_START_LABEL })).toBeNull();
  });
});

/**
 * The draft press: the room whose pools are drafted before they are built.
 *
 * Gated on its own answer from the probe and not on the room button's, which is
 * the whole point of asking twice: every lab between the build screen and the
 * draft one opens rooms and 404s drafts, and a button inferred from `rooms`
 * would be a button that fails on all of them.
 */
describe('the LAN section, asked for a draft', () => {
  function labWithDrafts(open: () => Promise<Response>): {
    readonly fetch: (url: string, init?: { method?: string }) => Promise<Response>;
    readonly asked: { url: string; method: string }[];
  } {
    const asked: { url: string; method: string }[] = [];
    return {
      asked,
      fetch: (url: string, init?: { method?: string }): Promise<Response> => {
        asked.push({ url, method: init?.method ?? 'GET' });
        if (url.endsWith('/health')) return json(DRAFTING);
        if (url.endsWith('/drafts')) return open();
        return json({ refused: 'no such route' }, 404);
      },
    };
  }

  it('opens a drafting room when the button is pressed, and seats this page in it', async () => {
    const server = labWithDrafts(() => json({ token: 'host-token', protocol: 3, room: 'room-1' }, 201));
    stubFetch(server.fetch);
    const seated: string[] = [];
    render(
      h(LanSection, {
        base: '/api',
        kind: 'draft',
        onSeat: (token: string): void => {
          seated.push(token);
        },
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: PLAY_LAN_DRAFT_LABEL }));
    await waitFor(() => {
      expect(seated).toEqual(['host-token']);
    });
    // The draft route and no other. A press that hit `/api/rooms` would open two
    // sealed pools, which is a different game with the same screen after it.
    expect(server.asked).toContainEqual({ url: '/api/drafts', method: 'POST' });
    expect(server.asked.map((ask) => ask.url)).not.toContain('/api/rooms');
  });

  it('says a lab that only opens rooms does not draft, rather than offering a room instead', async () => {
    stubFetch(answering(ROOMING));
    render(h(LanSection, { base: '/api', kind: 'draft', onSeat: noop }));
    // Read off the probe's second answer rather than its first: every lab
    // between the build screen and the draft one opens rooms and 404s drafts.
    expect((await drawn()).textContent).toContain(lanNotOffered('draft'));
    expect(screen.queryByRole('button', { name: PLAY_LAN_DRAFT_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: PLAY_LAN_ROOM_LABEL })).toBeNull();
  });

  it('offers only the room when that is the press the sub asked for, on a lab that drafts', async () => {
    stubFetch(answering(DRAFTING));
    render(h(LanSection, { base: '/api', kind: 'room', onSeat: noop }));
    await screen.findByRole('button', { name: PLAY_LAN_ROOM_LABEL });
    expect(screen.queryByRole('button', { name: PLAY_LAN_DRAFT_LABEL })).toBeNull();
  });

  it('says why the press did nothing, and leaves the button to press again', async () => {
    const server = labWithDrafts(() => json({ refused: 'this server is already holding 8 tables' }, 429));
    stubFetch(server.fetch);
    const seated: string[] = [];
    render(
      h(LanSection, {
        base: '/api',
        kind: 'draft',
        onSeat: (token: string): void => {
          seated.push(token);
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: PLAY_LAN_DRAFT_LABEL }));
    await waitFor(() => {
      expect(like(section()).textContent).toContain('already holding 8 tables');
    });
    expect(seated).toEqual([]);
    await screen.findByRole('button', { name: PLAY_LAN_DRAFT_LABEL });
    expect(screen.queryByRole('button', { name: PLAY_LAN_ROOM_LABEL })).toBeNull();
  });
});
