/** Independent AKH/HOU local-controller probe, not inherited Cube qualification. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const subject = 'Adorned Pouncer';
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Eternalize pilot',
      controller: 'local',
      deck: {
        name: 'pouncer-probe',
        cards: [
          { name: 'Plains', count: 30 },
          { name: subject, count: 30 },
        ],
      },
    },
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'passive', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'akh-hou-pouncer-eternalize-v1',
  maximumTurns: 30,
};

forgeIt(
  'eternalizes an exact discarded Pouncer through local choices',
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
    let firstStrikeDamage = false;
    let doubleStrikeDamage = false;
    const manaSources = new Set<string>();
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        sourceOid ??= pilot.graveyard.find((card) => card.name === subject)?.oid;
        const token = pilot.battlefield.find((card) => card.name === subject);
        if (token !== undefined) {
          expect(activated && confirmed).toBe(true);
          expect(token).toMatchObject({ power: 4, toughness: 4 });
          expect(token).toMatchObject({ characteristics: { colors: ['B'], manaCost: null, token: true } });
          expect(token.typeLine).toContain('Zombie');
          expect(token.typeLine).toContain('Cat');
          expect(token.oid).not.toBe(sourceOid);
          expect(pilot.exile.some((card) => card.oid === sourceOid)).toBe(true);
          expect(pilot.graveyard.some((card) => card.oid === sourceOid)).toBe(false);
          resolved = true;
        }
        firstStrikeDamage ||= attacked && session.view.seats[1].life === 16;
        if (attacked && session.view.seats[1].life === 12) {
          doubleStrikeDamage = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        let staleSession: ObservedSession | undefined;
        if (decision.kind === 'priority' && decision.seat === 0) {
          const abilityPrefix =
            sourceOid === undefined ? null : `ability-${sourceOid.replace(/^forge-card-/u, '')}-`;
          const eternalize = decision.options.find(
            (option) => abilityPrefix !== null && option.id.startsWith(abilityPrefix),
          );
          if (sourceOid !== undefined && session.view.turn.active !== 0) {
            expect(eternalize).toBeUndefined();
            offTurnAbsence = true;
          }
          // First discard at cleanup, then develop five mana without casting the creature.
          if (sourceOid !== undefined)
            move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          if (move === undefined && eternalize !== undefined && !activated) {
            await expect(session.submit('ability-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            move = eternalize.id;
            activated = true;
            staleSession = session;
          }
        } else if (decision.kind === 'combat-attackers' && resolved && !attacked) {
          move = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === token?.oid,
          )?.id;
          attacked = move !== undefined;
        } else if (decision.kind === 'mana-payment') {
          const source = decision.options.find((option) => option.id.startsWith('mana-source-'));
          move = source?.id;
          const oid = source?.targets[0]?.oid;
          if (oid === undefined) throw new Error('Mana payment has no physical source');
          expect(manaSources.has(oid)).toBe(false);
          manaSources.add(oid);
        } else if (decision.kind === 'cost-exile-confirm') {
          expect(decision.options[0]?.targets).toEqual([
            expect.objectContaining({ oid: sourceOid, name: subject }),
          ]);
          move = 'cost-exile-confirm-yes';
          confirmed = true;
          staleSession = session;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) =>
            option.targets.some((target) => target.name === (decision.seat === 0 ? subject : 'Mountain')),
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
        if (move === undefined) throw new Error(`Unhandled probe decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        if (staleSession !== undefined) {
          await expect(staleSession.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
        }
        session = advanced.session;
      }
      expect(resolved, trace.slice(-12).join('\n')).toBe(true);
      expect(offTurnAbsence).toBe(true);
      expect(manaSources.size).toBe(5);
      expect(firstStrikeDamage, trace.slice(-12).join('\n')).toBe(true);
      expect(doubleStrikeDamage, trace.slice(-12).join('\n')).toBe(true);
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
