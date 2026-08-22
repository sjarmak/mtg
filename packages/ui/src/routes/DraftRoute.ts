/** One human seat drafts the staged set with seven deterministic bots. */
import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { DraftError, runHumanDraft } from '@mtg/draft-export';
import { Card } from '../card/Card';
import { renderCopy } from '../copy';
import { DraftGame } from './draft/DraftGame';
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
  readonly artFor?: PositionArt;
}

function head(): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-page-head' },
    createElement('h1', { className: 'mtg-page-title' }, 'Draft'),
  );
}

function empty(title: string, message: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('h2', { className: 'mtg-empty__title' }, title),
    createElement('p', { className: 'mtg-empty__body' }, renderCopy(message)),
  );
}

function direction(round: number): string {
  return round % 2 === 1 ? 'passing left' : 'passing right';
}

export function DraftRoute(props: DraftRouteProps): ReactElement {
  const [fallbackSeed] = useState(() => newSeed('lab/draft'));
  if (props.set.status === 'loading') {
    return createElement(
      'div',
      null,
      head(),
      empty('Reading set.json…', 'The draft will open after the staged set is parsed.'),
    );
  }
  if (props.set.status === 'absent') {
    return createElement(
      'div',
      null,
      head(),
      empty('No set staged', 'Run `npm run play` to stage an executable set before drafting.'),
    );
  }
  if (props.set.status === 'failed') {
    return createElement('div', null, head(), empty('That staged set could not be read', props.set.message));
  }

  const inputs = readDraftInputs(props.params, fallbackSeed);
  if (!inputs.ok) {
    return createElement('div', null, head(), empty('The draft link is invalid', inputs.message));
  }

  let draft;
  try {
    draft = runHumanDraft(props.set.cards, { seed: inputs.seed });
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return createElement('div', null, head(), empty('This set cannot fill draft packs', message));
  }
  if (inputs.picks.length > 0) {
    try {
      draft = runHumanDraft(props.set.cards, { seed: inputs.seed, picks: inputs.picks });
    } catch (cause: unknown) {
      const message = cause instanceof DraftError ? cause.message : String(cause);
      return createElement(
        'div',
        null,
        head(),
        empty('The draft transcript does not match its seed', message),
      );
    }
  }

  if (draft.result !== null) {
    return createElement(DraftGame, {
      key: `${draft.seed}/${encodePickLog(draft.picks)}`,
      draft,
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    });
  }

  const next = draft.nextPick;
  if (next === null) throw new Error('an unfinished draft has no next pick');
  const pick = (card: DslCard): void => {
    props.onSetParams({ seed: draft.seed, picks: encodePickLog([...draft.picks, card.id]) });
  };
  return createElement(
    'div',
    { className: 'mtg-draft' },
    head(),
    createElement(
      'div',
      { className: 'mtg-toolbar', 'aria-live': 'polite' },
      createElement(
        'span',
        { className: 'mtg-fact' },
        createElement('span', { className: 'mtg-fact__label' }, 'stage'),
        createElement(
          'span',
          { className: 'mtg-fact__value' },
          `Pack ${String(next.round)} · pick ${String(next.pickNumber)}`,
        ),
      ),
      createElement(
        'span',
        { className: 'mtg-fact' },
        createElement('span', { className: 'mtg-fact__label' }, 'pack'),
        createElement(
          'span',
          { className: 'mtg-fact__value' },
          `${String(next.packSize)} cards · ${direction(next.round)}`,
        ),
      ),
      createElement(
        'span',
        { className: 'mtg-fact' },
        createElement('span', { className: 'mtg-fact__label' }, 'record'),
        createElement(
          'span',
          { className: 'mtg-fact__value' },
          `${String(draft.picks.length)} ${draft.picks.length === 1 ? 'pick' : 'picks'} recorded`,
        ),
      ),
      createElement(
        'span',
        { className: 'mtg-fact' },
        createElement('span', { className: 'mtg-fact__label' }, 'seed'),
        createElement('span', { className: 'mtg-fact__value' }, draft.seed),
      ),
      createElement('span', { className: 'mtg-toolbar__spacer' }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          onClick: (): void => props.onSetParams({ seed: newSeed('lab/draft'), picks: '' }),
        },
        'Start a new draft',
      ),
    ),
    createElement(
      'div',
      { className: 'mtg-panel' },
      createElement(
        'div',
        { className: 'mtg-panel__head' },
        createElement('span', { className: 'mtg-panel__title' }, 'Choose one card'),
        createElement(
          'span',
          { className: 'mtg-panel__note' },
          `opened by seat ${String(next.openedBy + 1)}`,
        ),
      ),
      createElement(
        'div',
        { className: 'mtg-panel__body' },
        createElement(
          'p',
          { className: 'mtg-prompt__explain' },
          'Seven bot seats choose at the same time. Activate a card to record your pick and receive the next pack.',
        ),
        createElement(
          'div',
          {
            className: 'mtg-gallery',
            role: 'group',
            'aria-label': `Draft pack ${String(next.round)}, pick ${String(next.pickNumber)}`,
          },
          ...next.cards.map((card, index) =>
            createElement(Card, {
              key: `${String(next.round)}/${String(next.pickNumber)}/${card.id}`,
              card,
              size: 'full',
              art: props.artFor?.(card) ?? null,
              autoFocus: index === 0,
              onSelect: pick,
            }),
          ),
        ),
      ),
    ),
  );
}
