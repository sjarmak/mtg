/**
 * The pass, and the two things only a screen reader was getting from the row it
 * used to sit in.
 *
 * # What this was, and why the band went
 *
 * `mtg-bz2.4` put the pass in a horizontal row at the foot of the table with the
 * priority sentence beside it. the playtester, 2026-08-14: "we can get rid of the
 * large 'you have priority pass' button area at the bottom now that we have the
 * pass button on the left". The band spanned the whole table and was `flex: none`
 * on the column that carries the viewport's height down to the mat, so it cost
 * 36.9 CSS px of that column at every viewport, whatever the game was doing.
 *
 * She is right that the pass is already on the left, twice over: the kernel
 * enumerates `passPriority` and the ask column lists it under `Turn`, and the
 * fixed button below is in that column now too. What the band held is here,
 * three inches up and one column over, where it costs the board nothing.
 *
 * # What was dropped rather than moved, and why that is not a loss
 *
 * The visible sentence — `You have priority`, and `the stack is empty` beside it
 * — is gone from the screen. It was a second copy of what the panel directly
 * above it already says in a fuller sentence: `../play/prompt.ts`'s `explainFor`
 * writes `<seat> may act, or pass and move the game on.` and, over a non-empty
 * stack, `<seat> may respond, or let the top of the stack resolve.`, under a
 * headline that reads `Priority`. The depth is on the stack zone's own head. Two
 * statements of one fact a hand's width apart is what `mtg-1th` had to keep in
 * agreement, and the cheapest way to keep two sentences agreeing is to have one.
 *
 * `priorityHolderText` and `stackDepthText` survive because the *announcement*
 * does, and the announcement is the half no visible panel can do: `role="status"`
 * fires on change, and `.mtg-prompt__explain` on a priority prompt is ordinary
 * text that a reader passes once. So the region still says who holds priority,
 * how deep the stack is and which step it is, and it still says it in the seat's
 * own label rather than at the seat id (`mtg-1th`) — the label is what stays true
 * on a hotseat table where neither seat is called `You`.
 *
 * ## Holding priority is a sentence here and a rule in the kernel
 *
 * There is deliberately no "hold priority" toggle. Magic Online needs one
 * because its client passes for you the moment you cast; this kernel keeps CR
 * 117.3c's retained priority and `@mtg/kernel`'s `stackWantsAnAnswer` refuses to
 * auto-pass any window over a spell the player could still answer — their own
 * included. So the window is always there, and what was missing was any sign of
 * it. `HELD_OVER_YOUR_OWN` is that sign, and it is the one clause here that is
 * still drawn: the ask column says a seat may respond and never says that the
 * thing on top is *theirs* to answer. It is drawn only while it is true, which is
 * a minority of priorities, so the foot is one button tall the rest of the time.
 *
 * A toggle was built first and thrown away. Twenty seeded games — five seeds by
 * four stop configurations — never once gave it an auto-pass to suppress, so
 * what shipped would have been a switch a player could leave off for a whole
 * game and never notice, protecting a window the kernel was already protecting
 * for them. A rule cannot be left off, and `autopass.ts` carries the measurement
 * and the argument.
 *
 * ## The live regions
 *
 * Named, because they are the third and fourth `role="status"` on this table —
 * the phase bar has `Stop changes` and the log has `Newest log entry`, and two
 * lanes already collided here once by each adding an unnamed one. Three unnamed
 * announcement channels are one channel.
 *
 * The first carries the whole sentence and no serial number, which is the one
 * place it departs from the log's digest. The log needs a number because two
 * identical entries in a row are two events; this region reports a *position*, so
 * identical text means nothing it reports has changed. The step is in it for the
 * same reason: two priorities the same player holds over the same stack in
 * different steps are two announcements rather than one.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { PlayerId } from '@mtg/kernel';
import { seatVerb } from '../../seat';
import { passButton } from './pass';
import type { SeatNames } from './position';

/** The accessible name of the block, which is how every test finds it. */
export const PRIORITY_LABEL = 'Priority';

/**
 * The announcement region's own name. See `PhaseBar.ts`'s
 * `PHASE_BAR_STATUS_LABEL` for why every one of these is named.
 */
export const PRIORITY_STATUS_LABEL = 'Priority changes';

/**
 * The name of the region that answers for the keyboard.
 *
 * The fourth named `role="status"` on this table, and named for the reason the
 * third was. It is separate from the one above rather than folded into it
 * because the two report different kinds of thing: that region states the
 * position and re-states it whenever the position changes, and this one answers
 * a press the player just made. Folding an answer into a running commentary
 * would make the answer arrive whenever the commentary next did.
 *
 * Visible as well as announced, which is the whole of `mtg-s9p`'s second half:
 * the complaint was that nothing on screen said why the key did nothing, and a
 * screen-reader-only region would have left that exactly as it was. It followed
 * the pass out of the band and into the ask column, because it is about the pass
 * rather than about the row the pass used to be in.
 */
export const PASS_KEY_STATUS_LABEL = 'Pass shortcut';

/**
 * What the surface says when the seat being asked holds priority over an object
 * of their own.
 *
 * The whole of "you may respond to your own spell", in the words a player would
 * use rather than in the rule's number.
 *
 * It carries no pronoun, and that is the second half of `mtg-1th`. The clause
 * used to open with `you`, which was true of the sentence it follows only while
 * that sentence said `You have priority`; once the holder is named, `Player two
 * has priority, you may respond to it` addresses two different people in one
 * line. Above the pass it continues the panel's own sentence, which already
 * names the seat being asked.
 */
export const HELD_OVER_YOUR_OWN = 'and may respond to it';

/**
 * Who holds priority, in a whole sentence, for the announcement.
 *
 * `mtg-1th`. This used to decide at the *seat id* — `holder === viewer` printed
 * `You have priority` — while the ask column two inches above it decided at the
 * label, so a hotseat table read `Player two may act, or pass and move the game
 * on.` over `You have priority`, about one seat at one moment. The docblock that
 * argued for the split argued it for a table where one seat is called `You`, and
 * on that table the two rules agree by construction: `names[viewer]` *is* `You`,
 * so this sentence is unchanged wherever it was ever right. Where they disagree
 * is the one configuration the naming rule exists for, and there the label is
 * the one that stays true.
 *
 * Null is a real answer rather than a gap. Priority is nobody's during a
 * resolution and at the questions that are not priorities at all — a mulligan, a
 * blocker assignment, an ordering — and those are precisely the moments a player
 * would otherwise wonder why the pass is dead.
 */
export function priorityHolderText(holder: PlayerId | null, names: SeatNames): string {
  if (holder === null) return 'Nobody has priority';
  const label = names[holder];
  return `${label} ${seatVerb(label, 'has', 'have')} priority`;
}

/** How deep the stack is, as the clause that follows the holder. */
export function stackDepthText(depth: number): string {
  if (depth === 0) return 'the stack is empty';
  return depth === 1 ? '1 object on the stack' : `${String(depth)} objects on the stack`;
}

export interface PriorityFootInput {
  /** `GameState.turn.priority`: the kernel's answer, never a guess. */
  readonly holder: PlayerId | null;
  readonly names: SeatNames;
  readonly stackDepth: number;
  /**
   * True when the viewer holds priority and the top of the stack is theirs —
   * `@mtg/kernel`'s `holdsOwnTopOfStack` over the pending decision, so the
   * surface and the auto-pass rule are reading one predicate rather than two
   * that could disagree about what the window is.
   */
  readonly overYourOwn: boolean;
  /**
   * The step in its own words, for the announcement; `stepLabel` writes it.
   *
   * The board header's `describeStep` is the wrong string here: it is three
   * fields joined by middle dots, which is a line to read and not a sentence to
   * hear.
   */
  readonly stepText: string;
  /** `passIndex`'s answer over the pending decision, or null; see `pass.ts`. */
  readonly passAt: number | null;
  readonly onPass: () => void;
  /**
   * What the pass key had to say about the last press it could not spend, or
   * null. `pass-key.ts` writes it and scopes it to one decision; this block draws
   * it because this block is where the pass is.
   */
  readonly keyNote?: string | null;
}

/**
 * The foot of the ask column: the fixed pass, and what a reader needs with it.
 *
 * In the pod column, between the panel and the near seat's own pod, so the
 * control the player reaches for most often is directly above their own vitals
 * and directly under the list of everything else they could do instead. It is a
 * sibling of the panel rather than a part of it, which is what keeps `pass.ts`'s
 * promise: three of the four panels that slot can hold have no pass in them, and
 * a button drawn inside the panel would leave the screen exactly when the answer
 * is no instead of being drawn unavailable.
 */
export function priorityFoot(input: PriorityFootInput): ReactElement {
  const { holder, names, stackDepth, overYourOwn, passAt, onPass } = input;
  const keyNote = input.keyNote ?? null;
  const who = priorityHolderText(holder, names);
  const depth = stackDepthText(stackDepth);
  return createElement(
    'div',
    { className: 'mtg-priority', role: 'group', 'aria-label': PRIORITY_LABEL },
    // The one clause the ask column above cannot give: that the object on top of
    // the stack is the asked seat's own, so the window is theirs to spend.
    overYourOwn ? createElement('p', { className: 'mtg-priority__own' }, HELD_OVER_YOUR_OWN) : null,
    passButton(passAt, onPass),
    // Always rendered: a live region has to be in the document before its text
    // changes or the change is silent.
    createElement(
      'span',
      {
        className: 'mtg-sr-only',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': PRIORITY_STATUS_LABEL,
      },
      `${who}, ${depth}${overYourOwn ? `, ${HELD_OVER_YOUR_OWN}` : ''}. ${input.stepText}.`,
    ),
    // Always in the document, for the reason the region above is: a live region
    // that arrives with its own text has nothing to announce, because nothing
    // about it changed.
    createElement(
      'p',
      {
        className: 'mtg-priority__key-note',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': PASS_KEY_STATUS_LABEL,
      },
      keyNote ?? '',
    ),
  );
}
