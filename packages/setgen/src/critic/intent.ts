/**
 * The design-intent description a critic (or a human adjudicator) is shown
 * beside a printed card: everything about the slot that was decided or asked
 * for *before* the model wrote the card, in prose.
 *
 * This is the "source text" side of the faithfulness question in a pipeline
 * that generates rather than translates: there is no separate rules text a
 * card is checked against, because `renderOracleText` derives the printed text
 * mechanically from the DSL structure the model wrote. The thing that can
 * diverge from what was asked for is the DSL structure itself, and everything
 * that constrained or motivated it is either on the `Slot` or in the brief's
 * mechanic descriptions, a required card's flavor direction, or an applied
 * critique revision's instruction.
 */
import type { SetBrief } from '../brief';
import type { RevisionRecord } from '../report';
import { describeSlot } from '../slot';
import type { Entry } from '../validate/index';

/** Applied revisions naming this slot, in the order they were recorded. */
export function appliedRevisionsFor(
  slotId: string,
  revisions: readonly RevisionRecord[],
): readonly RevisionRecord[] {
  return revisions.filter((revision) => revision.slotId === slotId && revision.outcome === 'applied');
}

/** Slot ids carrying at least one applied revision. */
export function appliedRevisionSlotIds(revisions: readonly RevisionRecord[]): ReadonlySet<string> {
  return new Set(
    revisions.filter((revision) => revision.outcome === 'applied').map((revision) => revision.slotId),
  );
}

/**
 * One entry's design intent, in prose: the slot line, the brief mechanics it
 * was allocated to support, its required-card direction if any, and any
 * applied revision instruction. `revisions` should be the full report list —
 * reverted and unfilled revisions are filtered out here, because a reverted
 * revision describes a card that was not kept and a card cannot be judged
 * against an instruction the pipeline itself gave up on.
 */
export function describeIntent(
  entry: Entry,
  brief: SetBrief,
  revisions: readonly RevisionRecord[] = [],
): string {
  const lines: string[] = [describeSlot(entry.slot)];

  const mechanics = brief.mechanics.filter((mechanic) => entry.slot.mechanics.includes(mechanic.name));
  for (const mechanic of mechanics) {
    lines.push(`Mechanic "${mechanic.name}": ${mechanic.description}`);
  }

  const direction = entry.slot.requiredCard?.flavorDirection;
  if (direction !== undefined) {
    lines.push(`Required-card direction: ${direction}`);
  }

  for (const revision of appliedRevisionsFor(entry.slot.id, revisions)) {
    lines.push(`Critique revision kept: ${revision.observation} Change asked for: ${revision.instruction}`);
  }

  return lines.join('\n');
}
