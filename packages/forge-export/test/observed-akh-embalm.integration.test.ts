/** Sacred Cat's local embalm route, including the copied creature's lifelink. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Embalm pilot',
      controller: 'local',
      deck: {
        name: 'cat',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Sacred Cat', count: 30 },
        ],
      },
    },
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'passive', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'akh-hou-sacred-cat-embalm-v1',
  maximumTurns: 24,
};

forgeIt(
  'embalms an exact Sacred Cat and preserves lifelink on its token',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let sourceOid: string | undefined;
    let activated = false;
    let confirmed = false;
    let offTurnAbsence = false;
    let resolved = false;
    let attacked = false;
    let lifelink = false;
    const manaSources = new Set<string>();
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1000 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        sourceOid ??= pilot.graveyard.find((card) => card.name === 'Sacred Cat')?.oid;
        const token = pilot.battlefield.find((card) => card.name === 'Sacred Cat');
        if (token !== undefined) {
          expect(activated && confirmed).toBe(true);
          expect(token).toMatchObject({ power: 1, toughness: 1 });
          expect(token).toMatchObject({ characteristics: { colors: ['W'], manaCost: null, token: true } });
          expect(token.typeLine).toContain('Zombie');
          expect(token.typeLine).toContain('Cat');
          expect(token.oid).not.toBe(sourceOid);
          expect(pilot.exile.some((card) => card.oid === sourceOid)).toBe(true);
          expect(pilot.graveyard.some((card) => card.oid === sourceOid)).toBe(false);
          resolved = true;
        }
        if (attacked && session.view.seats[1].life === 19) {
          expect(pilot.life).toBe(21);
          lifelink = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        let stale: ObservedSession | undefined;
        if (decision.kind === 'priority' && decision.seat === 0) {
          const prefix =
            sourceOid === undefined ? null : `ability-${sourceOid.replace(/^forge-card-/u, '')}-`;
          const embalm = decision.options.find((option) => prefix !== null && option.id.startsWith(prefix));
          if (sourceOid !== undefined && session.view.turn.active !== 0) {
            expect(embalm).toBeUndefined();
            offTurnAbsence = true;
          }
          if (sourceOid !== undefined)
            move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          if (move === undefined && embalm !== undefined && !activated) {
            await expect(session.submit('ability-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            move = embalm.id;
            activated = true;
            stale = session;
          }
        } else if (decision.kind === 'mana-payment') {
          const source = decision.options.find((option) => option.id.startsWith('mana-source-'));
          move = source?.id;
          const oid = source?.targets[0]?.oid;
          if (oid === undefined) throw new Error('Mana payment has no physical source');
          expect(manaSources.has(oid)).toBe(false);
          manaSources.add(oid);
        } else if (decision.kind === 'cost-exile-confirm') {
          expect(decision.options[0]?.targets).toEqual([
            expect.objectContaining({ oid: sourceOid, name: 'Sacred Cat' }),
          ]);
          move = 'cost-exile-confirm-yes';
          confirmed = true;
          stale = session;
        } else if (decision.kind === 'combat-attackers' && decision.seat === 0 && resolved && !attacked) {
          move = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === token?.oid,
          )?.id;
          attacked = move !== undefined;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) =>
            option.targets.some(
              (target) => target.name === (decision.seat === 0 ? 'Sacred Cat' : 'Mountain'),
            ),
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
        if (move === undefined) throw new Error(`Unhandled embalm decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        if (stale !== undefined)
          await expect(stale.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
        session = advanced.session;
      }
      expect({ resolved, offTurnAbsence, lifelink }, trace.slice(-12).join('\n')).toEqual({
        resolved: true,
        offTurnAbsence: true,
        lifelink: true,
      });
      expect(manaSources.size).toBe(1);
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
