/** Negative control for the campaign crash at Treachery and Dragonlord Silumgar. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'resolves Treachery on Dragonlord Silumgar after it steals a creature',
  async () => {
    const state = {
      schemaVersion: 1 as const,
      active: 1 as const,
      phase: 'MAIN1' as const,
      seats: [
        {
          life: 20,
          hand: ['Treachery'],
          battlefield: ['Llanowar Elves', ...Array<string>(5).fill('Island')],
          library: Array<string>(20).fill('Island'),
          graveyard: [],
        },
        {
          life: 20,
          hand: ['Dragonlord Silumgar'],
          battlefield: Array<string>(6).fill('Underground Sea'),
          library: Array<string>(20).fill('Swamp'),
          graveyard: [],
        },
      ] as const,
    };
    const backend = await snapshotForgeScenarioBackend(state, { timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Candidate',
          controller: 'local',
          deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
        },
        {
          name: 'Forge Default',
          controller: 'local',
          deck: { name: 'setup', cards: [{ name: 'Swamp', count: 60 }] },
        },
      ],
      seed: 'treachery-dragonlord-silumgar-campaign-replay-v1',
      maximumTurns: 3,
    };
    let session: ObservedSession | undefined;
    let silumgarStoleCreature = false;
    let treacheryCastAfterTheft = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 100; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const controlled = pilot.battlefield.some((card) => card.name === 'Dragonlord Silumgar');
        const dragonCast = session.view.stack.some((card) => card.name === 'Dragonlord Silumgar');
        const dragonResolved = opponent.battlefield.some((card) => card.name === 'Dragonlord Silumgar');
        silumgarStoleCreature ||= opponent.battlefield.some((card) => card.name === 'Llanowar Elves');
        const move =
          (controlled ? decision.options.find((option) => option.text === 'Concede') : undefined) ??
          (!dragonCast && !dragonResolved && decision.seat === 1
            ? decision.options.find((option) => option.text.startsWith('Dragonlord Silumgar:'))
            : undefined) ??
          (dragonResolved && decision.seat === 0 && session.view.turn.active === 0
            ? decision.options.find((option) => option.text.startsWith('Treachery:'))
            : undefined) ??
          (decision.seat === 1
            ? decision.options.find((option) => option.targets[0]?.name === 'Llanowar Elves')
            : decision.options.find((option) => option.targets[0]?.name === 'Dragonlord Silumgar')) ??
          (decision.kind === 'mana-payment'
            ? decision.options.find((option) => option.id.startsWith('mana-source-'))
            : undefined) ??
          decision.options.find((option) => option.id === 'card-selection-done') ??
          decision.options.find((option) => option.text === 'Pass priority');
        if (move === undefined) {
          throw new Error(
            `Unhandled ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
          );
        }
        if (move.text.startsWith('Treachery:')) treacheryCastAfterTheft = silumgarStoleCreature;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind} -> ${move.text}`,
        );
        const advanced = await session.submit(move.id);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(session.view.seats[0].battlefield, trace.join('\n')).toContainEqual(
        expect.objectContaining({ name: 'Dragonlord Silumgar' }),
      );
      expect(silumgarStoleCreature, trace.join('\n')).toBe(true);
      expect(treacheryCastAfterTheft, trace.join('\n')).toBe(true);
      expect(session.status, trace.join('\n')).toBe('finished');
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
