/** Both Censor outcomes in an AKH/HOU session, independently of Cube counterspell probes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

for (const { route, counterController } of [
  { route: 'pay', counterController: 'local' },
  { route: 'decline', counterController: 'local' },
  { route: 'decline', counterController: 'engine' },
] as const) {
  const threatName = counterController === 'engine' ? 'Ahn-Crop Crasher' : 'Adorned Pouncer';
  const landName = counterController === 'engine' ? 'Mountain' : 'Plains';
  const landsNeeded = 3;
  forgeIt(
    `Censor resolves its exact counter-unless-one route: ${route}, ${counterController} counter pilot`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Payer',
            controller: 'local',
            deck: {
              name: threatName,
              cards: [
                { name: landName, count: 30 },
                { name: threatName, count: 30 },
              ],
            },
          },
          {
            name: 'Counter pilot',
            controller: counterController,
            deck: {
              name: 'censor',
              cards: [
                { name: 'Island', count: 30 },
                { name: 'Censor', count: 30 },
              ],
            },
          },
        ],
        seed: `akh-hou-censor-unless-${route}-v1`,
        maximumTurns: 16,
      };
      const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      const trace: string[] = [];
      let sourceOid: string | undefined;
      let counterCast = false;
      let counterOid: string | undefined;
      let answered = false;
      let resolved = false;
      let unlessPayments = 0;
      try {
        expect(await backend.supports(table)).toEqual([]);
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        for (let index = 0; index < 1000 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing decision');
          const payer = session.view.seats[0];
          const pilot = session.view.seats[1];
          if (counterController === 'engine') {
            expect(decision.seat).toBe(0);
            expect(pilot.hand).toBeNull();
            const counter = session.view.stack.find(
              (card) => card.name === 'Censor' && !pilot.graveyard.some((dead) => dead.oid === card.oid),
            );
            if (counter !== undefined) {
              expect(sourceOid).toBeDefined();
              expect(session.view.stack.some((card) => card.oid === sourceOid)).toBe(true);
              counterCast = true;
              counterOid = counter.oid;
            }
          }
          if (
            counterController === 'engine' &&
            !counterCast &&
            sourceOid !== undefined &&
            payer.battlefield.some((card) => card.oid === sourceOid)
          )
            sourceOid = undefined;
          sourceOid ??= session.view.stack.find((card) => card.name === threatName)?.oid;
          if (answered && sourceOid !== undefined && session.view.stack.length === 0) {
            expect(payer.battlefield.some((card) => card.oid === sourceOid)).toBe(route === 'pay');
            expect(payer.graveyard.some((card) => card.oid === sourceOid)).toBe(route === 'decline');
            expect(pilot.graveyard.some((card) => card.name === 'Censor')).toBe(true);
            if (counterController === 'engine') {
              expect(counterOid).toBeDefined();
              expect(pilot.graveyard.some((card) => card.oid === counterOid)).toBe(true);
            }
            expect(unlessPayments).toBe(route === 'pay' ? 1 : 0);
            resolved = true;
            break;
          }
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind}: ${decision.prompt} | ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')} | stack=${session.view.stack.map((card) => `${card.name}:${card.oid}`).join(',')} botHand=${pilot.handSize} botUntapped=${pilot.battlefield.filter((card) => !card.tapped).length}`,
          );
          let move: string | undefined;
          if (decision.kind === 'priority') {
            // Keep the native counter fixture tapped out after casting, so Censor can matter.
            const landCapReached =
              counterController === 'engine' &&
              payer.battlefield.filter((card) => card.name === landName).length >= landsNeeded;
            if (!landCapReached)
              move = decision.options.find(
                (option) => option.text === (decision.seat === 0 ? `Play ${landName}` : 'Play Island'),
              )?.id;
            const ready =
              payer.battlefield.filter((card) => card.name === landName && !card.tapped).length >=
                landsNeeded &&
              pilot.battlefield.filter((card) => card.name === 'Island' && !card.tapped).length >= 2;
            if (move === undefined && decision.seat === 0 && sourceOid === undefined && ready)
              move = decision.options.find(
                (option) => option.text.startsWith(`${threatName}:`) && !option.text.includes('Eternalize'),
              )?.id;
            if (move === undefined && decision.seat === 1 && sourceOid !== undefined && !counterCast) {
              move = decision.options.find(
                (option) => option.text.startsWith('Censor:') && !option.text.includes('Cycling'),
              )?.id;
              counterCast = move !== undefined;
            }
            move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
          } else if (decision.kind === 'mana-payment') {
            if (decision.seat === 0 && counterCast) {
              expect(decision.prompt).toContain('Censor');
              move = decision.options.find((option) =>
                route === 'decline'
                  ? option.id === 'mana-payment-cancel'
                  : option.id.startsWith('mana-source-'),
              )?.id;
              answered = move !== undefined;
              if (route === 'pay') unlessPayments += 1;
            } else move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          } else if (decision.kind === 'target-selection') {
            expect(decision.seat).toBe(1);
            move = decision.options.find((option) => option.targets[0]?.oid === sourceOid)?.id;
          } else if (decision.kind === 'discard-selection') {
            move = decision.options.find((option) =>
              option.targets.some((target) => target.name === (decision.seat === 0 ? threatName : 'Censor')),
            )?.id;
          }
          move ??= decision.options.find(
            (option) =>
              ['Play first', 'Keep this hand'].includes(option.text) ||
              ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
          )?.id;
          if (move === undefined)
            throw new Error(`Unhandled counter decision\n${trace.slice(-8).join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
          session = advanced.session;
        }
        expect(
          resolved,
          `counterCast=${counterCast} answered=${answered} source=${sourceOid} counter=${counterOid}\n${trace.filter((line) => line.includes('mana-payment') || line.includes(`stack=${threatName}`) || line.includes('stack=Censor')).join('\n')}\n${trace.slice(-16).join('\n')}`,
        ).toBe(true);
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
}
