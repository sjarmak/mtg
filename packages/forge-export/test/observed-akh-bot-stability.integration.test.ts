/** Regression for the full-search Sacred Cat mirror that exhausted the 4 GB JVM heap. */
import { expect, it } from 'vitest';
import type { ObservedSession, PendingDecision, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function localMove(decision: PendingDecision): string | undefined {
  if (decision.kind === 'priority')
    return (
      decision.options.find((option) => option.text === 'Play Plains')?.id ??
      decision.options.find(
        (option) => option.text.startsWith('Sacred Cat:') && !option.text.includes('Embalm'),
      )?.id ??
      decision.options.find((option) => option.text === 'Pass priority')?.id
    );
  if (decision.kind === 'mana-payment')
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  if (decision.kind === 'combat-attackers')
    return (
      decision.options.find((option) => option.id.startsWith('combat-attack-add-'))?.id ??
      decision.options.find((option) => option.id === 'combat-attackers-commit')?.id
    );
  if (decision.kind === 'combat-blockers')
    return decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
  if (decision.kind === 'discard-selection')
    return (
      decision.options.find((option) => option.targets.some((target) => target.name === 'Sacred Cat'))?.id ??
      decision.options.find((option) => option.targets.some((target) => target.name === 'Plains'))?.id
    );
  return decision.options.find((option) => ['Play first', 'Keep this hand'].includes(option.text))?.id;
}

forgeIt(
  'native AKH/HOU bot finishes the uncapped lifelink mirror without exhausting its JVM',
  async () => {
    const deck = {
      name: 'graveyard-token-mirror',
      cards: [
        { name: 'Plains', count: 30 },
        { name: 'Sacred Cat', count: 30 },
      ],
    };
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        { name: 'Local combat driver', controller: 'local', deck },
        { name: 'Forge Embalm pilot', controller: 'engine', deck },
      ],
      seed: 'akh-hou-sacred-cat-engine-v1',
      maximumTurns: 40,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1800 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        expect(session.view.seats[1].hand).toBeNull();
        const move = localMove(decision);
        if (move === undefined) throw new Error(`Unhandled local decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(session.status).toBe('finished');
      expect(session.view.turn.number).toBeLessThanOrEqual(40);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  180_000,
);
