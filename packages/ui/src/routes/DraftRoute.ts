/**
 * One human seat drafts the staged set with seven deterministic bots.
 *
 * The tab opens on a choice rather than on a pack (`mtg-tewc.7`): a seed in the
 * URL is a draft in progress and is drawn as one, and no seed at all is
 * `./draft/DraftChooser.ts` — New draft, and Continue when the browser is
 * holding one. Inventing a seed on mount, which is what this route used to do,
 * meant every visit dealt a draft nobody asked for and threw away the one
 * before it.
 */
import { createElement, Fragment, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import type { PackCollation } from '@mtg/deckbuild';
import { DEFAULT_NATIVE_DRAFT_BOT_POLICY, DraftError, draftedPool, runHumanDraft } from '@mtg/draft-export';
import { renderCopy } from '../copy';
import type { StagedCollation } from '../lab/staged-collation';
import { COLLATION_UNUSABLE_TITLE } from './PlayRoute';
import { DraftGame } from './draft/DraftGame';
import type { DeckSetRef } from './deck/library';
import { DraftPack } from './draft/DraftPack';
import { DraftChooser } from './draft/DraftChooser';
import type { DraftOffer } from './draft/DraftChooser';
import { draftResumeNote } from './draft/DraftChooser';
import { clearDraftSession, readDraftSession, resumeDraft, writeDraftSession } from './draft/draft-session';
import { encodePickLog, readDraftInputs } from './draft/params';
import type { DraftRouteParams } from './draft/params';
import type { PositionArt } from './play/position';
import { newSeed } from './play/seed';

export { encodePickLog } from './draft/params';
export type { DraftRouteParams } from './draft/params';

export type DraftSetState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly cards: readonly DslCard[] }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

export interface DraftRouteProps {
  readonly set: DraftSetState;
  readonly params: DraftRouteParams;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  /** The set the header is on, named on the chooser so New draft says what it deals. */
  readonly setName?: string;
  /**
   * That same set as the deck library records it, for a deck kept off the
   * build screen. Absent where the page has no index row to read an origin off.
   */
  readonly setRef?: DeckSetRef;
  /**
   * The printing's own sheets, absent, or present and undealable (`mtg-nmqp`).
   *
   * A staged printing carries the collation it was really opened on, and the
   * Play tab has always dealt from it. This tab derived sheets from DSL rarities
   * instead, so one lab dealt a reduced M11 two different packs and said so
   * nowhere. Ready means the pod opens the printing's packs; unusable is said
   * above the pack rather than swallowed, because the packs are the reason
   * somebody staged a printing.
   */
  readonly collation?: StagedCollation;
  readonly artFor?: PositionArt;
}

/**
 * Whether the stored draft can be put back on this page, worked out once.
 *
 * Checked while the chooser is drawn rather than at the press, which is
 * `useResume`'s bargain on the sealed side and costs the same thing: one
 * re-deal, paid only when a session exists at all. A Continue that fails after
 * somebody presses it is the control this repository refuses to draw.
 */
function useDraftOffer(
  set: DraftSetState,
  onSetParams: (params: Readonly<Record<string, string>>) => void,
  sheets: PackCollation | null,
): DraftOffer {
  return useMemo((): DraftOffer => {
    if (set.status !== 'ready') return { kind: 'none' };
    const session = readDraftSession();
    if (session === null) return { kind: 'none' };
    const resumed = resumeDraft(session, set.cards, sheets ?? undefined);
    if (!resumed.ok) return { kind: 'stale' };
    return {
      kind: 'offer',
      note: draftResumeNote(resumed.picks.length, resumed.totalPicks),
      onResume: (): void => {
        onSetParams({
          seed: resumed.seed,
          picks: encodePickLog([...resumed.picks]),
          bot: resumed.botPolicy,
        });
      },
    };
  }, [set, onSetParams, sheets]);
}

function empty(title: string, message: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('h2', { className: 'mtg-empty__title' }, title),
    createElement('p', { className: 'mtg-empty__body' }, renderCopy(message)),
  );
}

export function DraftRoute(props: DraftRouteProps): ReactElement {
  const [fallbackSeed] = useState(() => newSeed('lab/draft'));
  const collation = props.collation ?? { kind: 'none' };
  const sheets: PackCollation | null = collation.kind === 'ready' ? collation.collation : null;
  // The pack every seat opens. Empty is the rarity recipe `runHumanDraft`
  // derives, which is every generated set and is not a shortfall.
  const deal = sheets === null ? {} : { collation: sheets };
  // What the reduction cost these packs is not said on this tab either, for
  // `./PlayRoute.ts`'s reason and with more force: a draft opens twenty-four
  // packs above a chooser somebody came to press, and the provenance was eight
  // sentences of it. The launcher's stdout and `reduced.json` keep every word.
  //
  // A collation this document carries and cannot deal still stands, because it
  // is an error about the packs this tab is about to deal instead.
  const notes = collation.kind === 'unusable' ? [`${COLLATION_UNUSABLE_TITLE}: ${collation.message}`] : [];
  const withNotes = (body: ReactElement): ReactElement =>
    notes.length === 0
      ? body
      : createElement(
          Fragment,
          null,
          ...notes.map((line, index) =>
            createElement(
              'p',
              { key: `note-${String(index)}`, className: 'mtg-page-note', role: 'status' },
              renderCopy(line),
            ),
          ),
          body,
        );
  const offer = useDraftOffer(props.set, props.onSetParams, sheets);
  if (props.set.status === 'loading') {
    return createElement(
      'div',
      null,
      empty('Reading set.json…', 'The draft will open after the staged set is parsed.'),
    );
  }
  if (props.set.status === 'absent') {
    return createElement(
      'div',
      null,
      empty('No set staged', 'Run `npm run play` to stage an executable set before drafting.'),
    );
  }
  if (props.set.status === 'failed') {
    return createElement('div', null, empty('That staged set could not be read', props.set.message));
  }

  // No seed is no draft, which is a state this tab did not have: it is the one
  // place a person can start one deliberately or go back to the one they left.
  if (props.params.seed === undefined) {
    return withNotes(
      createElement(
        'div',
        null,
        createElement(DraftChooser, {
          offer,
          ...(props.setName === undefined ? {} : { setName: props.setName }),
          onNew: (): void => {
            clearDraftSession();
            props.onSetParams({
              seed: newSeed('lab/draft'),
              picks: '',
              bot: DEFAULT_NATIVE_DRAFT_BOT_POLICY,
            });
          },
        }),
      ),
    );
  }

  const inputs = readDraftInputs(props.params, fallbackSeed);
  if (!inputs.ok) {
    return createElement('div', null, empty('The draft link is invalid', inputs.message));
  }

  let fresh;
  try {
    fresh = runHumanDraft(props.set.cards, {
      ...deal,
      seed: inputs.seed,
      botPolicy: inputs.botPolicy,
    });
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return createElement('div', null, empty('This set cannot fill draft packs', message));
  }
  // Pack 1 pick 1 as this page deals it, which is what a stored draft is checked
  // against when it comes back (`./draft/draft-session.ts`).
  const packIds = fresh.nextPick?.cards.map((card) => card.id) ?? [];
  let draft = fresh;
  if (inputs.picks.length > 0) {
    try {
      draft = runHumanDraft(props.set.cards, {
        ...deal,
        seed: inputs.seed,
        picks: inputs.picks,
        botPolicy: inputs.botPolicy,
      });
    } catch (cause: unknown) {
      const message = cause instanceof DraftError ? cause.message : String(cause);
      return createElement('div', null, empty('The draft transcript does not match its seed', message));
    }
  }

  if (draft.result !== null) {
    return withNotes(
      createElement(DraftGame, {
        key: `${draft.botPolicy}/${draft.seed}/${encodePickLog(draft.picks)}`,
        draft,
        set: props.set.cards,
        ...(props.setRef === undefined ? {} : { setRef: props.setRef }),
        ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
      }),
    );
  }

  const next = draft.nextPick;
  if (next === null) throw new Error('an unfinished draft has no next pick');
  const seat = draft.seats[draft.humanSeat];
  if (seat === undefined) throw new Error('the human seat is missing from this draft');
  return withNotes(
    createElement(DraftPack, {
      draft,
      next,
      pool: draftedPool(seat),
      cards: props.set.cards,
      onPick: (card: DslCard): void => {
        const picks = [...draft.picks, card.id];
        writeDraftSession(draft.seed, picks, packIds, draft.botPolicy);
        props.onSetParams({
          seed: draft.seed,
          picks: encodePickLog(picks),
          bot: draft.botPolicy,
        });
      },
      onNewDraft: (): void => {
        clearDraftSession();
        props.onSetParams({
          seed: newSeed('lab/draft'),
          picks: '',
          bot: DEFAULT_NATIVE_DRAFT_BOT_POLICY,
        });
      },
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    }),
  );
}
