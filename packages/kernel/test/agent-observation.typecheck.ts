import { observeState, type AgentObservation, type GameState } from '@mtg/kernel';

declare const privileged: GameState;
declare const observed: AgentObservation;

function acceptsObservation(_state: AgentObservation): void {}

acceptsObservation(observed);
acceptsObservation(observeState(privileged, 0, 'type-contract'));

// A full rules state must cross the kernel projection boundary before a policy
// or training feature extractor can consume it.
// @ts-expect-error GameState is privileged and is not a player observation.
acceptsObservation(privileged);
