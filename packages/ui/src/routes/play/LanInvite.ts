/**
 * The link the other player needs, on the screen of the person who has it.
 *
 * `npm run netplay` prints two seat links to the terminal it was run in, and
 * that is the whole of how the second one has ever reached the second player:
 * read a UUID aloud, or find a chat window both machines are signed into. This
 * panel is the other half of the arrangement — the host's browser asks the table
 * what it may hand out (`../../net/invite.ts`) and draws it as a link, a copy
 * button and a code to scan.
 *
 * # It is drawn by the host, and only the host
 *
 * Not decided here. The seat asks, the server answers `{ host: false }` to
 * anybody who is not the seat the invite names, and this file draws whatever it
 * is given. A guest's page cannot render the other seat's link because a guest's
 * page is never sent one.
 *
 * # It leaves when it is done
 *
 * A guest who has opened their link is a guest who does not need it, and this
 * panel sits above a board. So a joined seat is a sentence rather than a link,
 * and once every seat has joined the panel is not drawn at all. The links have
 * not been destroyed — they are in the terminal that printed them, in full, and
 * that is where somebody whose phone died goes.
 *
 * # The QR is drawn, not fetched
 *
 * `../../net/qr.ts` is arithmetic over a byte array with no `node:` import,
 * which is why it lives under `src/`. The terminal draws its matrix with block
 * characters; this draws the same matrix as one SVG path. A code that is a
 * picture nobody had to serve also means this panel works on a machine with no
 * route to anywhere except the one it is inviting somebody over.
 */
import { createElement, Fragment, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import type { InviteLink, InviteSeat } from '@mtg/netplay';
import { canCopy, copyText } from '../../clipboard';
import { encodeQr } from '../../net/qr';
import type { QrMatrix } from '../../net/qr';
import { useInvite } from '../../net/invite';
import type { InviteRoute } from '../../net/invite';

export const LAN_INVITE_LABEL = 'Invite the other player';
export const LAN_COPY_LABEL = 'Copy link';
export const LAN_COPIED_LABEL = 'Copied';
export const LAN_WAITING_NOTE = 'has not opened their link yet.';

/** Quiet zone, in modules. Four is what a scanner is specified to expect. */
const QUIET = 4;

/** The link too long for the code sizes `encodeQr` draws, said out loud. */
export const LAN_QR_TOO_LONG = 'This link is longer than a scannable code of the sizes this page draws.';

/**
 * The matrix as one path: a move and a unit square per dark module.
 *
 * One element rather than a rect per module, because a version-5 code is 37x37
 * and half of it is dark, which is some seven hundred elements React would be
 * asked to diff every time the panel re-renders while polling.
 */
function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (const [row, cells] of matrix.modules.entries()) {
    for (const [column, dark] of cells.entries()) {
      if (!dark) continue;
      parts.push(`M${String(column + QUIET)} ${String(row + QUIET)}h1v1h-1z`);
    }
  }
  return parts.join('');
}

/**
 * The code, or nothing.
 *
 * The link is on the page either way — the code is the convenience, not the
 * content — so a refusal is a note beside the link rather than a broken panel.
 */
function qr(url: string, alt: string): ReactElement {
  const matrix = encodeQr(url);
  if (matrix === undefined)
    return createElement('p', { className: 'mtg-lan__note', role: 'status' }, LAN_QR_TOO_LONG);
  const span = matrix.size + QUIET * 2;
  return createElement(
    'svg',
    {
      className: 'mtg-lan__qr',
      viewBox: `0 0 ${String(span)} ${String(span)}`,
      role: 'img',
      'aria-label': alt,
      shapeRendering: 'crispEdges',
    },
    // The quiet zone is a filled rect rather than transparent: a scanner needs
    // a light field, and the page behind this one is dark. Both fills come from
    // the sheet (`styles/views.ts`, `--mtg-qr-field` / `--mtg-qr-module`), which
    // declares them the same in both themes for that reason.
    createElement('rect', { width: span, height: span }),
    createElement('path', { d: qrPath(matrix) }),
  );
}

function copyButton(url: string): ReactElement {
  return createElement(CopyLink, { url });
}

interface CopyLinkProps {
  readonly url: string;
}

/**
 * Copy, and then say so.
 *
 * The label changes rather than a toast appearing, because the press has no
 * other visible effect and a button that looks identical afterwards is one a
 * person presses twice. It stays changed: the next thing that happens on this
 * panel is a guest joining, which takes the whole seat away.
 */
function CopyLink(props: CopyLinkProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const { url } = props;
  const press = useCallback((): void => {
    void copyText(url).then((ok) => {
      setCopied(ok);
    });
  }, [url]);
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn',
      'data-variant': 'primary',
      onClick: press,
      ...(copied ? { 'data-copied': 'true' } : {}),
    },
    copied ? LAN_COPIED_LABEL : LAN_COPY_LABEL,
  );
}

/** The addresses under the first one, for the reader whose network is not it. */
function alternates(links: readonly InviteLink[]): ReactElement | null {
  if (links.length < 2) return null;
  return createElement(
    'details',
    { className: 'mtg-lan__more' },
    createElement('summary', null, `Other addresses (${String(links.length - 1)})`),
    createElement(
      'ul',
      { className: 'mtg-lan__addresses' },
      links
        .slice(1)
        .map((link) =>
          createElement(
            'li',
            { key: link.url },
            createElement('span', { className: 'mtg-lan__addresslabel' }, link.label),
            createElement('code', { className: 'mtg-lan__url' }, link.url),
          ),
        ),
    ),
  );
}

/**
 * One seat's invitation.
 *
 * `links[0]` is the address `tools/netplay-links.ts` decided is the one most
 * likely to reach another device, and that decision is made once, there, where
 * the argument for it is written down. This draws the first and folds the rest.
 */
function seatInvite(seat: InviteSeat): ReactElement {
  const first: InviteLink | undefined = seat.links[0];
  if (first === undefined)
    return createElement(
      'div',
      { className: 'mtg-lan__seat', key: seat.name },
      createElement('p', { className: 'mtg-lan__note', role: 'status' }, `${seat.name} ${LAN_WAITING_NOTE}`),
    );
  return createElement(
    'div',
    { className: 'mtg-lan__seat', key: seat.name },
    createElement(
      'div',
      { className: 'mtg-lan__body' },
      createElement(
        'div',
        { className: 'mtg-lan__lines' },
        createElement('p', { className: 'mtg-lan__who' }, `${seat.name} ${LAN_WAITING_NOTE}`),
        createElement('code', { className: 'mtg-lan__url' }, first.url),
        createElement('div', { className: 'mtg-toolbar' }, canCopy() ? copyButton(first.url) : null),
        alternates(seat.links),
      ),
      qr(first.url, `Kaelen for ${seat.name}, as a scannable code`),
    ),
  );
}

export interface LanPanelProps {
  /** The seats that have not arrived. Drawing an empty list is the caller's bug. */
  readonly guests: readonly InviteSeat[];
  /** A line under the seats, when the last read went wrong. */
  readonly problem?: string;
}

/**
 * The panel with no wire behind it.
 *
 * Split out of the component below so it can be rendered from a given answer
 * rather than from a fetch, which is what lets `test/lab/lan-invite.browser.test.ts`
 * measure it: a hook's effect does not run under `renderToStaticMarkup`, so a
 * panel that only existed as *fetch plus markup* could be measured in no browser
 * at all. Nothing about the split is a seam the product uses — there is one
 * caller and it is `LanInvite`.
 */
export function LanPanel(props: LanPanelProps): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-lan', 'aria-label': LAN_INVITE_LABEL },
    createElement('h2', { className: 'mtg-lan__title' }, LAN_INVITE_LABEL),
    createElement(Fragment, null, ...props.guests.map(seatInvite)),
    props.problem === undefined
      ? null
      : createElement('p', { className: 'mtg-lan__note', role: 'status' }, props.problem),
  );
}

export interface LanInviteProps {
  /** Where the table answers; `/api` when Vite is proxying, which it is. */
  readonly base: string;
  /** This browser's seat link. The server reads the seat off it. */
  readonly token: string;
  /** Which arm holds the seat; a kernel table unless told otherwise. */
  readonly route?: InviteRoute;
}

/**
 * The panel, or nothing at all.
 *
 * Nothing is the ordinary case: a guest's page, a table dealt without links, and
 * a host whose guest has already arrived all draw no panel. An error draws one
 * line, because a host waiting on a link that never appears should be told it is
 * the table rather than their patience.
 */
export function LanInvite(props: LanInviteProps): ReactElement | null {
  const { invite, error } = useInvite(props.base, props.token, props.route ?? 'table');
  if (invite === null)
    return error === null ? null : createElement('p', { className: 'mtg-lan__note', role: 'status' }, error);
  if (!invite.host) return null;
  const waiting = invite.guests.filter((guest) => !guest.joined);
  if (waiting.length === 0) return null;
  return createElement(LanPanel, { guests: waiting, ...(error === null ? {} : { problem: error }) });
}
