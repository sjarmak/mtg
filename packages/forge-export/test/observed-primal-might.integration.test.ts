/** Installed-Forge proof for Primal Might's exact X-pump and optional fight route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function table(fight: boolean): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `Primal Might ${fight ? 'fight' : 'no-fight'} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-primal-might-${fight ? 'fight' : 'no-fight'}`,
          cards: [
            { name: 'Forest', count: 30 },
            { name: 'Llanowar Elves', count: 15 },
            { name: 'Primal Might', count: 15 },
          ],
        },
      },
      {
        name: 'Primal Might opposing target builder',
        controller: 'local',
        deck: {
          name: `z5q4-primal-might-target-${fight ? 'fight' : 'no-fight'}`,
          cards: [
            { name: 'Plains', count: 45 },
            { name: 'Mother of Runes', count: 15 },
          ],
        },
      },
    ],
    seed: `z5q4-primal-might-${fight ? 'fight' : 'no-fight'}-outcome`,
    maximumTurns: 20,
  };
}

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

async function proveRoute(fight: boolean): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = table(fight);
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let castAttempts = 0;
  let announcedX = false;
  let canceled = false;
  let cancellationRestored = false;
  let inventedRejected = false;
  let staleRejected = false;
  let rootTargetOid: string | undefined;
  let fightTargetOid: string | undefined;
  let sawRootMenu = false;
  let sawFightMenu = false;
  let completed = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_500; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Primal Might decision');
      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      const elf = pilot.battlefield.find((card) => card.name === 'Llanowar Elves');
      const mother = opponent.battlefield.find((card) => card.name === 'Mother of Runes');
      rootTargetOid ??= elf?.oid;
      fightTargetOid ??= mother?.oid;
      completed =
        rootTargetOid !== undefined &&
        pilot.graveyard.some((card) => card.name === 'Primal Might') &&
        pilot.battlefield.some(
          (card) => card.oid === rootTargetOid && card.power === 3 && card.toughness === 3,
        ) &&
        fightTargetOid !== undefined &&
        (fight
          ? opponent.graveyard.some((card) => card.oid === fightTargetOid)
          : opponent.battlefield.some((card) => card.oid === fightTargetOid));
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move: string | undefined;
      if (decision.kind === 'number' && decision.seat === 0) {
        const stops = decision.options
          .filter((option) => /^number-\d+$/u.test(option.id))
          .map((option) => Number(option.id.slice('number-'.length)));
        expect(stops).toContain(2);
        expect(Math.max(...stops)).toBeGreaterThan(2);
        move = decision.options.find((option) => option.id === 'number-2')?.id;
        announcedX = move !== undefined;
      } else if (decision.kind === 'target-selection' && decision.seat === 0) {
        const targetOptions = decision.options.filter((option) => option.targets.length === 1);
        const offered = new Set(targetOptions.map((option) => option.targets[0]!.oid));
        if (targetOptions.some((option) => option.targets[0]?.oid === rootTargetOid)) {
          expect(offered, trace.at(-1)).toEqual(new Set([rootTargetOid]));
          sawRootMenu = true;
          if (!inventedRejected) {
            await expect(session.submit('target-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!canceled) {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            if (cancel === undefined) throw new Error('Forge offered no Primal Might cancellation');
            const advanced = await session.submit(cancel.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            canceled = true;
            const restoredPilot = session.view.seats[0];
            cancellationRestored =
              restoredPilot.hand?.some((card) => card.name === 'Primal Might') === true &&
              restoredPilot.battlefield
                .filter((card) => card.name === 'Forest')
                .every((card) => !card.tapped) &&
              restoredPilot.battlefield.some((card) => card.oid === rootTargetOid) &&
              session.view.seats[1].battlefield.some((card) => card.oid === fightTargetOid);
            continue;
          }
          const wanted = targetOptions.find((option) => option.targets[0]?.oid === rootTargetOid);
          if (wanted === undefined) throw new Error('Forge omitted the Primal Might pump target');
          const staleSession = session;
          const advanced = await session.submit(wanted.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          const stale = await staleSession.submit(wanted.id);
          expect(stale).toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
          continue;
        }
        expect(offered, trace.at(-1)).toEqual(new Set([fightTargetOid]));
        expect(decision.options.some((option) => option.id === 'target-none')).toBe(true);
        sawFightMenu = true;
        move = fight
          ? targetOptions.find((option) => option.targets[0]?.oid === fightTargetOid)?.id
          : decision.options.find((option) => option.id === 'target-none')?.id;
      } else if (decision.kind === 'priority') {
        const forests = pilot.battlefield.filter((card) => card.name === 'Forest').length;
        const plains = opponent.battlefield.filter((card) => card.name === 'Plains').length;
        const cast = decision.options.find((option) => option.text.startsWith('Primal Might:'));
        move =
          (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Forest')?.id
            : undefined) ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Plains')?.id
            : undefined) ??
          (decision.seat === 0 && elf === undefined && forests >= 1
            ? decision.options.find((option) => option.text.startsWith('Llanowar Elves:'))?.id
            : undefined) ??
          (decision.seat === 1 && mother === undefined && plains >= 1
            ? decision.options.find((option) => option.text.startsWith('Mother of Runes:'))?.id
            : undefined) ??
          (decision.seat === 0 &&
          elf !== undefined &&
          mother !== undefined &&
          forests >= 3 &&
          castAttempts < 2
            ? cast?.id
            : undefined);
        if (move !== undefined && move === cast?.id) castAttempts += 1;
      }

      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Primal Might move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(castAttempts, evidence).toBe(2);
    expect(announcedX, evidence).toBe(true);
    expect(canceled, evidence).toBe(true);
    expect(cancellationRestored, evidence).toBe(true);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(sawRootMenu, evidence).toBe(true);
    expect(sawFightMenu, evidence).toBe(true);
    expect(completed, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'proves Primal Might X, target filters, optional fight, and outcomes',
  async () => {
    await proveRoute(false);
    await proveRoute(true);
  },
  300_000,
);
