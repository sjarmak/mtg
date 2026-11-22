// @vitest-environment jsdom
/**
 * The panel that gets the second link onto the second device.
 *
 * `netplay-links.test.ts` checks what the launcher builds and
 * `packages/netplay/test/invite.test.ts` checks what the server will part with.
 * This is the third of the three and the only one a person sees: given an
 * answer, what is on screen.
 *
 * The claims worth pinning are the ones that are easy to regress into being
 * merely decorative:
 *
 *  - The guest's link is on the page as *text*, not only inside a button. The
 *    button is absent on an insecure origin, which is exactly what a LAN
 *    address is, and a panel whose only copy of the link was in a clipboard
 *    handler would be a blank panel on the machines this feature is for.
 *  - The code is drawn from the link, so scanning it and typing it reach the
 *    same seat.
 *  - A guest's page draws nothing. It is sent nothing either — that is the
 *    server's test — and this is the half that says the page does not invent a
 *    link out of its own token.
 *  - The panel leaves when the guest arrives, because it sits above a board.
 *
 * `fetch` is stood in for rather than a server being started: what is worth
 * testing here is the reader and the component, and jsdom has no `fetch` of its
 * own, so a socket would be testing the environment.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { InviteResponse } from '@mtg/netplay';
import {
  LAN_COPIED_LABEL,
  LAN_COPY_LABEL,
  LAN_INVITE_LABEL,
  LanInvite,
} from '../../src/routes/play/LanInvite';
import { readInvite } from '../../src/net/invite';

/**
 * The DOM, reached through what is actually there.
 *
 * The workspace tsconfig loads no `lib: dom`, so `textContent` and
 * `querySelector` are not names in this file. Every other jsdom test in this
 * package narrows the same way (`play/fit.test.ts`, `play/seat-pod.test.ts`).
 */
interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string;
}

function like(node: unknown): ElementLike {
  return node as ElementLike;
}

const GUEST_URL = 'http://100.101.102.103:5273/#/play/constructed?table=9c1b7d55-2e60-4a83-8f47-11de3a904bb2';
const LAN_URL = 'http://192.168.1.42:5273/#/play/constructed?table=9c1b7d55-2e60-4a83-8f47-11de3a904bb2';

function hosting(joined: boolean): InviteResponse {
  return {
    host: true,
    guests: [
      {
        name: 'Seat two',
        links: [
          { label: 'Tailscale (100.101.102.103)', url: GUEST_URL },
          { label: 'LAN (192.168.1.42)', url: LAN_URL },
        ],
        joined,
      },
    ],
  };
}

let restore: (() => void) | null = null;

/** Answers the invite route with `body`, or with `status` when one is given. */
function stubFetch(body: unknown, status = 200): void {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
      ),
  });
  restore = (): void => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  };
}

/** A clipboard, which jsdom does not have and an insecure origin does not either. */
function stubClipboard(): { written: string[] } {
  const written: string[] = [];
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
  const undo = restore;
  restore = (): void => {
    undo?.();
    if (original === undefined) delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
    else Object.defineProperty(globalThis.navigator, 'clipboard', original);
  };
  return { written };
}

beforeEach(() => {
  restore = null;
});

afterEach(() => {
  cleanup();
  if (restore !== null) restore();
});

async function panel(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole('region', { name: LAN_INVITE_LABEL }), { timeout: 3000 });
}

describe('the invite panel', () => {
  it('draws the guest link as text, so a page with no clipboard still hands it over', async () => {
    stubFetch(hosting(false));
    render(h(LanInvite, { base: '/api', token: 'host-token' }));
    const region = like(await panel());
    expect(region.textContent).toContain(GUEST_URL);
    expect(region.textContent).toContain('Seat two');
  });

  it('draws the first address and folds the rest, rather than a wall of links', async () => {
    stubFetch(hosting(false));
    render(h(LanInvite, { base: '/api', token: 'host-token' }));
    const region = like(await panel());
    const details = region.querySelector('details');
    expect(details).not.toBeNull();
    // Folded: the second address is inside the disclosure, not beside the first.
    expect(details?.textContent).toContain(LAN_URL);
    expect(details?.textContent).not.toContain(GUEST_URL);
  });

  it('draws a code for the same link the text says', async () => {
    stubFetch(hosting(false));
    render(h(LanInvite, { base: '/api', token: 'host-token' }));
    const region = like(await panel());
    const code = region.querySelector('svg.mtg-lan__qr');
    expect(code).not.toBeNull();
    // A path with modules in it, not an empty square.
    expect((code?.querySelector('path')?.getAttribute('d') ?? '').length).toBeGreaterThan(100);
    expect(code?.getAttribute('aria-label')).toContain('Seat two');
  });

  it('copies the link when there is a clipboard to copy it to', async () => {
    stubFetch(hosting(false));
    const clipboard = stubClipboard();
    render(h(LanInvite, { base: '/api', token: 'host-token' }));
    await panel();
    fireEvent.click(await screen.findByRole('button', { name: LAN_COPY_LABEL }));
    await waitFor(() => {
      expect(clipboard.written).toEqual([GUEST_URL]);
    });
    // And says so, because the press has no other visible effect.
    await screen.findByRole('button', { name: LAN_COPIED_LABEL });
  });

  it('draws nothing at a guest seat', async () => {
    stubFetch({ host: false });
    render(h(LanInvite, { base: '/api', token: 'guest-token' }));
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.queryByRole('region', { name: LAN_INVITE_LABEL })).toBeNull();
  });

  it('leaves once the guest has arrived, because it sits above a board', async () => {
    stubFetch(hosting(true));
    render(h(LanInvite, { base: '/api', token: 'host-token' }));
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.queryByRole('region', { name: LAN_INVITE_LABEL })).toBeNull();
  });

  it('draws nothing for a table dealt without links', async () => {
    stubFetch({ refused: 'this table was started without links to hand out' }, 404);
    render(h(LanInvite, { base: '/api', token: 'host-token' }));
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.queryByRole('region', { name: LAN_INVITE_LABEL })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says so when the table answers something it cannot read', async () => {
    stubFetch({ host: 'maybe' });
    render(h(LanInvite, { base: '/api', token: 'host-token' }));
    const said = like(await screen.findByRole('status'));
    expect(said.textContent).toContain('did not say whether this seat hosts');
  });
});

/**
 * The reader, on the answers the panel above never gets to see.
 *
 * A response body is external data even when the process that wrote it is in
 * this repository, which is the argument `net/snapshot.ts` makes at length. The
 * cases here are the ones a stale tab produces: an older server, a proxy that
 * answered with something else, a field that changed shape.
 */
describe('the invite reader', () => {
  it('reads a host answer, links and all', () => {
    const read = readInvite(hosting(false), 'the table');
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.message);
    expect(read.invite.host).toBe(true);
  });

  it('reads a guest answer', () => {
    const read = readInvite({ host: false }, 'the table');
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.message);
    expect(read.invite.host).toBe(false);
  });

  it('refuses anything that is not an object', () => {
    expect(readInvite('yes', 'the table').ok).toBe(false);
    expect(readInvite(null, 'the table').ok).toBe(false);
    expect(readInvite([], 'the table').ok).toBe(false);
  });

  it('refuses a seat whose links are not links', () => {
    const read = readInvite(
      { host: true, guests: [{ name: 'Seat two', links: [{ url: 42 }], joined: false }] },
      'the table',
    );
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('a seat with no readable link was accepted');
    expect(read.message).toContain('cannot read');
  });

  it('refuses a host answer with no seats named', () => {
    expect(readInvite({ host: true }, 'the table').ok).toBe(false);
  });
});
