/**
 * A ruling is an index, never an action.
 *
 * ADR-0001 §2.4 draws this boundary from measured failure: MTG Bench's models
 * corrupted state when they were allowed to describe what happens. Here the
 * model can only name one of the moves the kernel already enumerated, and even
 * that is re-checked against the state before it is applied.
 */
import { describe, expect, it } from 'vitest';
import type { Action, Decision } from '@mtg/kernel';
import { opponentOf, validateAction } from '@mtg/kernel';
import { RulingSchema, selectRuledAction } from '@mtg/referee';
import { blockingView } from './positions';

describe('the ruling schema', () => {
  it('accepts an index and a rationale', () => {
    const parsed = RulingSchema.safeParse({ optionIndex: 2, rationale: 'Chump the bigger attacker.' });
    expect(parsed.success).toBe(true);
  });

  it('rejects a reconstructed action, however well formed', () => {
    const parsed = RulingSchema.safeParse({
      action: { type: 'declareBlockers', player: 1, blocks: [] },
      rationale: 'No blocks.',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a fractional or negative index and an empty rationale', () => {
    expect(RulingSchema.safeParse({ optionIndex: 1.5, rationale: 'x' }).success).toBe(false);
    expect(RulingSchema.safeParse({ optionIndex: -1, rationale: 'x' }).success).toBe(false);
    expect(RulingSchema.safeParse({ optionIndex: 0, rationale: '' }).success).toBe(false);
  });
});

describe('selecting the ruled action', () => {
  it('maps an in-range index back to the kernel option', () => {
    const view = blockingView();
    const selection = selectRuledAction(view, { optionIndex: 0, rationale: 'first' });

    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.action).toBe(view.decision.options[0]);
  });

  it('rejects an index past the end of the list', () => {
    const view = blockingView();
    const past = view.decision.options.length;
    const selection = selectRuledAction(view, { optionIndex: past, rationale: 'off the end' });

    expect(selection.ok).toBe(false);
    if (selection.ok) return;
    expect(selection.reason).toContain(String(past));
  });

  it('rejects an option that is not legal from this state', () => {
    const view = blockingView();
    // A decision carrying an action the kernel would refuse: a discard while
    // blockers are owed. Reaching validateAction rather than trusting the list
    // is what makes a stale or hand-built decision safe to rule on.
    const illegal: Action = { type: 'discard', player: view.player, oids: [] };
    const decision: Decision = { ...view.decision, options: [illegal] };
    expect(validateAction(view.state, illegal)).not.toBeNull();

    const selection = selectRuledAction(
      { ...view, decision },
      { optionIndex: 0, rationale: 'not actually legal' },
    );
    expect(selection.ok).toBe(false);
    if (selection.ok) return;
    expect(selection.reason).toContain('discard');
  });

  it('rejects an option belonging to the other seat, even a legal one', () => {
    // `concede` is legal for either player from any position and is deliberately
    // absent from every enumeration, so the kernel's own legality check passes
    // it through: this guard is the only thing between a stale or hand-built
    // decision and a ruling that concedes the game for the opponent.
    const view = blockingView();
    const other = opponentOf(view.player);
    const wrongSeat: Action = { type: 'concede', player: other };
    expect(validateAction(view.state, wrongSeat)).toBeNull();
    const decision: Decision = { ...view.decision, options: [wrongSeat] };

    const selection = selectRuledAction({ ...view, decision }, { optionIndex: 0, rationale: 'wrong seat' });
    expect(selection.ok).toBe(false);
    if (selection.ok) return;
    expect(selection.reason).toContain(`belongs to player ${String(other)}`);
  });
});
