/**
 * What a ruling is allowed to be.
 *
 * An index and a sentence. Not an action, not a state delta, not a narration.
 * ADR-0001 §2.4 draws this line from MTG Bench's measured failures — models
 * that were allowed to say what happens corrupted hidden information and lost
 * track of zones — and the schema is where the line is actually held: there is
 * no field in which a reconstructed action could arrive.
 *
 * The index is then re-checked against the state rather than trusted, because
 * an option list can go stale (a decision framed one state ago) and because
 * `validateAction` re-derives legality instead of believing an enumeration.
 */
import { z } from 'zod';
import type { Action, AgentView } from '@mtg/kernel';
import { validateAction } from '@mtg/kernel';

export const RulingSchema = z
  .object({
    optionIndex: z.number().int().min(0).describe('The index of the option you choose, from the list.'),
    rationale: z
      .string()
      .min(1)
      .max(400)
      .describe('One sentence on why that option, in terms of the position.'),
  })
  .strict();

export type Ruling = z.infer<typeof RulingSchema>;

export type RulingSelection =
  { readonly ok: true; readonly action: Action } | { readonly ok: false; readonly reason: string };

/** Map a ruling back to the action it names, or say why it cannot be applied. */
export function selectRuledAction(view: AgentView, ruling: Ruling): RulingSelection {
  const options = view.decision.options;
  const action = options[ruling.optionIndex];
  if (action === undefined) {
    return {
      ok: false,
      reason:
        `option ${String(ruling.optionIndex)} does not exist: ` +
        `the decision offered ${String(options.length)} option(s)`,
    };
  }
  if (action.player !== view.player) {
    return {
      ok: false,
      reason:
        `option ${String(ruling.optionIndex)} belongs to player ${String(action.player)}, ` +
        `but player ${String(view.player)} was asked`,
    };
  }
  const illegal = validateAction(view.state, action);
  if (illegal !== null) {
    return { ok: false, reason: `option ${String(ruling.optionIndex)} is illegal: ${illegal}` };
  }
  return { ok: true, action };
}
