import type { Action, AgentObservation, Decision, GameState } from '@mtg/kernel';
import { nativeGameplayDecision } from '../src/native-evidence';

declare const state: GameState;
declare const observation: AgentObservation;
declare const decision: Decision;
declare const action: Action;

nativeGameplayDecision({ state: observation, player: decision.player, decision }, action, 0);

// Player evidence must cross the kernel's concealment boundary first.
// @ts-expect-error raw privileged state is not an AgentObservation
nativeGameplayDecision({ state, player: decision.player, decision }, action, 0);
