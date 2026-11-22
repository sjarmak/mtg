/** Installed-Forge proof for Sword of Light and Shadow's exact attachment and optional return trigger. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(color: 'white' | 'black'): SessionSpec {
  const land = color === 'white' ? 'Plains' : 'Swamp';
  const blocker = color === 'white' ? 'Student of Warfare' : 'Gravecrawler';
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Light and Shadow pilot',
        controller: 'local',
        deck: {
          name: `z5q4-light-shadow-${color}`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Student of Warfare', count: 15 },
            { name: 'Sword of Light and Shadow', count: 15 },
          ],
        },
      },
      {
        name: `${color} blocker pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-light-shadow-${color}-blocker`,
          cards: [
            { name: land, count: 30 },
            { name: blocker, count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-sword-of-light-and-shadow-${color}-outcomes`,
    maximumTurns: 35,
  };
}

function castOption(session: ObservedSession, name: string): string | undefined {
  return session.decision?.options.find(
    (option) => option.text.startsWith(`${name}:`) && !option.text.includes('Equip'),
  )?.id;
}

forgeIt.each([
  ['white', 'Plains', 'Student of Warfare', 'decline'],
  ['black', 'Swamp', 'Gravecrawler', 'return'],
] as const)(
  'equips for {2}, preserves %s protection, gains three, and exercises optional return',
  async (color, land, blockerName, branch) => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let setupAttackerOid: string | null = null;
    let setupAttackInFlight = false;
    let setupBlockerOid: string | null = null;
    let graveyardStudentOid: string | null = null;
    let pendingEquip = false;
    let equipCancellationPending = false;
    let equipCanceled = false;
    let canceledObjects: readonly string[] = [];
    let canceledTappedLands = 0;
    let equippedOid: string | null = null;
    let equipManaPayments = 0;
    let equipPaymentInFlight = false;
    let equipOutcome = false;
    let protectedAttackInFlight = false;
    let protectionObserved = false;
    let pilotLifeBeforeTrigger: number | null = null;
    let opponentLifeBeforeAttack: number | null = null;
    let handBeforeReturn: number | null = null;
    let optionalTargetObserved = false;
    let triggerOutcome = false;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    try {
      expect(await backend.supports(table(color))).toEqual([]);
      const opened = await backend.open(table(color));
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Light and Shadow decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          if (equipPaymentInFlight) equipManaPayments += 1;
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'target-selection') {
          if (pendingEquip) {
            const target = decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Student of Warfare',
            );
            if (target === undefined) throw new Error('Forge offered no exact Light and Shadow Equip target');
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            if (!equipCanceled) {
              const cancel = decision.options.find((option) => option.id === 'target-cancel');
              if (cancel === undefined) throw new Error('Forge omitted Equip target cancellation');
              canceledObjects = session.view.seats[0].battlefield.map((card) => card.oid).sort();
              canceledTappedLands = session.view.seats[0].battlefield.filter(
                (card) => card.name === 'Plains' && card.tapped,
              ).length;
              move = cancel.id;
              equipCancellationPending = true;
              pendingEquip = false;
            } else {
              equippedOid = target.targets[0]?.oid ?? null;
              move = target.id;
              pendingEquip = false;
              equipPaymentInFlight = true;
            }
          } else {
            const target = decision.options.find((option) => option.targets[0]?.oid === graveyardStudentOid);
            expect(decision.options.some((option) => option.id === 'target-none')).toBe(true);
            if (target === undefined)
              throw new Error('Forge omitted the exact local graveyard creature target');
            optionalTargetObserved = true;
            handBeforeReturn = session.view.seats[0].handSize;
            const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
            protectionObserved ||=
              protectedAttackInFlight &&
              blocker !== undefined &&
              !blocker.tapped &&
              opponentLifeBeforeAttack !== null &&
              session.view.seats[1].life === opponentLifeBeforeAttack - 3;
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            if (branch === 'return') {
              staleSnapshot = session;
              staleMove = target.id;
              move = target.id;
            } else {
              move = 'target-none';
            }
          }
        } else if (decision.kind === 'combat-attackers') {
          const pilot = session.view.seats[0];
          const opponent = session.view.seats[1];
          if (graveyardStudentOid === null) {
            const student = pilot.battlefield.find((card) => card.name === 'Student of Warfare');
            const blocker = opponent.battlefield.find((card) => card.name === blockerName);
            const add = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === student?.oid,
            );
            if (!setupAttackInFlight && student !== undefined && blocker !== undefined && add !== undefined) {
              setupAttackerOid = student.oid;
              setupBlockerOid = blocker.oid;
              setupAttackInFlight = true;
              move = add.id;
            } else {
              move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            }
          } else {
            const blocker = opponent.battlefield.find((card) => card.name === blockerName);
            const add = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === equippedOid,
            );
            if (!protectedAttackInFlight && equipOutcome && blocker !== undefined && add !== undefined) {
              pilotLifeBeforeTrigger = pilot.life;
              opponentLifeBeforeAttack = opponent.life;
              protectedAttackInFlight = true;
              move = add.id;
            } else {
              move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            }
          }
        } else if (decision.kind === 'combat-blockers') {
          if (setupAttackInFlight && graveyardStudentOid === null) {
            const block = decision.options.find(
              (option) =>
                option.id.startsWith('combat-block-add-') && option.targets[0]?.oid === setupBlockerOid,
            );
            move = block?.id;
            if (move === undefined) throw new Error('Forge offered no setup block');
            setupAttackInFlight = false;
          } else {
            const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
            if (protectedAttackInFlight && blocker !== undefined) {
              expect(
                decision.options.some(
                  (option) =>
                    option.id.startsWith('combat-block-add-') && option.targets[0]?.oid === blocker.oid,
                ),
              ).toBe(false);
              protectionObserved = true;
            }
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          }
        } else if (decision.kind === 'priority') {
          const pilot = session.view.seats[0];
          const opponent = session.view.seats[1];
          graveyardStudentOid ??=
            setupAttackerOid === null
              ? null
              : (pilot.graveyard.find((card) => card.name === 'Student of Warfare')?.oid ?? null);
          const students = pilot.battlefield.filter((card) => card.name === 'Student of Warfare');
          const plains = pilot.battlefield.filter((card) => card.name === 'Plains');
          const untappedPlains = plains.filter((card) => !card.tapped).length;
          const sword = pilot.battlefield.find((card) => card.name === 'Sword of Light and Shadow');
          const blocker = opponent.battlefield.find((card) => card.name === blockerName);
          const opponentLands = opponent.battlefield.filter((card) => card.name === land);
          const equipped = students.find((card) => card.oid === equippedOid);
          equipOutcome ||= equipped?.power === 3 && equipped.toughness === 3 && equipManaPayments === 2;
          if (equipOutcome) equipPaymentInFlight = false;
          if (equipCancellationPending) {
            expect(pilot.battlefield.map((card) => card.oid).sort()).toEqual(canceledObjects);
            expect(plains.filter((card) => card.tapped)).toHaveLength(canceledTappedLands);
            expect(session.view.stack).toEqual([]);
            equipCanceled = true;
            equipCancellationPending = false;
          }
          if (protectedAttackInFlight && session.view.turn.step === 'COMBAT_END') protectionObserved = true;
          triggerOutcome ||=
            optionalTargetObserved &&
            pilotLifeBeforeTrigger !== null &&
            pilot.life === pilotLifeBeforeTrigger + 3 &&
            opponentLifeBeforeAttack !== null &&
            opponent.life === opponentLifeBeforeAttack - 3 &&
            (branch === 'return'
              ? graveyardStudentOid !== null &&
                pilot.hand?.some((card) => card.oid === graveyardStudentOid) === true &&
                !pilot.graveyard.some((card) => card.oid === graveyardStudentOid) &&
                handBeforeReturn !== null &&
                pilot.handSize === handBeforeReturn + 1
              : graveyardStudentOid !== null &&
                pilot.graveyard.some((card) => card.oid === graveyardStudentOid));

          const equip = decision.options.find(
            (option) => option.text.startsWith('Sword of Light and Shadow:') && option.text.includes('Equip'),
          );
          move =
            decision.options.find((option) => option.text === `Play ${decision.seat === 0 ? 'Plains' : land}`)
              ?.id ??
            (decision.seat === 1 && blocker === undefined && opponentLands.some((card) => !card.tapped)
              ? castOption(session, blockerName)
              : undefined) ??
            (decision.seat === 0 &&
            graveyardStudentOid === null &&
            students.length === 0 &&
            untappedPlains >= 1
              ? castOption(session, 'Student of Warfare')
              : undefined) ??
            (decision.seat === 0 &&
            graveyardStudentOid !== null &&
            students.length === 0 &&
            untappedPlains >= 1
              ? castOption(session, 'Student of Warfare')
              : undefined) ??
            (decision.seat === 0 &&
            graveyardStudentOid !== null &&
            students.length > 0 &&
            sword === undefined &&
            untappedPlains >= 3
              ? castOption(session, 'Sword of Light and Shadow')
              : undefined) ??
            (decision.seat === 0 && sword !== undefined && equippedOid === null && untappedPlains >= 2
              ? equip?.id
              : undefined) ??
            (triggerOutcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === equip?.id) pendingEquip = true;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Light and Shadow move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      const evidence = `${trace.slice(-420).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(equipCanceled, evidence).toBe(true);
      expect(equipOutcome, evidence).toBe(true);
      expect(protectionObserved, evidence).toBe(true);
      expect(optionalTargetObserved, evidence).toBe(true);
      expect(triggerOutcome, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  300_000,
);
