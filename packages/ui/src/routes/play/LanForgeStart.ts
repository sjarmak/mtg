/**
 * The button that seats a Forge table two people reach over the network.
 *
 * # It asks the lab before it offers anything
 *
 * `/api/health` says which formats the lab's Forge will seat a table for, and
 * this section reads that answer through the same probe `./LanSection.ts` reads
 * for kernel tables. A lab with no game server, a lab started without a Forge
 * backend, and a lab whose Forge does not serve this format are three different
 * sentences, drawn beside a disabled button rather than in place of it, because
 * every one of them is acted on by starting the lab differently and pressing
 * again. Until the probe answers it draws nothing, for the reason the kernel
 * section gives: a sentence contradicted one frame later is worse than a beat
 * of silence.
 *
 * # What pressing it does
 *
 * `POST /api/observed` opens a table in its seating phase and answers two seat
 * links. The host's goes into the hash through `onStarted`, which mounts
 * `./ObservedSeat.ts` on this same page, and the guest's is drawn there by
 * `./LanInvite.ts` for the other person to open. The table is dealt no seed:
 * the lab draws one, so a page that opens two tables in a row deals two pools.
 */
import { createElement, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import type { ContentRef, MatchRules } from '@mtg/engine';
import { renderCopy } from '../../copy';
import { useTableServer } from '../../net/invite';
import type { TableRunning } from '../../net/invite';
import { lanForgeAvailability, startObservedTable } from '../../net/observed-table';
import type { LanForgeAvailability, ObservedTableStart } from '../../net/observed-table';
import { PLAY_LAN_COMMAND } from './LanSection';

export const LAN_FORGE_LABEL = 'Play over this network';
export const LAN_FORGE_START_LABEL = 'Start a Forge table';
export const LAN_FORGE_STARTING_LABEL = 'Starting table…';
export const LAN_FORGE_BLURB =
  'Two people build decks on their own devices and Forge on this lab plays the match between them. Start a table here, then send the other player the link this page shows.';
export const LAN_FORGE_NO_LAB = `Nothing is listening for tables at this address. Start the lab with \`${PLAY_LAN_COMMAND}\` on a machine that has Forge.`;
/** What the answer is while the probe is still out; never ready, for the reason below. */
export const LAN_FORGE_ASKING = 'Asking this lab whether its Forge will seat a table for this format…';

/** The table the lab opened, with the two seat links it minted. */
export type ObservedTableOpened = Extract<ObservedTableStart, { readonly ok: true }>;

export interface LanForgeStartProps {
  /** Where the table would answer; `/api` when Vite is proxying, which it is. */
  readonly base: string;
  /** The format id the lab advertises, and the table is opened for. */
  readonly format: string;
  /** What the table is played with, in the engine contract's words. */
  readonly content: ContentRef;
  /** The table's rules when the format states any; Commander tables do. */
  readonly rules?: MatchRules;
  /** Seats the caller as host at the table this section opened. */
  readonly onStarted: (opened: ObservedTableOpened) => void;
}

interface StartButtonProps {
  readonly base: string;
  readonly format: string;
  readonly content: ContentRef;
  readonly rules: MatchRules | undefined;
  readonly onStarted: (opened: ObservedTableOpened) => void;
}

function StartForgeTable(props: StartButtonProps): ReactElement {
  const [pressed, setPressed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { base, format, content, rules, onStarted } = props;
  const press = useCallback((): void => {
    setPressed(true);
    setProblem(null);
    const request = {
      format,
      content,
      seed: null,
      maximumTurns: null,
      ...(rules === undefined ? {} : { rules }),
    };
    void startObservedTable(base, request).then((started) => {
      setPressed(false);
      if (started.ok) onStarted(started);
      else setProblem(started.message);
    });
  }, [base, format, content, rules, onStarted]);
  return createElement(
    'div',
    null,
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          'data-variant': 'primary',
          disabled: pressed,
          onClick: press,
        },
        pressed ? LAN_FORGE_STARTING_LABEL : LAN_FORGE_START_LABEL,
      ),
    ),
    problem === null ? null : createElement('p', { className: 'mtg-page-note', role: 'status' }, problem),
  );
}

function unavailable(reason: string): ReactElement {
  return createElement(
    'div',
    null,
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(
        'button',
        { type: 'button', className: 'mtg-btn', disabled: true },
        LAN_FORGE_START_LABEL,
      ),
    ),
    createElement('p', { className: 'mtg-page-note', role: 'status' }, renderCopy(reason)),
  );
}

/**
 * What the probe found, as the sentence beside the button, or ready.
 *
 * An unanswered probe is unavailable rather than ready. This section draws
 * nothing at all while it is asking, but the landing frame that owns the LAN
 * cell (`../../dev/LabApp.ts`) has to draw the cell either way, and a cell that
 * goes live on an assumption and dark one frame later is worse than a cell that
 * says it is still asking.
 */
export function lanForgeSection(
  running: TableRunning,
  observed: readonly string[] | null,
  format: string,
): LanForgeAvailability {
  if (running === 'asking') return { status: 'unavailable', reason: LAN_FORGE_ASKING };
  if (running === 'none') return { status: 'unavailable', reason: LAN_FORGE_NO_LAB };
  return lanForgeAvailability(observed, format);
}

export function LanForgeStart(props: LanForgeStartProps): ReactElement | null {
  const server = useTableServer(props.base);
  if (server.running === 'asking') return null;
  const availability = lanForgeSection(server.running, server.observed, props.format);
  return createElement(
    'section',
    { className: 'mtg-playsection', 'data-boxed': 'true', 'aria-label': LAN_FORGE_LABEL },
    createElement('h2', { className: 'mtg-playsection__title' }, LAN_FORGE_LABEL),
    createElement('p', { className: 'mtg-playsection__blurb' }, LAN_FORGE_BLURB),
    availability.status === 'ready'
      ? createElement(StartForgeTable, {
          base: props.base,
          format: props.format,
          content: props.content,
          rules: props.rules,
          onStarted: props.onStarted,
        })
      : unavailable(availability.reason),
  );
}
