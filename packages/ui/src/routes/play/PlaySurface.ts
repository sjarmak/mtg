/**
 * The interaction controller shared by every live rules adapter.
 *
 * `PlayView` and `BackendGame` turn different rules projections into the slots
 * below. They do not own a second table shell: disclosure state, inspection,
 * the hand seam, prompt placement, the context rail, and the frame boundary
 * live here once.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement, ReactNode, Ref } from 'react';
import type { InspectedCard } from './inspect';
import { inspectedKey, useInspection } from './inspect';
import { askToggle, useAskCollapse } from './ask-collapse';
import { askAlert, askFlyout, useAskFlyout } from './ask-flyout';
import type { AskSlot } from './ask-flyout';
import { handSeamHandle, handSeamStyle, useHandSeam } from './hand-seam';
import { railToggle, useRailCollapse } from './rail-collapse';
import { PlayFrame } from './PlayFrame';
import { useCoarsePointer } from './pointer';
import { playTable } from './table';
import type { TableInput } from './table';
import { playDetails, playToolbar } from './toolbar';

export interface PlaySurfaceLayout {
  readonly askCollapsed: boolean;
  readonly askHead: ReactNode;
  readonly askFlyout: ReactNode;
  readonly prompt: ReactNode;
  readonly steps: ReactNode;
  readonly seam: ReactNode;
  readonly seamStyle?: Readonly<Record<string, string>>;
  readonly railCollapsed: boolean;
  readonly railHead: ReactNode;
  readonly rail: ReactNode;
}

type PlaySurfaceTable = Omit<TableInput, keyof PlaySurfaceLayout>;

interface RailJumpTarget {
  querySelector(selector: string): RailJumpTarget | null;
  scrollIntoView(options: { block: 'nearest'; inline: 'nearest' }): void;
}

export interface PlaySurfaceProps {
  readonly seatName: string;
  readonly slot: AskSlot;
  readonly panel: ReactNode;
  readonly priority: ReactNode;
  readonly steps: ReactNode;
  readonly stepText: string;
  readonly choicesMade: number;
  readonly decisions: number;
  readonly events: number;
  readonly opensItself: boolean;
  readonly toolbar?: ReactNode;
  readonly status?: ReactNode;
  readonly projectionVersion?: number;
  readonly rootRef?: Ref<HTMLDivElement>;
  readonly inspect: (key: string | null) => InspectedCard | null;
  readonly contextRail: (inspected: InspectedCard | null, reveal: string | null) => ReactNode;
  readonly onEscape?: (() => boolean) | undefined;
  /** Rules adapters supply facts and controls; this component owns the renderer. */
  readonly table: PlaySurfaceTable;
}

/** The normal play controller. Rules engines only adapt data into its slots. */
export function PlaySurface(props: PlaySurfaceProps): ReactElement {
  const coarse = useCoarsePointer();
  const ask = useAskCollapse();
  const rail = useRailCollapse();
  const seam = useHandSeam();
  const inspection = useInspection();
  const flyout = useAskFlyout({
    collapsed: ask.collapsed,
    slot: props.slot,
    decisions: props.decisions,
    events: props.events,
    opensItself: props.opensItself,
  });
  const seamStyle = handSeamStyle(seam.share);
  const layout: PlaySurfaceLayout = {
    askCollapsed: ask.collapsed,
    askHead: askToggle(ask),
    askFlyout: askFlyout(flyout.open, props.slot, props.panel),
    prompt: createElement(
      Fragment,
      null,
      playDetails({
        stepText: props.stepText,
        choicesMade: props.choicesMade,
        stepsDrawn: props.steps !== null,
      }),
      ask.collapsed ? null : props.panel,
      ask.collapsed ? askAlert(props.slot, flyout.open, flyout.toggle, coarse) : null,
      props.priority,
    ),
    steps: props.steps,
    seam: handSeamHandle(seam, props.seatName),
    ...(seamStyle === undefined ? {} : { seamStyle }),
    railCollapsed: rail.collapsed,
    railHead: railToggle(rail),
    rail: props.contextRail(
      props.inspect(inspection.key),
      inspection.reveal ?? (coarse ? inspection.key : null),
    ),
  };
  const table = playTable({ ...props.table, ...layout });

  return createElement(
    Fragment,
    null,
    props.status ?? null,
    createElement(PlayFrame, {
      table,
      toolbar: playToolbar(props.toolbar ?? null),
      ...(props.rootRef === undefined ? {} : { rootRef: props.rootRef }),
      ...(props.projectionVersion === undefined ? {} : { projectionVersion: props.projectionVersion }),
      onFocus: (event): void => {
        inspection.onFocus(event);
        if (!coarse) return;
        rail.expand();
        if (inspectedKey(event.target) === null) return;
        (event.currentTarget as unknown as RailJumpTarget | null)
          ?.querySelector('.mtg-board__rail')
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      },
      onInspect: (event): void => {
        rail.expand();
        inspection.onInspect(event);
      },
      onContextMenu: (event): void => {
        rail.expand();
        inspection.onContextMenu(event);
      },
      onEscape: (event): void => {
        if (props.onEscape?.() !== true) return;
        event.stopPropagation();
      },
    }),
  );
}
