import { describe, expect, it } from 'vitest';
import { BotEvidenceEpisodeSchema, botEvidenceSha256 } from '@mtg/bot-evidence';
import type { Action, AgentView } from '@mtg/kernel';
import { actionKey, agentView, pendingDecision, scenario } from '@mtg/kernel';
import { nativeGameplayDecision, nativeGameplayFailedDecision } from '../src/native-evidence';

function priorityView(): AgentView {
  const state = scenario({ active: 0, step: 'precombatMain' }).state;
  const decision = pendingDecision(state);
  if (decision === null || decision.kind !== 'priority') throw new Error('expected priority');
  return agentView(state, decision.player, decision, 'native-evidence-test');
}

describe('native gameplay evidence', () => {
  it('records a projected observation and canonical enumerated action identities', () => {
    const view = priorityView();
    const action: Action = { type: 'passPriority', player: view.player };
    const evidence = nativeGameplayDecision(view, action, 3);
    expect(evidence.sequence).toBe(3);
    expect(evidence.observation.sha256).toBe(botEvidenceSha256(evidence.observation.value));
    expect(evidence.candidates.status).toBe('complete');
    expect(evidence.candidates.values.map((candidate) => candidate.id)).toContain(actionKey(action));
    expect(evidence.choice).toEqual({ status: 'chosen', candidateId: actionKey(action) });
  });

  it('keeps only the observation digest when asked, for a chosen and a failed decision', () => {
    const view = priorityView();
    const action: Action = { type: 'passPriority', player: view.player };
    const retained = nativeGameplayDecision(view, action, 0);
    const digest = nativeGameplayDecision(view, action, 0, 'digest');
    expect(digest.observation).toEqual({ sha256: retained.observation.sha256 });
    expect(digest).toEqual({ ...retained, observation: { sha256: retained.observation.sha256 } });
    expect(BotEvidenceEpisodeSchema.shape.decisions.element.parse(digest)).toEqual(digest);

    const failed = nativeGameplayFailedDecision(view, action, 1, 'refused', 'digest');
    expect(failed.observation).toEqual({ sha256: retained.observation.sha256 });
  });

  it('marks a capped kernel enumeration as truncated', () => {
    const base = priorityView();
    if (base.decision.kind !== 'priority') throw new Error('expected priority');
    const view: AgentView = { ...base, decision: { ...base.decision, complete: false } };
    const action: Action = { type: 'passPriority', player: view.player };

    expect(nativeGameplayDecision(view, action, 0).candidates).toMatchObject({
      status: 'truncated',
      reason: 'kernel enumeration cap reached',
    });
  });

  it('keeps a free-text choice while marking its candidate surface incomplete', () => {
    const base = priorityView();
    const view: AgentView = {
      ...base,
      decision: {
        kind: 'cardName',
        player: base.player,
        chosen: [],
        input: { kind: 'text', label: 'Card name', minLength: 1, maxLength: 256 },
        options: [],
        complete: true,
      },
    };
    const action: Action = { type: 'chooseCardName', player: view.player, name: 'Forest' };
    const evidence = nativeGameplayDecision(view, action, 0);

    expect(evidence.candidates).toMatchObject({
      status: 'incomplete',
      reason: 'free-text decision is not enumerable',
      values: [{ id: actionKey(action) }],
    });
  });

  it('retains a chosen action omitted by a capped enumeration', () => {
    const base = priorityView();
    if (base.decision.kind !== 'priority') throw new Error('expected priority');
    const view: AgentView = {
      ...base,
      decision: { ...base.decision, options: [], complete: false },
    };
    const action: Action = { type: 'passPriority', player: view.player };

    expect(nativeGameplayDecision(view, action, 0).candidates).toMatchObject({
      status: 'truncated',
      values: [{ id: actionKey(action) }],
    });
  });

  it('fits the shared episode contract without privileged state', () => {
    const view = priorityView();
    const config = { policy: 'test' };
    const digest = 'a'.repeat(64);
    const decision = nativeGameplayDecision(view, { type: 'passPriority', player: view.player }, 0);

    expect(() =>
      BotEvidenceEpisodeSchema.parse({
        schemaVersion: 1,
        episode: {
          id: 'native-game-1',
          stage: 'gameplay',
          seed: '7',
          runtime: { kind: 'native', version: 'test', buildSha256: digest },
          subject: { formatId: 'test', formatSha256: digest, cardsSha256: digest },
          features: { schemaId: 'agent-observation-v1', schemaSha256: digest },
          behavior: {
            policyId: 'test',
            config,
            configSha256: botEvidenceSha256(config),
            modelSha256: null,
            dataSha256: null,
          },
          lineage: { gameId: 'native-game-1' },
          splitGroup: { kind: 'game', id: 'native-game-1' },
        },
        decisions: [decision],
        outcome: { status: 'completed', value: { winner: 0 } },
      }),
    ).not.toThrow();
  });

  it('retains constructed actions outside a complete next-step surface and rejects duplicate identities', () => {
    const base = priorityView();
    if (base.decision.kind !== 'priority') throw new Error('expected priority');
    const action: Action = { type: 'passPriority', player: base.player };
    const missing: AgentView = { ...base, decision: { ...base.decision, options: [] } };
    const duplicated: AgentView = {
      ...base,
      decision: { ...base.decision, options: [action, action] },
    };

    expect(nativeGameplayDecision(missing, action, 0).candidates).toMatchObject({
      status: 'truncated',
      reason: 'chosen action was constructed outside enumerated candidates',
      values: [{ id: actionKey(action) }],
    });
    expect(() => nativeGameplayDecision(duplicated, action, 0)).toThrow(
      'native priority decision exposed duplicate candidates',
    );
  });

  it('rejects invalid evidence sequence numbers', () => {
    const view = priorityView();
    const action: Action = { type: 'passPriority', player: view.player };
    expect(() => nativeGameplayDecision(view, action, -1)).toThrow(
      'native evidence sequence must be a nonnegative integer',
    );
  });

  it('retains the exact action rejected by the kernel', () => {
    const view = priorityView();
    const attempted: Action = { type: 'concede', player: view.player };
    expect(nativeGameplayFailedDecision(view, attempted, 2, 'illegal action').choice).toEqual({
      status: 'illegal-action',
      error: 'illegal action',
      attempted: { id: actionKey(attempted), value: attempted },
    });
  });
});
