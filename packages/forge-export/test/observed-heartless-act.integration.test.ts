/** Installed-Forge proof for Heartless Act's exact modal counter route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function table(route: 'destroy' | 'remove'): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `Heartless Act ${route} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-heartless-act-${route}`,
          cards: [
            { name: 'Swamp', count: 30 },
            { name: 'Heartless Act', count: 30 },
          ],
        },
      },
      {
        name: `Heartless Act ${route} target builder`,
        controller: 'local',
        deck:
          route === 'destroy'
            ? {
                name: 'z5q4-heartless-act-destroy-targets',
                cards: [
                  { name: 'Plains', count: 30 },
                  { name: 'Student of Warfare', count: 15 },
                  { name: 'Wall of Omens', count: 15 },
                ],
              }
            : {
                name: 'z5q4-heartless-act-remove-targets',
                cards: [
                  { name: 'Plains', count: 30 },
                  { name: 'Student of Warfare', count: 15 },
                  { name: 'Luminarch Aspirant', count: 15 },
                ],
              },
      },
    ],
    seed: `z5q4-heartless-act-${route}-outcomes`,
    maximumTurns: 24,
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

function counters(card: ObservedSession['view']['seats'][number]['battlefield'][number]): {
  readonly level: number;
  readonly plusOne: number;
} {
  let level = 0;
  let plusOne = 0;
  for (const [kind, count] of Object.entries(card.counters)) {
    if (kind.toUpperCase().includes('LEVEL')) level += count;
    if (kind.toUpperCase().includes('P1P1') || kind.includes('+1/+1')) plusOne += count;
  }
  return { level, plusOne };
}

async function proveDestroyRoute(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let castAttempts = 0;
  let modeMenus = 0;
  let inventedModeRejected = false;
  let staleModeRejected = false;
  let inventedTargetRejected = false;
  let canceled = false;
  let cancellationRestored = false;
  let studentOid: string | undefined;
  let wallOid: string | undefined;
  let exactTargetSet = false;
  try {
    const spec = table('destroy');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;

    for (let moves = 0; session.status === 'awaiting' && moves < 1_500; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Heartless Act destroy decision');
      const pilot = session.view.seats[0];
      const builder = session.view.seats[1];
      const student = builder.battlefield.find((card) => card.name === 'Student of Warfare');
      const wall = builder.battlefield.find((card) => card.name === 'Wall of Omens');
      studentOid ??= student?.oid;
      wallOid ??= wall?.oid;
      const studentLevel = student === undefined ? 0 : counters(student).level;
      const completed =
        wallOid !== undefined &&
        builder.graveyard.some((card) => card.oid === wallOid) &&
        studentOid !== undefined &&
        builder.battlefield.some((card) => card.oid === studentOid);
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move: string | undefined;
      if (decision.kind === 'mode-selection' && decision.seat === 0) {
        modeMenus += 1;
        expect(decision.options, trace.at(-1)).toHaveLength(2);
        const destroy = decision.options.find((option) => option.text.includes('no counters'));
        expect(destroy, trace.at(-1)).toBeDefined();
        expect(decision.options.some((option) => option.text.includes('up to three counters'))).toBe(true);
        if (!inventedModeRejected) {
          await expect(session.submit('mode-selection-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedModeRejected = true;
        }
        const stale = session;
        const advanced = await session.submit(destroy!.id);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (!staleModeRejected) {
          await expect(stale.submit(destroy!.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleModeRejected = true;
        }
        continue;
      }
      if (decision.kind === 'target-selection' && decision.seat === 0) {
        const targets = decision.options.filter((option) => option.targets.length === 1);
        expect(new Set(targets.map((option) => option.targets[0]!.oid)), trace.at(-1)).toEqual(
          new Set([wallOid]),
        );
        exactTargetSet = true;
        if (!inventedTargetRejected) {
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedTargetRejected = true;
        }
        if (!canceled) {
          const cancel = decision.options.find((option) => option.id === 'target-cancel');
          expect(cancel, trace.at(-1)).toBeDefined();
          const advanced = await session.submit(cancel!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          canceled = true;
          cancellationRestored =
            session.view.seats[0].hand?.some((card) => card.name === 'Heartless Act') === true &&
            session.view.seats[0].battlefield
              .filter((card) => card.name === 'Swamp')
              .every((card) => !card.tapped) &&
            session.view.seats[1].battlefield.some((card) => card.oid === wallOid) &&
            session.view.seats[1].battlefield.some((card) => card.oid === studentOid);
          continue;
        }
        move = targets[0]?.id;
      } else if (decision.kind === 'priority') {
        const plains = builder.battlefield.filter((card) => card.name === 'Plains' && !card.tapped).length;
        const swamps = pilot.battlefield.filter((card) => card.name === 'Swamp' && !card.tapped).length;
        const levelUp = decision.options.find(
          (option) => option.text.startsWith('Student of Warfare:') && option.text.includes('Level up'),
        );
        const cast = decision.options.find((option) => option.text.startsWith('Heartless Act:'));
        move =
          (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Swamp')?.id
            : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
          (decision.seat === 1 && student === undefined && plains >= 1
            ? decision.options.find((option) => option.text.startsWith('Student of Warfare:'))?.id
            : undefined) ??
          (decision.seat === 1 && student !== undefined && studentLevel < 1 && plains >= 1
            ? levelUp?.id
            : undefined) ??
          (decision.seat === 1 && studentLevel >= 1 && wall === undefined && plains >= 2
            ? decision.options.find((option) => option.text.startsWith('Wall of Omens:'))?.id
            : undefined) ??
          (decision.seat === 0 && studentLevel >= 1 && wall !== undefined && swamps >= 2
            ? cast?.id
            : undefined) ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
        if (move === cast?.id) castAttempts += 1;
      } else {
        move = routineMove(decision);
      }

      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Heartless Act destroy move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(castAttempts, evidence).toBeGreaterThanOrEqual(2);
    expect(modeMenus, evidence).toBeGreaterThanOrEqual(2);
    expect(inventedModeRejected, evidence).toBe(true);
    expect(staleModeRejected, evidence).toBe(true);
    expect(inventedTargetRejected, evidence).toBe(true);
    expect(canceled, evidence).toBe(true);
    expect(cancellationRestored, evidence).toBe(true);
    expect(exactTargetSet, evidence).toBe(true);
    expect(wallOid, evidence).toMatch(/^forge-card-/u);
    expect(
      session.view.seats[1].graveyard.some((card) => card.oid === wallOid),
      evidence,
    ).toBe(true);
    expect(
      session.view.seats[1].battlefield.some((card) => card.oid === studentOid),
      evidence,
    ).toBe(true);
    expect(session.status, evidence).toBe('finished');
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-300).join('\n')}`, { cause });
  } finally {
    await session?.close();
    await backend.shutdown?.();
  }
}

async function proveRemoveRoute(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let studentOid: string | undefined;
  let aspirantOid: string | undefined;
  let aspirantTargetedStudent = false;
  let sawRemoveMode = false;
  let exactCreatureTargets = false;
  let choseCounterType = false;
  let inventedCounterTypeRejected = false;
  let staleCounterTypeRejected = false;
  let sawFullNumberRange = false;
  let inventedNumberRejected = false;
  let choseTwo = false;
  let stoppedAtZero = false;
  try {
    const spec = table('remove');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;

    for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Heartless Act remove decision');
      const pilot = session.view.seats[0];
      const builder = session.view.seats[1];
      const student = builder.battlefield.find((card) => card.name === 'Student of Warfare');
      const aspirant = builder.battlefield.find((card) => card.name === 'Luminarch Aspirant');
      studentOid ??= student?.oid;
      aspirantOid ??= aspirant?.oid;
      const count = student === undefined ? { level: 0, plusOne: 0 } : counters(student);
      const completed =
        choseTwo &&
        stoppedAtZero &&
        pilot.graveyard.some((card) => card.name === 'Heartless Act') &&
        count.level === 1 &&
        count.plusOne === 1;
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move: string | undefined;
      if (decision.kind === 'mode-selection' && decision.seat === 0) {
        expect(decision.options, trace.at(-1)).toHaveLength(2);
        const remove = decision.options.find((option) => option.text.includes('up to three counters'));
        expect(remove, trace.at(-1)).toBeDefined();
        sawRemoveMode = true;
        move = remove!.id;
      } else if (decision.kind === 'target-selection') {
        const targets = decision.options.filter((option) => option.targets.length === 1);
        if (decision.seat === 1) {
          const chosen = targets.find((option) => option.targets[0]?.oid === studentOid);
          expect(chosen, trace.at(-1)).toBeDefined();
          aspirantTargetedStudent = true;
          move = chosen!.id;
        } else {
          expect(new Set(targets.map((option) => option.targets[0]!.oid)), trace.at(-1)).toEqual(
            new Set([studentOid, aspirantOid]),
          );
          exactCreatureTargets = true;
          move = targets.find((option) => option.targets[0]?.oid === studentOid)?.id;
        }
      } else if (decision.kind === 'counter-type-choice' && decision.seat === 0) {
        const descriptions = decision.options.map((option) => option.text.toUpperCase());
        expect(
          descriptions.some((text) => text.includes('LEVEL')),
          trace.at(-1),
        ).toBe(true);
        expect(
          descriptions.some((text) => text.includes('P1P1') || text.includes('+1/+1')),
          trace.at(-1),
        ).toBe(true);
        expect(decision.options, trace.at(-1)).toHaveLength(2);
        if (!inventedCounterTypeRejected) {
          await expect(session.submit('counter-type-choice-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedCounterTypeRejected = true;
        }
        const level = decision.options.find((option) => option.text.toUpperCase().includes('LEVEL'));
        expect(level, trace.at(-1)).toBeDefined();
        const stale = session;
        const advanced = await session.submit(level!.id);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        const staleResult = await stale.submit(level!.id);
        expect(staleResult).toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleCounterTypeRejected = true;
        choseCounterType = true;
        continue;
      } else if (decision.kind === 'number' && decision.seat === 0) {
        const ids = new Set(decision.options.map((option) => option.id));
        if (!choseTwo) {
          expect(ids, trace.at(-1)).toEqual(new Set(['number-0', 'number-1', 'number-2', 'number-3']));
          sawFullNumberRange = true;
          await expect(session.submit('number-4')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedNumberRejected = true;
          move = 'number-2';
          choseTwo = true;
        } else {
          expect(ids, trace.at(-1)).toEqual(new Set(['number-0', 'number-1']));
          move = 'number-0';
          stoppedAtZero = true;
        }
      } else if (decision.kind === 'priority') {
        const plains = builder.battlefield.filter((card) => card.name === 'Plains' && !card.tapped).length;
        const swamps = pilot.battlefield.filter((card) => card.name === 'Swamp' && !card.tapped).length;
        const levelUp = decision.options.find(
          (option) => option.text.startsWith('Student of Warfare:') && option.text.includes('Level up'),
        );
        move =
          (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Swamp')?.id
            : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
          (decision.seat === 1 && student === undefined && plains >= 1
            ? decision.options.find((option) => option.text.startsWith('Student of Warfare:'))?.id
            : undefined) ??
          (decision.seat === 1 && student !== undefined && aspirant === undefined && plains >= 2
            ? decision.options.find((option) => option.text.startsWith('Luminarch Aspirant:'))?.id
            : undefined) ??
          (decision.seat === 1 && aspirant !== undefined && count.level < 3 && plains >= 1
            ? levelUp?.id
            : undefined) ??
          (decision.seat === 0 && count.level === 3 && count.plusOne === 1 && swamps >= 2
            ? decision.options.find((option) => option.text.startsWith('Heartless Act:'))?.id
            : undefined) ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
      } else {
        move = routineMove(decision);
      }

      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Heartless Act remove move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
    const finalStudent = session.view.seats[1].battlefield.find((card) => card.oid === studentOid);
    expect(studentOid, evidence).toMatch(/^forge-card-/u);
    expect(aspirantOid, evidence).toMatch(/^forge-card-/u);
    expect(aspirantTargetedStudent, evidence).toBe(true);
    expect(sawRemoveMode, evidence).toBe(true);
    expect(exactCreatureTargets, evidence).toBe(true);
    expect(choseCounterType, evidence).toBe(true);
    expect(inventedCounterTypeRejected, evidence).toBe(true);
    expect(staleCounterTypeRejected, evidence).toBe(true);
    expect(sawFullNumberRange, evidence).toBe(true);
    expect(inventedNumberRejected, evidence).toBe(true);
    expect(choseTwo, evidence).toBe(true);
    expect(stoppedAtZero, evidence).toBe(true);
    expect(finalStudent, evidence).toBeDefined();
    expect(counters(finalStudent!), evidence).toEqual({ level: 1, plusOne: 1 });
    expect(session.status, evidence).toBe('finished');
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-360).join('\n')}`, { cause });
  } finally {
    await session?.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'proves both exact Heartless Act modes, rollback, owned choices, and counter deltas',
  async () => {
    await proveDestroyRoute();
    await proveRemoveRoute();
  },
  600_000,
);
