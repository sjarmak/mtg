/** Installed-Forge proof for Engineered Explosives' exact Sunburst sweep. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Engineered Explosives pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-engineered-explosives-outcomes',
        cards: [
          { name: 'Volcanic Island', count: 24 },
          { name: 'Baral, Chief of Compliance', count: 18 },
          { name: 'Engineered Explosives', count: 18 },
        ],
      },
    },
    {
      name: 'Engineered Explosives opposing board',
      controller: 'local',
      deck: {
        name: 'z5q4-engineered-explosives-board',
        cards: [
          { name: 'Savannah', count: 24 },
          { name: 'Llanowar Elves', count: 12 },
          { name: 'Wall of Omens', count: 12 },
          { name: 'Sword of Fire and Ice', count: 12 },
        ],
      },
    },
  ],
  seed: 'z5q4-engineered-explosives-sunburst-two',
  maximumTurns: 30,
};

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  }
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function traceDecision(session: ObservedSession): string {
  const decision = session.decision;
  if (decision === null) return 'no decision';
  return `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
}

forgeIt(
  'uses colors spent for CHARGE counters, sacrifices itself, and sweeps only matching nonlands',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(TABLE)).toEqual([]);
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    const trace: string[] = [];
    let castAttempts = 0;
    let payingExplosivesCast = false;
    let firstPaymentSteps = 0;
    const successfulColors: string[] = [];
    let pendingExplosivesOid: string | undefined;
    let explosivesOid: string | undefined;
    let baralOid: string | undefined;
    let elfOid: string | undefined;
    let wallOid: string | undefined;
    let swordOid: string | undefined;
    let canceled = false;
    let rollbackObserved = false;
    let inventedNumberRejected = false;
    let staleNumberRejected = false;
    let inventedManaRejected = false;
    let staleManaRejected = false;
    let countersObserved = false;
    let activated = false;
    let landsBeforeActivation = new Set<string>();
    let completed = false;
    try {
      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Engineered Explosives decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null || opponent.hand === null) {
          throw new Error('Forge hid a local Engineered Explosives hand');
        }
        baralOid ??= pilot.battlefield.find((card) => card.name === 'Baral, Chief of Compliance')?.oid;
        elfOid ??= opponent.battlefield.find((card) => card.name === 'Llanowar Elves')?.oid;
        wallOid ??= opponent.battlefield.find((card) => card.name === 'Wall of Omens')?.oid;
        swordOid ??= opponent.battlefield.find((card) => card.name === 'Sword of Fire and Ice')?.oid;
        const explosives = pilot.battlefield.find(
          (card) => card.name === 'Engineered Explosives' && card.oid === pendingExplosivesOid,
        );
        if (explosives !== undefined) {
          explosivesOid = explosives.oid;
          payingExplosivesCast = false;
          expect(explosives.counters, trace.at(-1)).toEqual({ CHARGE: 2 });
          countersObserved = true;
        }
        completed =
          activated &&
          explosivesOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === explosivesOid) &&
          !pilot.battlefield.some((card) => card.oid === explosivesOid) &&
          baralOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === baralOid) &&
          wallOid !== undefined &&
          opponent.graveyard.some((card) => card.oid === wallOid) &&
          elfOid !== undefined &&
          opponent.battlefield.some((card) => card.oid === elfOid) &&
          swordOid !== undefined &&
          opponent.battlefield.some((card) => card.oid === swordOid) &&
          [...landsBeforeActivation].every((oid) =>
            [...pilot.battlefield, ...opponent.battlefield].some(
              (card) => card.oid === oid && card.typeLine.includes('Land'),
            ),
          ) &&
          session.view.stack.length === 0;
        trace.push(traceDecision(session));

        let move: string | undefined;
        if (decision.kind === 'number' && payingExplosivesCast) {
          const stops = decision.options
            .filter((option) => /^number-\d+$/u.test(option.id))
            .map((option) => Number(option.id.slice('number-'.length)));
          expect(stops, trace.at(-1)).toContain(2);
          const two = decision.options.find((option) => option.id === 'number-2');
          expect(two, trace.at(-1)).toBeDefined();
          if (!inventedNumberRejected) {
            await expect(session.submit('number-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedNumberRejected = true;
          }
          const stale = session;
          const advanced = await session.submit(two!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          if (!staleNumberRejected) {
            await expect(stale.submit(two!.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleNumberRejected = true;
          }
          session = advanced.session;
          continue;
        } else if (decision.kind === 'mana-payment' && payingExplosivesCast) {
          if (castAttempts === 1) {
            if (firstPaymentSteps === 0) {
              if (!inventedManaRejected) {
                await expect(session.submit('mana-source-invented-R')).resolves.toMatchObject({
                  ok: false,
                  error: { kind: 'unknown-move' },
                });
                inventedManaRejected = true;
              }
              const source = decision.options.find(
                (option) => option.id.startsWith('mana-source-') && option.text.includes('{U}'),
              );
              expect(source, trace.at(-1)).toBeDefined();
              const stale = session;
              const advanced = await session.submit(source!.id);
              if (!advanced.ok) throw new Error(advanced.error.message);
              if (!staleManaRejected) {
                await expect(stale.submit(source!.id)).resolves.toMatchObject({
                  ok: false,
                  error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
                });
                staleManaRejected = true;
              }
              session = advanced.session;
              firstPaymentSteps += 1;
              continue;
            }
            const cancel = decision.options.find((option) => option.id === 'mana-payment-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            const advanced = await session.submit(cancel!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            const restored = session.view.seats[0];
            rollbackObserved =
              pendingExplosivesOid !== undefined &&
              restored.hand?.some((card) => card.oid === pendingExplosivesOid) === true &&
              restored.battlefield
                .filter((card) => card.name === 'Volcanic Island')
                .every((card) => !card.tapped) &&
              session.view.stack.length === 0;
            canceled = true;
            payingExplosivesCast = false;
            pendingExplosivesOid = undefined;
            continue;
          }
          const desired = successfulColors.length === 0 ? '{U}' : '{R}';
          const source = decision.options.find(
            (option) => option.id.startsWith('mana-source-') && option.text.includes(desired),
          );
          expect(source, trace.at(-1)).toBeDefined();
          successfulColors.push(desired);
          move = source?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'priority') {
          const pilotLands = pilot.battlefield.filter(
            (card) => card.name === 'Volcanic Island' && !card.tapped,
          ).length;
          const opposingLands = opponent.battlefield.filter(
            (card) => card.name === 'Savannah' && !card.tapped,
          ).length;
          const boardReady =
            baralOid !== undefined && elfOid !== undefined && wallOid !== undefined && swordOid !== undefined;
          const cast = decision.options.find((option) => option.text.startsWith('Engineered Explosives:'));
          const activate =
            explosivesOid === undefined
              ? undefined
              : decision.options.find(
                  (option) =>
                    option.text.startsWith('Engineered Explosives:') &&
                    option.text.includes('{2}, Sacrifice Engineered Explosives:'),
                );
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Volcanic Island')?.id
              : undefined) ??
            (decision.seat === 1
              ? decision.options.find((option) => option.text === 'Play Savannah')?.id
              : undefined) ??
            (decision.seat === 0 && baralOid === undefined && pilotLands >= 2
              ? decision.options.find((option) => option.text.startsWith('Baral, Chief of Compliance:'))?.id
              : undefined) ??
            (decision.seat === 1 && elfOid === undefined && opposingLands >= 1
              ? decision.options.find((option) => option.text.startsWith('Llanowar Elves:'))?.id
              : undefined) ??
            (decision.seat === 1 && wallOid === undefined && opposingLands >= 2
              ? decision.options.find((option) => option.text.startsWith('Wall of Omens:'))?.id
              : undefined) ??
            (decision.seat === 1 && swordOid === undefined && opposingLands >= 3
              ? decision.options.find((option) => option.text.startsWith('Sword of Fire and Ice:'))?.id
              : undefined) ??
            (decision.seat === 0 &&
            boardReady &&
            explosivesOid === undefined &&
            pilotLands >= 2 &&
            castAttempts < 2
              ? cast?.id
              : undefined) ??
            (decision.seat === 0 && countersObserved && !activated && pilotLands >= 2
              ? activate?.id
              : undefined);
          if (move !== undefined && move === cast?.id && explosivesOid === undefined) {
            const inHand = pilot.hand.find((card) => card.name === 'Engineered Explosives');
            expect(inHand, trace.at(-1)).toBeDefined();
            pendingExplosivesOid = inHand?.oid;
            payingExplosivesCast = true;
            castAttempts += 1;
          } else if (move !== undefined && move === activate?.id) {
            landsBeforeActivation = new Set(
              [...pilot.battlefield, ...opponent.battlefield]
                .filter((card) => card.typeLine.includes('Land'))
                .map((card) => card.oid),
            );
            activated = true;
          }
        }

        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Engineered Explosives move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-240).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(castAttempts, evidence).toBe(2);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(inventedNumberRejected, evidence).toBe(true);
      expect(staleNumberRejected, evidence).toBe(true);
      expect(inventedManaRejected, evidence).toBe(true);
      expect(staleManaRejected, evidence).toBe(true);
      expect(successfulColors, evidence).toEqual(['{U}', '{R}']);
      expect(countersObserved, evidence).toBe(true);
      expect(activated, evidence).toBe(true);
      expect(completed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  420_000,
);
