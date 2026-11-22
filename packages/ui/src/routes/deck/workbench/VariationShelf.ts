/**
 * The shelf: every variation built here, newest first, with its lineage.
 *
 * This is the half that replaces a conversation. A chat keeps its history as
 * prose nobody can re-run; a shelf keeps it as documents that can be reopened,
 * compared and dealt a game. "Make it cheaper" is a row whose parent is the row
 * above it, so what changed between two builds is a diff rather than a memory.
 *
 * A row is drawn from a summary rather than a whole deck. Thirty variations is
 * thirty decklists, and sending them to draw a list would make opening this tab
 * proportional to how much work has been done in it.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { VariationSummary } from './client';

export const SHELF_LABEL = 'Variations';
export const SHELF_EMPTY_NOTE =
  'Nothing built yet. Fill in what you want on the left and build it; every build is kept here, ' +
  'so you can change one thing, build again, and compare the two.';

/** Said above the rows when a file in the store could not be read. */
export function unreadableNote(count: number): string {
  return count === 1
    ? '1 file in the variation store could not be read and is not listed below.'
    : `${String(count)} files in the variation store could not be read and are not listed below.`;
}

/** A build's own moment, in the reader's timezone rather than in UTC. */
function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

export interface VariationShelfProps {
  readonly variations: readonly VariationSummary[];
  readonly unreadableCount: number;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}

export function VariationShelf(props: VariationShelfProps): ReactElement {
  // Resolved from the same list rather than fetched: a parent that is not on the
  // shelf was deleted, and "a variation of one that is gone" is worth saying
  // rather than drawing as a first build.
  const names = new Map(props.variations.map((row) => [row.id, row.name]));

  return createElement(
    'section',
    { className: 'mtg-workbench__shelf' },
    createElement('h2', { className: 'mtg-workbench__shelf-title' }, SHELF_LABEL),
    props.unreadableCount === 0
      ? null
      : createElement('p', { className: 'mtg-workbench__hint' }, unreadableNote(props.unreadableCount)),
    props.variations.length === 0
      ? createElement('p', { className: 'mtg-workbench__hint' }, SHELF_EMPTY_NOTE)
      : createElement(
          'ul',
          { className: 'mtg-workbench__rows' },
          props.variations.map((row) =>
            createElement(
              'li',
              { key: row.id },
              createElement(
                'button',
                {
                  type: 'button',
                  className: 'mtg-workbench__row',
                  'data-selected': row.id === props.selectedId ? 'true' : 'false',
                  'data-short': row.shortfallCount > 0 ? 'true' : 'false',
                  onClick: (): void => {
                    props.onSelect(row.id);
                  },
                },
                createElement('span', { className: 'mtg-workbench__row-name' }, row.name),
                createElement(
                  'span',
                  { className: 'mtg-workbench__row-meta' },
                  `${String(row.totalCards)} cards · ${row.sets.join(', ')} · ${when(row.builtAt)}`,
                ),
                row.parentId === null
                  ? null
                  : createElement(
                      'span',
                      { className: 'mtg-workbench__row-parent' },
                      `a variation of ${names.get(row.parentId) ?? 'a build that has been removed'}`,
                    ),
                costLine(row),
                row.shortfallCount === 0
                  ? null
                  : createElement(
                      'span',
                      { className: 'mtg-workbench__row-short' },
                      row.shortfallCount === 1 ? '1 shortfall' : `${String(row.shortfallCount)} shortfalls`,
                    ),
              ),
            ),
          ),
        ),
  );
}

/**
 * What the build cost, or nothing at all.
 *
 * `mtg-yp33.7`. Silence rather than "$0.00" for a variation written before the
 * cost was kept: a build that cost nothing and a build whose cost was never
 * recorded are different facts, and drawing a dollar figure for the second one
 * would state the wrong one of them. Rounded to the cent because that is what a
 * bill is read in.
 */
function costLine(row: VariationSummary): ReactNode {
  if (row.spentUsd === null || row.rounds === null) return null;
  const rounds = row.rounds === 1 ? '1 round' : `${String(row.rounds)} rounds`;
  return createElement(
    'span',
    { className: 'mtg-workbench__row-cost' },
    `$${row.spentUsd.toFixed(2)} over ${rounds}`,
  );
}
