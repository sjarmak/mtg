/** Installed-Forge proof for Bloodchief's Thirst's exact Kicker-dependent target route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function table(kicked: boolean): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `Bloodchief's Thirst ${kicked ? 'kicked' : 'ordinary'} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-bloodchiefs-thirst-${kicked ? 'kicked' : 'ordinary'}`,
          cards: [
            { name: 'Swamp', count: 30 },
            { name: "Bloodchief's Thirst", count: 30 },
          ],
        },
      },
      {
        name: 'Bloodchief target builder',
        controller: 'local',
        deck: {
          name: `z5q4-bloodchiefs-thirst-targets-${kicked ? 'kicked' : 'ordinary'}`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Mother of Runes', count: 15 },
            { name: 'Baneslayer Angel', count: 15 },
          ],
        },
      },
    ],
    seed: `z5q4-bloodchiefs-thirst-${kicked ? 'kicked' : 'ordinary'}-outcome`,
    maximumTurns: 24,
  };
}

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  }
  if (decision.kind === 'discard-selection') {
    return (
      decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
      decision.options.find((option) => option.targets.length === 1)?.id
    );
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

async function proveRoute(kicked: boolean): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = table(kicked);
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let castAttempts = 0;
  let chooseKicker = false;
  let canceled = false;
  let cancellationRestored = false;
  let inventedRejected = false;
  let staleRejected = false;
  let targetOid: string | undefined;
  let otherOid: string | undefined;
  let completed = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_500; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error("Forge offered no Bloodchief's Thirst decision");
      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      const mother = opponent.battlefield.find((card) => card.name === 'Mother of Runes');
      const angel = opponent.battlefield.find((card) => card.name === 'Baneslayer Angel');
      targetOid ??= (kicked ? angel : mother)?.oid;
      otherOid ??= (kicked ? mother : angel)?.oid;
      completed =
        targetOid !== undefined &&
        pilot.graveyard.some((card) => card.name === "Bloodchief's Thirst") &&
        opponent.graveyard.some((card) => card.oid === targetOid) &&
        otherOid !== undefined &&
        opponent.battlefield.some((card) => card.oid === otherOid);
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move: string | undefined;
      if (decision.kind === 'optional-cost-choice' && decision.seat === 0) {
        const kicker = decision.options.find((option) => !option.id.endsWith('-done'));
        move =
          kicked && !chooseKicker
            ? kicker?.id
            : decision.options.find((option) => option.id.endsWith('-done'))?.id;
        chooseKicker ||= move !== undefined && move === kicker?.id;
      } else if (decision.kind === 'target-selection' && decision.seat === 0) {
        const targetOptions = decision.options.filter((option) => option.targets.length === 1);
        const expected = new Set(
          [mother?.oid, kicked ? angel?.oid : undefined].filter((oid): oid is string => oid !== undefined),
        );
        expect(new Set(targetOptions.map((option) => option.targets[0]!.oid)), trace.at(-1)).toEqual(
          expected,
        );
        if (!inventedRejected) {
          await expect(session.submit('target-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        if (!kicked && !canceled) {
          const cancel = decision.options.find((option) => option.id === 'target-cancel');
          if (cancel === undefined) throw new Error('Forge offered no ordinary target cancellation');
          const advanced = await session.submit(cancel.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          canceled = true;
          const restoredPilot = session.view.seats[0];
          cancellationRestored =
            restoredPilot.hand?.some((card) => card.name === "Bloodchief's Thirst") === true &&
            restoredPilot.battlefield.filter((card) => card.name === 'Swamp').every((card) => !card.tapped) &&
            session.view.seats[1].battlefield.some((card) => card.oid === mother?.oid) &&
            session.view.seats[1].battlefield.some((card) => card.oid === angel?.oid);
          continue;
        }
        const wanted = targetOptions.find((option) => option.targets[0]?.oid === targetOid);
        if (wanted === undefined) throw new Error("Forge omitted Bloodchief's Thirst target");
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
      } else if (decision.kind === 'priority') {
        const swamps = pilot.battlefield.filter((card) => card.name === 'Swamp').length;
        const plains = opponent.battlefield.filter((card) => card.name === 'Plains').length;
        const cast = decision.options.find((option) => option.text.startsWith("Bloodchief's Thirst:"));
        const ready = mother !== undefined && angel !== undefined && swamps >= (kicked ? 4 : 1);
        move =
          (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Swamp')?.id
            : undefined) ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Plains')?.id
            : undefined) ??
          (decision.seat === 1 && mother === undefined && plains >= 1
            ? decision.options.find((option) => option.text.startsWith('Mother of Runes:'))?.id
            : undefined) ??
          (decision.seat === 1 && angel === undefined && plains >= 5
            ? decision.options.find((option) => option.text.startsWith('Baneslayer Angel:'))?.id
            : undefined) ??
          (decision.seat === 0 && ready && castAttempts < (kicked ? 1 : 2) ? cast?.id : undefined);
        if (move !== undefined && move === cast?.id) castAttempts += 1;
      }

      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error("Forge offered no Bloodchief's Thirst move");
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(castAttempts, evidence).toBe(kicked ? 1 : 2);
    expect(chooseKicker, evidence).toBe(kicked);
    expect(canceled, evidence).toBe(!kicked);
    expect(cancellationRestored, evidence).toBe(!kicked);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(targetOid, evidence).toMatch(/^forge-card-/u);
    expect(otherOid, evidence).toMatch(/^forge-card-/u);
    expect(completed, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  "proves Bloodchief's Thirst ordinary and kicked target filters and outcomes",
  async () => {
    await proveRoute(false);
    await proveRoute(true);
  },
  300_000,
);
