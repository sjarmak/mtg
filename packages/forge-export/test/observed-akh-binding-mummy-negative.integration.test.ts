/** Entries outside “another Zombie enters under your control” must stay silent. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt.each(['itself', 'own non-Zombie', 'opposing Zombie'] as const)(
  'Binding Mummy does not trigger for %s',
  async (scenario) => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let entered: { turn: number; oid: string; seat: 0 | 1 } | undefined;
    let completed = false;
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Mummy controller',
            controller: 'local',
            deck: {
              name: 'entry controls',
              cards: [
                { name: 'Plains', count: 24 },
                { name: 'Binding Mummy', count: 18 },
                { name: 'Sacred Cat', count: 18 },
              ],
            },
          },
          {
            name: 'Opponent',
            controller: 'local',
            deck: {
              name: 'opposing entries',
              cards: [
                { name: 'Plains', count: 24 },
                { name: 'Sacred Cat', count: 18 },
                { name: 'Those Who Serve', count: 18 },
              ],
            },
          },
        ],
        seed: `akh-binding-negative-${scenario}-v1`,
        maximumTurns: 24,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const own = session.view.seats[0].battlefield;
        const opposing = session.view.seats[1].battlefield;
        const mummy = own.find((card) => card.name === 'Binding Mummy');
        const opposingCat = opposing.find((card) => card.name === 'Sacred Cat');
        const seat = scenario === 'opposing Zombie' ? 1 : 0;
        const name =
          scenario === 'itself'
            ? 'Binding Mummy'
            : scenario === 'own non-Zombie'
              ? 'Sacred Cat'
              : 'Those Who Serve';
        const specimen = session.view.seats[seat].battlefield.find((card) => card.name === name);
        // A wrong trigger must fail even if declined or aimed at an irrelevant creature.
        expect(decision.kind).not.toBe('target-selection');
        expect(decision.kind).not.toBe('confirm-trigger');
        if (mummy !== undefined && specimen !== undefined && opposingCat !== undefined) {
          expect(session.view.stack).toHaveLength(0);
          expect(mummy).toMatchObject({ power: 2, toughness: 2, tapped: false });
          expect(opposingCat.tapped).toBe(false);
          expect(specimen.tapped).toBe(false);
          entered ??= { turn: session.view.turn.number, oid: specimen.oid, seat };
          expect(specimen.oid).toBe(entered.oid);
          if (session.view.turn.number > entered.turn) {
            completed = true;
            break;
          }
        }
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          let cast: string | undefined;
          if (decision.seat === 1 && opposingCat === undefined) cast = 'Sacred Cat';
          if (decision.seat === 0 && mummy === undefined && opposingCat !== undefined) cast = 'Binding Mummy';
          if (mummy !== undefined && specimen === undefined && decision.seat === seat) cast = name;
          if (cast !== undefined)
            move ??= decision.options.find((option) =>
              option.text.startsWith(`${cast}: ${cast} - Creature`),
            )?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options[0]?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined)
          throw new Error(`Unhandled ${decision.kind}: ${JSON.stringify(decision.options)}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(entered, 'The specified entry must actually occur').toBeDefined();
      expect(completed, 'Observe the entry through the next turn without a trigger').toBe(true);
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
