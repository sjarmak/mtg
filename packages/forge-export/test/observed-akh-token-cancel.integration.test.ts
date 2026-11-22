/** Declining the graveyard exile cost must preserve the source and permit retry. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt.each([
  { name: 'Sacred Cat', seed: 'akh-hou-sacred-cat-embalm-v1', power: 1 },
  { name: 'Adorned Pouncer', seed: 'akh-hou-pouncer-eternalize-v1', power: 4 },
])(
  'canceling $name exile leaves the source available for a successful retry',
  async ({ name, seed, power }) => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        {
          name: 'Pilot',
          controller: 'local',
          deck: {
            name: 'token',
            cards: [
              { name: 'Plains', count: 30 },
              { name, count: 30 },
            ],
          },
        },
        {
          name: 'Observer',
          controller: 'local',
          deck: { name: 'passive', cards: [{ name: 'Mountain', count: 60 }] },
        },
      ],
      seed,
      maximumTurns: 30,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let sourceOid: string | undefined;
    let canceled = false;
    let retried = false;
    let confirmed = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1400 && session.status === 'awaiting'; index += 1) {
        const pilot = session.view.seats[0];
        sourceOid ??= pilot.graveyard.find((card) => card.name === name)?.oid;
        const token = pilot.battlefield.find((card) => card.name === name);
        if (token !== undefined) {
          expect({ canceled, retried, confirmed }).toEqual({
            canceled: true,
            retried: true,
            confirmed: true,
          });
          expect(token).toMatchObject({ power, toughness: power });
          expect(token.typeLine).toContain('Zombie');
          expect(token.oid).not.toBe(sourceOid);
          expect(pilot.exile.some((card) => card.oid === sourceOid)).toBe(true);
          expect(pilot.graveyard.some((card) => card.oid === sourceOid)).toBe(false);
          resolved = true;
          break;
        }
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        trace.push(
          `${session.view.turn.number}/${decision.kind}: ${decision.options.map((option) => option.id).join(',')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority' && decision.seat === 0) {
          if (sourceOid !== undefined) {
            const prefix = `ability-${sourceOid.replace(/^forge-card-/u, '')}-`;
            const ability = decision.options.find((option) => option.id.startsWith(prefix));
            move = decision.options.find((option) => option.text === 'Play Plains')?.id;
            if (move === undefined && ability !== undefined && !confirmed) {
              if (canceled) {
                expect(pilot.graveyard.some((card) => card.oid === sourceOid)).toBe(true);
                expect(pilot.exile.some((card) => card.oid === sourceOid)).toBe(false);
                expect(session.view.stack).toEqual([]);
                retried = true;
              }
              move = ability.id;
            }
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'cost-exile-confirm') {
          expect(decision.options[0]?.targets).toEqual([expect.objectContaining({ oid: sourceOid, name })]);
          move = canceled ? 'cost-exile-confirm-yes' : 'cost-exile-confirm-no';
          if (canceled) confirmed = true;
          else canceled = true;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) =>
            option.targets.some((target) => target.name === (decision.seat === 0 ? name : 'Mountain')),
          )?.id;
          move ??= decision.options.find((option) =>
            option.targets.some((target) => target.name === 'Plains'),
          )?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined)
          throw new Error(`Unhandled token cancellation\n${trace.slice(-12).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
        session = advanced.session;
      }
      expect(resolved, trace.slice(-12).join('\n')).toBe(true);
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
