/**
 * What this brief actually builds, before anything is generated.
 *
 * `mtg-yddw.3`. The allocator and the pin deriver are pure functions over the
 * brief: they cost nothing, call no model, and answer the questions a designer
 * would otherwise pay a full run to find out. How many cards each color gets at
 * each rarity. What the curve looks like. Whether every stated mechanic reaches
 * common — set design's own failure mode 8, a theme that exists only at rare and
 * so is invisible in a draft. Where each named card was seated. Which pins the
 * deriver could not honor exactly, and what it did instead.
 *
 * So this panel is the reason the designer is worth having as a surface rather
 * than a form: the consequences of a brief are on screen while it is being
 * written, and a run is the last step rather than the way you find out.
 *
 * A mechanic that reaches no common is called out rather than left as a zero in
 * a row of numbers. Everything else is reported as it came.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { MechanicReach, SkeletonPoolCensus, SkeletonPlan } from './client';
import { panel } from './fields';

export const SKELETON_TITLE = 'What this brief builds';

const SKELETON_EXPLAIN =
  'Derived from the brief alone: no model is called and nothing is spent. It is the shape of the set the generator would be asked to fill.';

export const NOT_YET_NOTE = 'The skeleton appears once the brief is legal.';

export function invalidNote(count: number): string {
  return count === 1
    ? 'One field is refused, so the brief cannot be allocated yet.'
    : `${String(count)} fields are refused, so the brief cannot be allocated yet.`;
}

export const UNREACHED_COMMON =
  'reaches no common slot, so a drafter would never see it. Set design’s eighth failure mode: a mechanic that exists only at rare is a mechanic the format does not have.';

const RARITIES: readonly string[] = ['common', 'uncommon', 'rare'];

function poolRow(pool: SkeletonPoolCensus): ReactElement {
  return createElement(
    'tr',
    { key: pool.pool },
    createElement('th', { scope: 'row' }, pool.pool),
    ...RARITIES.map((rarity) => createElement('td', { key: rarity }, String(pool.byRarity[rarity] ?? 0))),
    createElement('td', null, String(pool.total)),
  );
}

/**
 * The census, in a container that scrolls sideways rather than the page.
 *
 * Six columns of numbers do not fit a 390px phone and are not worth shrinking
 * to; what they must not do is push the whole editor sideways, which is what an
 * unwrapped table does. `../../../test/design/design-phone.browser.test.ts`
 * measures that on a real Chrome.
 */
function census(plan: SkeletonPlan): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-design__scroll' },
    createElement(
      'table',
      { className: 'mtg-design__table' },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          createElement('th', { scope: 'col' }, 'Pool'),
          ...RARITIES.map((rarity) => createElement('th', { key: rarity, scope: 'col' }, rarity)),
          createElement('th', { scope: 'col' }, 'total'),
        ),
      ),
      createElement('tbody', null, plan.pools.map(poolRow)),
    ),
  );
}

function curve(plan: SkeletonPlan): ReactElement {
  const most = plan.curve.reduce((high, point) => Math.max(high, point.slots), 1);
  return createElement(
    'div',
    { className: 'mtg-design__curve' },
    ...plan.curve.map((point) =>
      createElement(
        'div',
        { key: String(point.manaValue), className: 'mtg-design__bar' },
        createElement('span', { className: 'mtg-design__bar-label' }, String(point.manaValue)),
        // The bar is a width rather than a chart: this is a shape somebody reads
        // at a glance beside the numbers, and the number is right there in it.
        createElement(
          'span',
          {
            className: 'mtg-design__bar-fill',
            style: { inlineSize: `${String((point.slots / most) * 100)}%` },
          },
          String(point.slots),
        ),
      ),
    ),
  );
}

function reach(mechanic: MechanicReach): ReactElement {
  return createElement(
    'li',
    { key: mechanic.name, 'data-refused': mechanic.commonSlots === 0 ? 'true' : 'false' },
    mechanic.commonSlots === 0
      ? `${mechanic.name} ${UNREACHED_COMMON}`
      : `${mechanic.name}: ${String(mechanic.slots)} slots, ${String(mechanic.commonSlots)} of them common.`,
  );
}

function lines(title: string, entries: readonly string[]): ReactElement | null {
  if (entries.length === 0) return null;
  return createElement(
    'div',
    { className: 'mtg-design__field' },
    createElement('span', { className: 'mtg-fact__label' }, title),
    createElement(
      'ul',
      { className: 'mtg-design__notes' },
      entries.map((entry, index) => createElement('li', { key: `${String(index)}-${entry}` }, entry)),
    ),
  );
}

function seating(plan: SkeletonPlan): ReactElement | null {
  if (plan.seated.length === 0) return null;
  return lines(
    'Where each named card was seated',
    plan.seated.map(
      (card) =>
        `${card.name}: ${card.pool} ${card.rarity} ${card.cardKind}, ${card.role}, mana value ${String(card.manaValueMin)}–${String(card.manaValueMax)}.`,
    ),
  );
}

export interface SkeletonPanelProps {
  /** Null until a legal brief has been planned. */
  readonly plan: SkeletonPlan | null;
  /** Said in place of the plan: not yet legal, refused, or no server. */
  readonly note: string | null;
}

export function SkeletonPanel(props: SkeletonPanelProps): ReactElement {
  const { plan, note } = props;
  if (plan === null) {
    return panel(
      SKELETON_TITLE,
      null,
      createElement('p', { className: 'mtg-design__hint' }, note ?? NOT_YET_NOTE),
    );
  }
  return panel(
    SKELETON_TITLE,
    SKELETON_EXPLAIN,
    createElement(
      'p',
      { className: 'mtg-design__verdict' },
      `${plan.setName} (${plan.setCode}): ${String(plan.slots)} slots for a target of ${String(plan.targetSize)}.`,
    ),
    census(plan),
    createElement('span', { className: 'mtg-fact__label' }, 'Slots by mana value'),
    curve(plan),
    createElement('span', { className: 'mtg-fact__label' }, 'How far each mechanic reaches'),
    createElement('ul', { className: 'mtg-design__notes' }, plan.mechanics.map(reach)),
    seating(plan),
    lines('Named cards the allocator could not seat', plan.unseated),
    lines('Pins it could not honor exactly', plan.pinNotes),
    lines('What the allocator decided', plan.notes),
  );
}
