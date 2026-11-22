/**
 * The third thing you can do from Play: deal a table two people can sit at.
 *
 * # A button, because a person should not have to open a terminal
 *
 * This section used to name a command. `npm run netplay` dealt the table, and
 * the page's job was to say so and then, once one existed, to hand out its
 * links. the playtester read that and said what it is: pressing a button in the page
 * is the whole of what starting a game with the person next to you should take.
 *
 * So the lab's own launcher now runs a game server on loopback that deals a
 * table on request, and this section posts to it. What comes back is one seat —
 * the host's — and `onSeat` puts it in the hash, which mounts `./RemoteGame.ts`
 * with `./LanInvite.ts` above it, and that panel is where the other player's
 * link and its QR code have always been drawn.
 *
 * # One press per section, because there are three games to start
 *
 * Under Constructed it deals a table with both decks already built, which is
 * the fastest route from *press* to *playing*. Under Sealed it opens a **room**:
 * two sealed pools, and each player cuts their own deck before there is a game,
 * which is what the playtester asked for next ("so we're able to build sealed decks
 * to play against each other"). Under Draft it opens a room that **drafts**
 * first: the two seats take cards out of shared packs, and the build screen
 * they land on afterwards is the same one the sealed room opens.
 *
 * The three used to be three buttons in one section under a Play tab that had
 * no sections; now each Play section names its format and `kind` names the one
 * press it draws (`mtg-a982g.1`). A room and a draft are drawn only when the
 * lab answering this origin says it opens them: a lab older than the build
 * screen deals tables and 404s rooms, the lab that opens sealed rooms shipped
 * before the one that drafts them, and both are states somebody is running
 * today, so a section whose lab is too old says so instead of drawing a button
 * that 404s.
 *
 * The cost of the presses is three untokened routes, and `@mtg/netplay`'s
 * header states it rather than burying it: any device that can load this page
 * can cause the lab to deal a table, bounded by `MAX_LIVE_TABLES`. What it
 * cannot do is reach a table somebody is playing; the seat tokens go to
 * whoever pressed the button and nowhere else.
 *
 * # It asks before it says anything
 *
 * Three answers, three sentences. A lab that deals gets the press; a server
 * that is already holding a table dealt from a terminal gets told so, because
 * offering to start a second one there would be offering to replace the game
 * somebody came to play; nothing listening at all gets the command that starts a
 * lab which can deal. Until the probe answers, this section draws nothing: a
 * sentence that says *no table* for one frame and then contradicts itself is
 * worse than a beat of silence.
 */
import { createElement, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { canCopy, copyText } from '../../clipboard';
import { renderCopy } from '../../copy';
import { useTableServer } from '../../net/invite';
import { startDraft, startRoom, startTable } from '../../net/start-table';
import type { TableStart } from '../../net/start-table';

export const PLAY_LAN_LABEL = 'Play over LAN';
export const PLAY_LAN_COMMAND = 'npm run play';
export const PLAY_LAN_COPY_LABEL = 'Copy command';
export const PLAY_LAN_COPIED_LABEL = 'Copied';

/** The button, and what it says while the deal is in flight. */
export const PLAY_LAN_START_LABEL = 'Start a LAN table';
export const PLAY_LAN_DEALING_LABEL = 'Dealing the table';

/** The second button: the same table, with the decks left to the two players. */
export const PLAY_LAN_ROOM_LABEL = 'Build your own decks';
export const PLAY_LAN_ROOM_OPENING_LABEL = 'Opening the pools';

/** What the button does, in the order it happens. */
export const PLAY_LAN_START_BLURB =
  'Deal a table on this machine and get a link for the other player, with a code they ' +
  'can scan. They open it on their own device, on this network.';

/** The third button: the same room, with the pools taken pack by pack. */
export const PLAY_LAN_DRAFT_LABEL = 'Draft against each other';
export const PLAY_LAN_DRAFT_OPENING_LABEL = 'Dealing the packs';

/** What the second button does instead, said as the difference it makes. */
export const PLAY_LAN_ROOM_BLURB =
  'Or open a sealed pool each: you both build a deck from your own pool, and the game ' +
  'starts once you have both sent one.';

/** What the third button does, said as the difference from the second. */
export const PLAY_LAN_DRAFT_BLURB =
  'Or draft for it: you both pick a card at a time out of the same packs, and build out ' +
  'of what you took when the packs run out.';

/** What to run, when nothing on this origin is a lab that can deal one. */
export const PLAY_LAN_BLURB =
  'This page is not being served by a lab that can deal a table. Run `npm run play` in ' +
  'this folder and open the page it starts.';

/** What a page says when a table was already dealt from a terminal. */
export const PLAY_LAN_RUNNING =
  'A table is already running on this machine. Open the seat link `npm run netplay` printed.';

function CopyCommand(): ReactElement {
  const [copied, setCopied] = useState(false);
  const press = useCallback((): void => {
    void copyText(PLAY_LAN_COMMAND).then((ok) => {
      setCopied(ok);
    });
  }, []);
  return createElement(
    'button',
    { type: 'button', className: 'mtg-btn', onClick: press },
    copied ? PLAY_LAN_COPIED_LABEL : PLAY_LAN_COPY_LABEL,
  );
}

/** Which of the three games this section starts: one press per section. */
export type LanKind = 'table' | 'room' | 'draft';

export interface StartTableProps {
  readonly base: string;
  readonly kind: LanKind;
  /** Seats the caller at whatever this section dealt. */
  readonly onSeat: (token: string) => void;
}

interface StartButtonProps {
  readonly label: string;
  readonly busyLabel: string;
  readonly busy: boolean;
  readonly onPress: () => void;
}

function StartButton(props: StartButtonProps): ReactElement {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn',
      'data-variant': 'primary',
      disabled: props.busy,
      onClick: props.onPress,
    },
    props.busy ? props.busyLabel : props.label,
  );
}

interface Press {
  readonly label: string;
  readonly busyLabel: string;
  readonly blurb: string | null;
  readonly start: (base: string) => Promise<TableStart>;
}

/** The one press each kind of section draws, and what it says under it. */
const PRESSES: Readonly<Record<LanKind, Press>> = {
  table: { label: PLAY_LAN_START_LABEL, busyLabel: PLAY_LAN_DEALING_LABEL, blurb: null, start: startTable },
  room: {
    label: PLAY_LAN_ROOM_LABEL,
    busyLabel: PLAY_LAN_ROOM_OPENING_LABEL,
    blurb: PLAY_LAN_ROOM_BLURB,
    start: startRoom,
  },
  draft: {
    label: PLAY_LAN_DRAFT_LABEL,
    busyLabel: PLAY_LAN_DRAFT_OPENING_LABEL,
    blurb: PLAY_LAN_DRAFT_BLURB,
    start: startDraft,
  },
};

/**
 * The button, its in-flight state, and the reason it did nothing when it did.
 *
 * The button is disabled while its press is in flight: a deal opens two sealed
 * pools, which is long enough on a laptop for a second press to land, and the
 * second press would start a second game nobody asked for.
 *
 * A failure is drawn where the button is instead of replacing the section. The
 * things that fail here are the cap and a lab too old to deal this kind of
 * game, and every one of them is acted on by reading the sentence and pressing
 * again or restarting the lab; none is helped by taking the control away.
 */
function StartTable(props: StartTableProps): ReactElement {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { base, kind, onSeat } = props;
  const press = PRESSES[kind];

  const onPress = useCallback((): void => {
    setBusy(true);
    setProblem(null);
    void press.start(base).then((started) => {
      setBusy(false);
      if (started.ok) onSeat(started.token);
      else setProblem(started.message);
    });
  }, [base, press, onSeat]);

  return createElement(
    'div',
    { className: 'mtg-lanstart' },
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(StartButton, { label: press.label, busyLabel: press.busyLabel, busy, onPress }),
    ),
    press.blurb === null
      ? null
      : createElement('p', { className: 'mtg-playsection__blurb' }, renderCopy(press.blurb)),
    problem === null ? null : createElement('p', { className: 'mtg-page-note', role: 'status' }, problem),
  );
}

export interface LanSectionProps {
  /** Where a table would answer; `/api` when Vite is proxying, which it is. */
  readonly base: string;
  /**
   * Which game the section starts. The constructed section deals a table with
   * both decks built, the sealed section opens a room, the draft section a
   * room that drafts first; each draws its one press and none of the others.
   */
  readonly kind: LanKind;
  /** Seats the caller at the table, in the room, or in the drafting room this section opened. */
  readonly onSeat: (token: string) => void;
}

/** What the section says above its controls, for each thing the probe found. */
function lanBlurb(running: 'none' | 'seated' | 'dealing'): string {
  if (running === 'dealing') return PLAY_LAN_START_BLURB;
  return running === 'seated' ? PLAY_LAN_RUNNING : PLAY_LAN_BLURB;
}

/** What a lab that deals tables but is too old for this section's game is told. */
export function lanNotOffered(kind: LanKind): string {
  return kind === 'draft'
    ? 'The lab on this origin deals tables but does not draft. Restart it from a newer checkout to draft here.'
    : 'The lab on this origin deals tables but does not open rooms. Restart it from a newer checkout to open one.';
}

/**
 * Whether the lab answering the probe offers this section's game. Tables are
 * what every lab that deals at all deals; rooms and drafts are read off the
 * probe's own answer, because each shipped in a later lab than the one before.
 */
function offered(kind: LanKind, server: { readonly rooms: boolean; readonly drafts: boolean }): boolean {
  if (kind === 'table') return true;
  return kind === 'room' ? server.rooms : server.drafts;
}

export function LanSection(props: LanSectionProps): ReactElement | null {
  const server = useTableServer(props.base);
  const running = server.running;
  if (running === 'asking') return null;
  return createElement(
    'section',
    { className: 'mtg-playsection', 'data-boxed': 'true', 'aria-label': PLAY_LAN_LABEL },
    createElement('h2', { className: 'mtg-playsection__title' }, PLAY_LAN_LABEL),
    createElement('p', { className: 'mtg-playsection__blurb' }, renderCopy(lanBlurb(running))),
    running !== 'dealing'
      ? null
      : offered(props.kind, server)
        ? createElement(StartTable, { base: props.base, kind: props.kind, onSeat: props.onSeat })
        : createElement('p', { className: 'mtg-page-note', role: 'status' }, lanNotOffered(props.kind)),
    running === 'none' && canCopy()
      ? createElement('div', { className: 'mtg-toolbar' }, createElement(CopyCommand, null))
      : null,
  );
}
