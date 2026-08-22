/**
 * `@mtg/referee` — the LLM referee from ADR-0001 §2.4, with its hard boundary.
 *
 * The kernel enumerates the legal moves and owns every byte of state. This
 * package frames one of those decisions as text a model can read, takes back an
 * option *index* and a sentence, re-checks the index against the state, and
 * hands the caller an action to apply. A model that answers badly costs a
 * deterministic fallback decision and a recorded rejection; it can never move a
 * card, because there is no field in the ruling schema in which it could.
 *
 * ```ts
 * const referee = createReferee({ provider, fallback: simpleAgent('greedy') });
 * const run = await playRefereed(state, [agentSeat(bot), refereeSeat(referee)]);
 * console.log(formatBacklog(compileDownBacklog(run.rulings)));
 * ```
 *
 * Nothing in the sim or metrics packages imports this one, and
 * `test/isolation.test.ts` fails if that changes: refereed games are excluded
 * from balance CI entirely.
 */

export { compileDownBacklog, formatBacklog } from './backlog';
export type { CompileDownEntry } from './backlog';

export { exampleBlockingPosition } from './example';

export { frameDecision } from './frame';
export type { FrameOptions, FramedOption, FramedPlayer, FramedTurn, RefereeFrame } from './frame';

export { agentSeat, playRefereed, refereeSeat } from './play';
export type { RefereedPlayOptions, RefereedRun, RefereedSeat } from './play';

export { REFEREE_SYSTEM, renderFrame } from './prompt';

export { createReferee } from './referee';
export type { Referee, RefereeOptions, RulingOutcome, RulingRecord } from './referee';

export { RulingSchema, selectRuledAction } from './ruling';
export type { Ruling, RulingSelection } from './ruling';
