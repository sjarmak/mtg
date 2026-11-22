/**
 * Play, before a game: what is there to play, and which of it do you want?
 *
 * `mtg-tewc.5`. the playtester's specification for this page is a question — "Play
 * answers 'what do I want to play?'" — and what stood here answered a different
 * one. `BuilderSwitch`, the component that stood here, was two tabs, *Preconstructed decks* and *Open a
 * sealed pool*, which asks which builder you would like to look at; whichever
 * you were not looking at was not on the page at all. Two named sections, both
 * on screen, is the shape of the question she asked for: here are the decks
 * this set ships with, and here is a sealed pool you can open instead.
 *
 * # A set with no decks has no Decks section
 *
 * Not an empty one, not one that says "none". M11 and M13 ship no precons and
 * never will, and "do not show an empty Preconstructed Decks section" is the
 * instruction for exactly that. So `decks` is optional and its absence removes
 * the heading with it — the same rule `groupSetsByOrigin` follows for an empty
 * shelf.
 *
 * # Sealed is a control here, not a builder
 *
 * A sealed pool is *dealt*, and dealing one to draw a section nobody pressed is
 * how six packs get opened for a person who came to play a precon. So the
 * section holds two buttons and the builder replaces this whole screen when one
 * is pressed. Which is also what makes Resume possible: leaving the builder is
 * now a thing you can do, so the pool has to survive it, and
 * `./sealed-session.ts` is that half. The section itself is
 * `./SealedChooser.ts`, which a printed format's landing draws too: one press
 * offered in one shape whatever the boosters were printed from.
 *
 * # Two columns, one per opponent, and the sub says which game
 *
 * `mtg-a982g.1`. The hash names the game (`#/play/constructed`, `/sealed`,
 * `/draft`, `/commander`) and this chooser draws that one game's two ways of
 * being played: against a bot in this tab, or over this network against a
 * person (`./OpponentChoice.ts`). The frame around them is `./PlayLanding.ts`,
 * shared with the printed and cube landings so all three read the same. Which of the two cells can be pressed is
 * one function's answer (`./availability.ts`), so a column that cannot deal
 * says why beside its button instead of vanishing; Commander says so in both.
 *
 * The bot column is what this page always was, one section at a time: the
 * decks under `constructed`, the sealed controls under `sealed`, the draft
 * chooser the route hands in under `draft`. The network column is
 * `./LanSection.ts` asked for the one press that game needs -- a table, a
 * room, or a drafting room -- and it still draws itself only once it has asked
 * what is listening, so a chooser that never gets a `tableBase` (a test, a
 * static render) is the bot column alone.
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card } from '@mtg/dsl';
import type { PackCollation } from '@mtg/deckbuild';
import { LanSection } from './LanSection';
import type { LanKind } from './LanSection';
import { useOpponent } from './OpponentChoice';
import { PlayLanding, playSection } from './PlayLanding';
import { SealedChooser, resumeNote } from './SealedChooser';
import type { SealedOffer } from './SealedChooser';
import type { AvailabilityFacts, Opponent, PlayFormat } from './availability';
import { readSealedSession, resumeSealed, sessionSummary } from './sealed-session';
import type { SealedBuild } from './sealed';
import type { PlaySource } from './sources';

/** What the Sealed section was pressed for: a fresh pool, or the stored one. */
export type SealedStart =
  { readonly kind: 'new' } | { readonly kind: 'resume'; readonly build: SealedBuild; readonly seed: string };

export interface PlayChooserProps {
  /** The set's own name, when the page knows which set it is showing. */
  readonly setName?: string;
  /** What kind of set that is, in the words a person reads: `Custom`, `Magic`. */
  readonly setKind?: string;
  /** Which game this page is choosing for: the sub off the hash. */
  readonly sub: PlayFormat;
  /**
   * What this section can be played with, and which of it is showing.
   *
   * Empty where nothing hands a list in -- a test, a static render, the launcher
   * before its index is read -- and the chips are then not drawn at all, which
   * is the same rule `./SourceChoice.ts` applies to a section with one source.
   */
  readonly sources?: readonly PlaySource[];
  readonly selectedSource?: string | null;
  readonly onSource?: (stem: string) => void;
  /**
   * Which column is open. Absent, the chooser keeps its own choice, starting
   * on the bot, so a page rendered without a hash to write to still works.
   */
  readonly opponent?: Opponent;
  /** Where the press of a cell goes when the hash owns the choice. */
  readonly onOpponent?: (opponent: Opponent) => void;
  /** What each column can do here, as `./availability.ts` reads it. */
  readonly facts: AvailabilityFacts;
  /** The draft chooser, drawn as the bot column of the `draft` sub. */
  readonly draft?: ReactElement;
  /**
   * The decks this set ships with. Omitted — not empty — when it ships none.
   */
  readonly decks?: (onPlayingChange: (playing: boolean) => void) => ReactElement;
  /** The sealed builder, over a fresh pool or a resumed one. */
  readonly sealed: (start: SealedStart, onPlayingChange: (playing: boolean) => void) => ReactElement;
  /** The cards a stored pool would be re-dealt from, so Resume can be checked. */
  readonly set: readonly Card[];
  /** The sheets that dealt it, when this document carries any. */
  readonly collation?: PackCollation;
  /**
   * Why this set cannot fill a booster, when it cannot.
   *
   * Drawn in place of the two buttons rather than beside them. A set too thin
   * for a pack is a real state — a truncated document, a rarity that generated
   * empty — and a *Generate sealed pool* button over it is a control that
   * cannot do what it says.
   */
  readonly sealedProblem?: string;
  /**
   * Where a LAN table would answer, when this host has one to ask.
   *
   * Passed down rather than defaulted here, because the default belongs to the
   * route that owns the proxy path (`../PlayRoute.ts`), and a chooser that
   * invented one would probe an origin nobody configured.
   */
  readonly tableBase?: string;
  /**
   * Seats this page at a table the LAN section just dealt.
   *
   * The token goes into the hash and the route reads it back, which is what
   * makes the seat a link: the same press that deals the table also produces
   * the address of it, and reloading the tab comes back to the same game.
   * Absent leaves the `constructed` sub's network column with nothing to draw,
   * because a button that dealt a table and then went nowhere would be a
   * control that cannot do what it says; `facts.lan` is where the route says so.
   */
  readonly onTable?: (token: string) => void;
  /**
   * Seats this page in a room the LAN section opened, to build a deck in.
   *
   * Separate from `onTable` because the two produce different links and land on
   * different screens: a table has both decks already, a room has two pools and
   * two people about to cut them. It is the `sealed` sub's press; the lab may
   * also be one that does not open rooms, which the section reads for itself.
   */
  readonly onRoom?: (token: string) => void;
  /**
   * Seats this page in a drafting room the LAN section opened.
   *
   * The same address as `onRoom` — a drafting room is a room, and the seat is
   * the same token from the first pack to the last turn — and a separate prop
   * for the same reason `onRoom` is separate from `onTable`: it is the `draft`
   * sub's press, and the one that decides whether that sub has a network column.
   */
  readonly onDraft?: (token: string) => void;
  readonly onPlayingChange?: (playing: boolean) => void;
  /**
   * The count of landing-screen requests off the router (`../../app/router.ts`).
   *
   * The sealed builder replaces this whole screen, and it does it in state under
   * an unchanged `#/play`, so the mark in the corner could not reach it: the
   * press assigned the hash it already had and nothing happened. A change here
   * is that press, and this screen is what it asks for.
   *
   * The build is not lost by going back. Every edit is written to the stored
   * session (`./SealedGame.ts`), so it comes back as the Resume control below —
   * which is why the offer is re-read when this number moves rather than only at
   * mount.
   */
  readonly landing?: number;
}

export const PLAY_DECKS_LABEL = 'Preconstructed decks';
/**
 * The constructed column of a set that ships no decks and has none built.
 *
 * Not an empty Decks section and not one that says "none" -- "do not show an
 * empty Preconstructed Decks section" still holds -- but the column cannot be
 * blank either, because a blank column under a pressed cell reads as a page
 * that has not finished loading. One line, naming the two ways to get a deck.
 */
export const PLAY_NO_DECKS_NOTE =
  'This set ships no decks to play. Build one on the Customize page, or open a sealed pool.';

/** A stored pool this page can reopen, one it cannot, or no stored pool at all. */
type ResumeOffer =
  | { readonly kind: 'offer'; readonly start: SealedStart; readonly note: string }
  | { readonly kind: 'stale' }
  | { readonly kind: 'none' };

/**
 * Whether the stored pool can be put back on this page, worked out once.
 *
 * Checked at mount rather than at the press, and that costs one pool-open: the
 * alternative is a Resume control that fails after somebody presses it, and a
 * control that cannot do what it says is the thing this repository refuses to
 * draw. The cost is the deal `SealedGame` performs on every mount anyway, and it
 * is only paid when a session exists at all.
 */
function useResume(
  set: readonly Card[],
  collation: PackCollation | undefined,
  /** Re-read when this moves: a person sent back here may have left a build. */
  landing: number | undefined,
): ResumeOffer {
  return useMemo((): ResumeOffer => {
    const session = readSealedSession();
    if (session === null) return { kind: 'none' };
    const resumed = resumeSealed(session, set, collation ?? null);
    if (!resumed.ok) return { kind: 'stale' };
    const summary = sessionSummary(session);
    return {
      kind: 'offer',
      start: { kind: 'resume', build: resumed.build, seed: resumed.seed },
      note: resumeNote(summary.poolSize, summary.chosenCount),
    };
  }, [set, collation, landing]);
}

/** Which press the network column makes for this game; Commander has none yet. */
function lanKind(sub: PlayFormat): LanKind | null {
  switch (sub) {
    case 'constructed':
      return 'table';
    case 'sealed':
      return 'room';
    case 'draft':
      return 'draft';
    case 'commander':
      return null;
  }
}

/** The seat callback that press hands its token to, when the route wired one. */
function seatFor(props: PlayChooserProps, kind: LanKind): ((token: string) => void) | undefined {
  switch (kind) {
    case 'table':
      return props.onTable;
    case 'room':
      return props.onRoom;
    case 'draft':
      return props.onDraft;
  }
}

function lanColumn(props: PlayChooserProps): ReactElement | null {
  const kind = lanKind(props.sub);
  if (kind === null || props.tableBase === undefined) return null;
  const onSeat = seatFor(props, kind);
  if (onSeat === undefined) return null;
  return createElement(LanSection, { base: props.tableBase, kind, onSeat });
}

/** The stored pool as the section reads it: a note and the press that restores it. */
function sealedOffer(resume: ResumeOffer, onStart: (start: SealedStart) => void): SealedOffer {
  if (resume.kind !== 'offer') return resume;
  return {
    kind: 'offer',
    note: resume.note,
    onResume: () => {
      onStart(resume.start);
    },
  };
}

function botColumn(
  props: PlayChooserProps,
  playing: boolean,
  report: (playing: boolean) => void,
  resume: ResumeOffer,
  onStart: (start: SealedStart) => void,
): ReactElement | null {
  switch (props.sub) {
    case 'constructed':
      return props.decks === undefined
        ? createElement('p', { className: 'mtg-page-note', role: 'status' }, PLAY_NO_DECKS_NOTE)
        : playSection({ label: PLAY_DECKS_LABEL, titled: !playing, boxed: false }, props.decks(report));
    case 'sealed':
      return createElement(SealedChooser, {
        offer: sealedOffer(resume, onStart),
        onGenerate: () => {
          onStart({ kind: 'new' });
        },
        ...(props.sealedProblem === undefined ? {} : { problem: props.sealedProblem }),
      });
    case 'draft':
      return props.draft ?? null;
    case 'commander':
      return null;
  }
}

export function PlayChooser(props: PlayChooserProps): ReactElement {
  const [started, setStarted] = useState<SealedStart | null>(null);
  const [playing, setPlaying] = useState(false);
  const [opponent, onOpponent] = useOpponent(props.opponent, props.onOpponent);
  const resume = useResume(props.set, props.collation, props.landing);
  const { onPlayingChange } = props;
  // Stable across renders because `PreconGame` reads it in an effect dependency
  // list: a fresh function every render re-runs that effect every render.
  const report = useCallback(
    (next: boolean): void => {
      setPlaying(next);
      onPlayingChange?.(next);
    },
    [onPlayingChange],
  );
  // The press of the mark, obeyed. `started` is the only thing between this
  // screen and the builder, so putting the screen back is putting it to null.
  const landing = props.landing;
  const asked = useRef(landing);
  useEffect(() => {
    if (landing === asked.current) return;
    asked.current = landing;
    setStarted(null);
    report(false);
  }, [landing, report]);
  if (started !== null) return props.sealed(started, report);
  return createElement(PlayLanding, {
    setKind: 'kernel',
    format: props.sub,
    sources: props.sources ?? [],
    selected: props.selectedSource ?? null,
    onSource: props.onSource ?? noSource,
    opponent,
    onOpponent,
    facts: props.facts,
    playing,
    bot: botColumn(props, playing, report, resume, setStarted),
    lan: lanColumn(props),
    ...(props.setName === undefined ? {} : { setName: props.setName }),
    ...(props.setKind === undefined ? {} : { setLabel: props.setKind }),
  });
}

/** A chooser given no list has no chips to press, so the press goes nowhere. */
function noSource(): void {
  return undefined;
}
