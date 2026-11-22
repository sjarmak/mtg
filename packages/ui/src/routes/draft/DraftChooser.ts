/**
 * What the Draft tab is before a draft: one action, and the draft you left.
 *
 * `mtg-tewc.7`. Pressing Draft used to open pack 1 pick 1 of a draft nobody had
 * asked for, dealt from a seed invented on mount, and leaving the tab for the
 * Cards page threw it away — the next visit invented another one. So there was
 * no state in which a person could decide to draft, and no state in which the
 * one they were in the middle of still existed.
 *
 * It is `../play/PlayChooser.ts`'s Sealed section in its own words, deliberately:
 * a blurb, a primary control that starts a new one, a Continue beside it when
 * there is something to continue, and a line under it saying what that is. Two
 * surfaces that offer the same bargain should read the same way.
 *
 * The draft against another person is the other column of the same choice
 * (`../play/OpponentChoice.ts`), so this section says nothing about it: it is
 * the bot's column, the packs cut from whichever set the section is playing.
 *
 * `mtg-a982g.5`. That set is now any set the Draft section lists, so this is
 * every draft landing rather than the staged set's: a printed format and the
 * Legacy Cube draw it too, differing in the line under the label and in what
 * hangs below the toolbar. They used to draw a bare *Start draft* and a *New
 * Legacy Cube draft* under a page title of their own, which is three programs
 * offering the same bargain in three shapes.
 *
 * There is no set selector here. The chips above the landing are the choice
 * (`../play/SourceChoice.ts`), and a second control would be a second answer to
 * a question this section does not own. The set is *named* rather than chosen,
 * because "New draft" over an unnamed set is a button that does not say what it
 * will deal.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderCopy } from '../../copy';
import { playBlurb, playButton, playSection } from '../play/PlayLanding';

export const DRAFT_SET_LABEL = 'Draft';
export const DRAFT_NEW_LABEL = 'New draft';
export const DRAFT_RESUME_LABEL = 'Continue draft';

export const DRAFT_BLURB =
  'Eight seats, three packs. You pick, seven bots pick beside you, and the pool becomes a deck.';

/**
 * The line under Continue: what you would be going back to.
 *
 * Counts rather than adjectives, for `resumeNote`'s reason on the sealed side: a
 * person's question is whether this is the draft they remember, and "14 of 45
 * picks made" answers it where "in progress" does not.
 */
export function draftResumeNote(picksMade: number, totalPicks: number): string {
  return `${String(picksMade)} of ${String(totalPicks)} picks made.`;
}

/**
 * What a stored draft this set can no longer deal is called, instead of a button.
 *
 * A status line above the control that resolves it, which is where
 * `PLAY_RESUME_STALE` ended up after the same mistake: the stale arm has no
 * button of its own, so a bare statement at the foot of the panel left the
 * reader with a problem and nothing offered against it.
 */
export const DRAFT_RESUME_STALE = 'Your saved draft is from another set. Start a new one to draft here.';

/** A stored draft this page can reopen, one it cannot, or no stored draft at all. */
export type DraftOffer =
  | { readonly kind: 'offer'; readonly note: string; readonly onResume: () => void }
  | { readonly kind: 'stale' }
  | { readonly kind: 'none' };

export interface DraftChooserProps {
  /** The set this section is playing, named so the button says what it will deal. */
  readonly setName?: string;
  /** What a draft of this set is, in one line. */
  readonly blurb?: string;
  readonly offer: DraftOffer;
  readonly onNew: () => void;
  /** What hangs under the toolbar: a printed format's saved drafts, or nothing. */
  readonly after?: ReactElement | null;
}

export function DraftChooser(props: DraftChooserProps): ReactElement {
  const { offer } = props;
  return playSection(
    { label: DRAFT_SET_LABEL, titled: true, boxed: true },
    props.setName === undefined ? null : createElement('p', { className: 'mtg-page-note' }, props.setName),
    playBlurb(renderCopy(props.blurb ?? DRAFT_BLURB)),
    offer.kind === 'stale'
      ? createElement('p', { className: 'mtg-page-note', role: 'status' }, DRAFT_RESUME_STALE)
      : null,
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      playButton(DRAFT_NEW_LABEL, 'primary', props.onNew),
      offer.kind === 'offer' ? playButton(DRAFT_RESUME_LABEL, null, offer.onResume) : null,
    ),
    offer.kind === 'offer' ? playBlurb(offer.note) : null,
    props.after ?? null,
  );
}
