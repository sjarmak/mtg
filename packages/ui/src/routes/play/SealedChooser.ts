/**
 * The Sealed landing, for whichever set is being sealed.
 *
 * `mtg-a982g.5`. The staged set offered a boxed *Sealed* section with a line
 * about six boosters and a primary *Generate sealed pool*; a printed format
 * offered an `<h1>` and a button that said *Open sealed pool*, which is a
 * different promise in different words for the same press. One landing draws
 * both now: the section is this component and the two callers differ only in
 * the line above the button and in what they hang under it.
 *
 * A stored pool is offered by the caller rather than read here, because the two
 * callers store different things -- the staged set keeps one session
 * (`./sealed-session.ts`), a printed format lists its saved seeds
 * (`../printed/PrintedSavedSessions.ts`) -- and a component that read one of
 * them would be the staged set's section wearing a general name.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { playBlurb, playButton, playSection } from './PlayLanding';

export const PLAY_SEALED_LABEL = 'Sealed';
export const PLAY_GENERATE_LABEL = 'Generate sealed pool';
export const PLAY_RESUME_LABEL = 'Resume sealed pool';
export const PLAY_SEALED_BLURB = 'Open six boosters and build a 40-card deck out of them.';

/**
 * The line under Resume: what you would be going back to.
 *
 * Counts rather than adjectives, because a person's question is whether this is
 * the pool they remember, and "23 of 90 cut" answers it where "in progress"
 * does not.
 *
 * The seed used to be on the end of it and is not a fact about the pool a person
 * remembers; it is the name of a deal, and the surface that owns naming a deal
 * is the table (`./precon-strip.ts`). Nothing observable is lost -- the stored
 * session still carries it, and resuming still re-deals from it.
 */
export function resumeNote(poolSize: number, chosenCount: number): string {
  return `${String(chosenCount)} of ${String(poolSize)} cards cut.`;
}

/**
 * What a stored pool this set can no longer deal is called, instead of a button.
 *
 * A status line, not a paragraph. It ran to "The pool you had open was dealt
 * from a different set, so it cannot be reopened here", which spends two clauses
 * explaining a mechanism to somebody whose only decision is whether to open a
 * new pool.
 *
 * The second sentence is `mtg-dcxg.10`. The first shipped alone and under the
 * toolbar, which is where the *Resume* arm's note belongs -- that note describes
 * a button above it -- and the stale arm has no button of its own, so the sweep
 * photographed a bare statement at the foot of the panel with nothing offered
 * against it. There is exactly one thing to do here, so the line names it and is
 * drawn above the control that does it.
 */
export const PLAY_RESUME_STALE = 'Your saved pool is from another set. Generate a new one to play here.';

/** A stored pool this page can reopen, one it cannot, or no stored pool at all. */
export type SealedOffer =
  | { readonly kind: 'offer'; readonly note: string; readonly onResume: () => void }
  | { readonly kind: 'stale' }
  | { readonly kind: 'none' };

export interface SealedChooserProps {
  /** What this pool is dealt from; the default is the staged set's sentence. */
  readonly blurb?: string;
  /**
   * Why this set cannot fill a booster, when it cannot.
   *
   * Drawn in place of the two buttons rather than beside them. A set too thin
   * for a pack is a real state -- a truncated document, a rarity that generated
   * empty -- and a *Generate sealed pool* button over it is a control that
   * cannot do what it says.
   */
  readonly problem?: string;
  readonly offer?: SealedOffer;
  readonly onGenerate: () => void;
  /** What hangs under the toolbar: a printed format's saved pools, or nothing. */
  readonly after?: ReactElement | null;
}

export function SealedChooser(props: SealedChooserProps): ReactElement {
  if (props.problem !== undefined)
    return playSection({ label: PLAY_SEALED_LABEL, titled: true, boxed: true }, playBlurb(props.problem));
  const offer: SealedOffer = props.offer ?? { kind: 'none' };
  return playSection(
    { label: PLAY_SEALED_LABEL, titled: true, boxed: true },
    playBlurb(props.blurb ?? PLAY_SEALED_BLURB),
    offer.kind === 'stale'
      ? createElement('p', { className: 'mtg-page-note', role: 'status' }, PLAY_RESUME_STALE)
      : null,
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      playButton(PLAY_GENERATE_LABEL, 'primary', props.onGenerate),
      offer.kind === 'offer' ? playButton(PLAY_RESUME_LABEL, null, offer.onResume) : null,
    ),
    offer.kind === 'offer' ? playBlurb(offer.note) : null,
    props.after ?? null,
  );
}
