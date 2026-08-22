/**
 * Browser entry point for `packages/ui/index.html`.
 *
 * The card list is the DSL's own example set, committed, so the dev app is
 * alive without a build step and without reading `out/`.
 *
 * The analysis documents are neither committed nor derivable from it: a
 * measured run is a sweep somebody paid for, true about one set at one
 * revision. `npm run analyze` writes them and a fresh checkout gets the
 * Analysis tab's `absent` state naming that command.
 *
 * The statistics log is the same kind of thing and used to be treated as the
 * card list instead — a committed three-game slice of a TGR run, served under
 * whatever set the lab had opened. `npm run play` stages one now, and only when
 * a log on disk is about the set being played (`tools/stage-run-log.ts`).
 *
 * The event log is not committed and deliberately: a recorded game is about a
 * megabyte, and one in git is a megabyte that quietly stops matching the engine
 * the day the kernel changes how a game plays. `npm run play` records it from
 * pinned seeds before it opens the lab, and a bare `vite dev` gets the Replay
 * tab's `absent` state naming that command.
 */
import { createElement } from 'react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from './dev/LabApp';
import { SET_INDEX_URL } from './lab/set-index';
import { mount } from './mount';

mount(
  'root',
  createElement(LabApp, {
    // Staged by `npm run play` when a statistics log about the staged set is on
    // disk; absent otherwise, which leaves the Analysis tab's games section
    // naming `npm run slice` rather than summarizing somebody else's run.
    replayUrl: 'replay.slice.jsonl',
    // Written by `npm run analyze`; absent in a fresh checkout, which leaves the
    // Analysis tab naming that command rather than showing an empty dashboard.
    analysisUrl: 'analysis.json',
    // Static reference profiles staged for the executable set by `npm run play`.
    calibrationUrl: 'calibration.json',
    // Optional paired before/after proposal. Missing is a named Analysis state.
    retuneUrl: 'retune.json',
    // Staged by `npm run play`; absent in a plain `vite dev`, which leaves the
    // Replay tab saying which command records one.
    eventLogUrl: 'replay.events.jsonl',
    // Staged by `npm run play`; absent in a plain `vite dev`, which falls back
    // to dealing sealed packs from the example cards. The fallback for a page
    // with no index: when the index below resolves, the set, its art and its
    // decks all come off the row the picker has selected.
    setUrl: 'set.json',
    // One row per set `npm run play` found and staged, each a bundle under
    // `public/sets/<stem>/`. The shell draws a picker over it, so switching
    // sets is a click rather than a server restart. Absent in a plain `vite
    // dev`, which leaves the three flat urls above answering as they always did.
    setIndexUrl: SET_INDEX_URL,
    // Staged by `npm run lab`; absent until something builds a deck, which the
    // Deck tab says rather than showing an empty page.
    deckUrl: 'deck.json',
    // Staged by `npm run play` alongside the set, when a precon file exists for
    // it. Absent leaves the Play tab a sealed builder and nothing else.
    preconUrl: 'precons.json',
    // Staged by `npm run play` alongside the set, when that set has been through
    // the art pipeline. Absent leaves every card on its pending frame.
    artUrl: 'art.json',
    cards: EXAMPLE_CARDS,
    title: 'MTG Lab',
    subtitle: 'play, analyze, replay',
  }),
);
