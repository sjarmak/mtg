/** Installed-Forge proof for Sword of Body and Mind's exact attachment and combat trigger. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(color: 'green' | 'blue'): SessionSpec {
  const land = color === 'green' ? 'Forest' : 'Island';
  const blocker = color === 'green' ? 'Llanowar Elves' : 'Pteramander';
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Body and Mind pilot',
        controller: 'local',
        deck: {
          name: `z5q4-body-mind-${color}`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Student of Warfare', count: 15 },
            { name: 'Sword of Body and Mind', count: 15 },
          ],
        },
      },
      {
        name: `${color} blocker pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-body-mind-${color}-blocker`,
          cards: [
            { name: land, count: 30 },
            { name: blocker, count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-sword-of-body-and-mind-${color}-outcomes`,
    maximumTurns: 40,
  };
}

function castOption(session: ObservedSession, name: string): string | undefined {
  return session.decision?.options.find(
    (option) =>
      option.text.startsWith(`${name}:`) &&
      !option.text.includes('Equip') &&
      !option.text.includes('Level up'),
  )?.id;
}

forgeIt.each([
  ['green', 'Forest', 'Llanowar Elves'],
  ['blue', 'Island', 'Pteramander'],
] as const)(
  'cancels, re-equips, preserves %s protection, creates one Wolf, and mills ten',
  async (color, land, blockerName) => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let studentOids: readonly [string, string] | null = null;
    let pendingEquip = false;
    let equipCanceled = false;
    let cancellationPending = false;
    let canceledObjects: readonly string[] = [];
    let canceledTappedLands = 0;
    let equipTargetIndex: 0 | 1 = 0;
    let equippedOid: string | null = null;
    let equipPayments = 0;
    let paymentInFlight = false;
    let firstEquipOutcome = false;
    let reassignmentOutcome = false;
    let attackInFlight = false;
    let protectionObserved = false;
    let opponentLifeBeforeAttack: number | null = null;
    let opponentLibraryBeforeTrigger: number | null = null;
    let opponentGraveyardBeforeTrigger: number | null = null;
    let wolfCountBeforeTrigger: number | null = null;
    let triggerOutcome = false;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    try {
      expect(await backend.supports(table(color))).toEqual([]);
      const opened = await backend.open(table(color));
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Body and Mind decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          if (paymentInFlight) equipPayments += 1;
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'target-selection') {
          if (!pendingEquip || studentOids === null) {
            throw new Error(`unexpected Body and Mind target decision: ${decision.prompt}`);
          }
          const targetOid = studentOids[equipTargetIndex];
          const target = decision.options.find((option) => option.targets[0]?.oid === targetOid);
          if (target === undefined) throw new Error('Forge omitted the exact Body and Mind Equip target');
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          if (!equipCanceled) {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            if (cancel === undefined) throw new Error('Forge omitted Equip cancellation');
            canceledObjects = session.view.seats[0].battlefield.map((card) => card.oid).sort();
            canceledTappedLands = session.view.seats[0].battlefield.filter(
              (card) => card.name === 'Plains' && card.tapped,
            ).length;
            cancellationPending = true;
            pendingEquip = false;
            move = cancel.id;
          } else {
            equippedOid = targetOid;
            pendingEquip = false;
            paymentInFlight = true;
            if (staleSnapshot === null) {
              staleSnapshot = session;
              staleMove = target.id;
            }
            move = target.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          const equipped = session.view.seats[0].battlefield.find((card) => card.oid === equippedOid);
          const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
          const add = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === equippedOid,
          );
          if (!attackInFlight && reassignmentOutcome && blocker !== undefined && add !== undefined) {
            expect(equipped).toMatchObject({ power: 3, toughness: 3 });
            opponentLifeBeforeAttack = session.view.seats[1].life;
            opponentLibraryBeforeTrigger = session.view.seats[1].librarySize;
            opponentGraveyardBeforeTrigger = session.view.seats[1].graveyard.length;
            wolfCountBeforeTrigger = session.view.seats[0].battlefield.filter(
              (card) => card.name === 'Wolf Token',
            ).length;
            attackInFlight = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
          if (attackInFlight && blocker !== undefined) {
            expect(blocker.tapped).toBe(false);
            expect(
              decision.options.some(
                (option) =>
                  option.id.startsWith('combat-block-add-') && option.targets[0]?.oid === blocker.oid,
              ),
            ).toBe(false);
            protectionObserved = true;
          }
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const pilot = session.view.seats[0];
          const opponent = session.view.seats[1];
          const students = pilot.battlefield.filter((card) => card.name === 'Student of Warfare');
          if (studentOids === null && students.length >= 2) {
            studentOids = [students[0]!.oid, students[1]!.oid];
          }
          const plains = pilot.battlefield.filter((card) => card.name === 'Plains');
          const untappedPlains = plains.filter((card) => !card.tapped).length;
          const sword = pilot.battlefield.find((card) => card.name === 'Sword of Body and Mind');
          const blocker = opponent.battlefield.find((card) => card.name === blockerName);
          const opponentLands = opponent.battlefield.filter((card) => card.name === land);
          if (cancellationPending) {
            expect(pilot.battlefield.map((card) => card.oid).sort()).toEqual(canceledObjects);
            expect(plains.filter((card) => card.tapped)).toHaveLength(canceledTappedLands);
            expect(session.view.stack).toEqual([]);
            equipCanceled = true;
            cancellationPending = false;
          }
          if (studentOids !== null) {
            const first = students.find((card) => card.oid === studentOids![0]);
            const second = students.find((card) => card.oid === studentOids![1]);
            const firstAttachment = first?.power === 3 && first.toughness === 3 && second?.power === 1;
            const reassignment = first?.power === 1 && second?.power === 3 && second.toughness === 3;
            firstEquipOutcome ||= firstAttachment;
            if (paymentInFlight && (firstAttachment || reassignment)) paymentInFlight = false;
            if (firstEquipOutcome && equipTargetIndex === 0 && !paymentInFlight) equipTargetIndex = 1;
            reassignmentOutcome ||= equipPayments === 4 && reassignment;
          }
          if (attackInFlight && session.view.turn.step === 'COMBAT_END') protectionObserved = true;
          const wolves = pilot.battlefield.filter(
            (card) => card.name === 'Wolf Token' && card.typeLine.includes('Creature - Wolf'),
          );
          triggerOutcome ||=
            protectionObserved &&
            opponentLifeBeforeAttack !== null &&
            opponentLibraryBeforeTrigger !== null &&
            opponentGraveyardBeforeTrigger !== null &&
            wolfCountBeforeTrigger !== null &&
            opponent.life === opponentLifeBeforeAttack - 3 &&
            opponent.librarySize === opponentLibraryBeforeTrigger - 10 &&
            opponent.graveyard.length === opponentGraveyardBeforeTrigger + 10 &&
            wolves.length === wolfCountBeforeTrigger + 1 &&
            wolves.at(-1)?.power === 2 &&
            wolves.at(-1)?.toughness === 2;

          const equip = decision.options.find(
            (option) => option.text.startsWith('Sword of Body and Mind:') && option.text.includes('Equip'),
          );
          move =
            decision.options.find((option) => option.text === `Play ${decision.seat === 0 ? 'Plains' : land}`)
              ?.id ??
            (decision.seat === 1 && blocker === undefined && opponentLands.some((card) => !card.tapped)
              ? castOption(session, blockerName)
              : undefined) ??
            (decision.seat === 0 && students.length < 2 && untappedPlains >= 1
              ? castOption(session, 'Student of Warfare')
              : undefined) ??
            (decision.seat === 0 && students.length >= 2 && sword === undefined && untappedPlains >= 3
              ? castOption(session, 'Sword of Body and Mind')
              : undefined) ??
            (decision.seat === 0 &&
            sword !== undefined &&
            studentOids !== null &&
            !reassignmentOutcome &&
            !paymentInFlight &&
            untappedPlains >= 2
              ? equip?.id
              : undefined) ??
            (triggerOutcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === equip?.id) pendingEquip = true;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Body and Mind move');
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

      const evidence = `${trace.slice(-480).join('\n')}\nstate=${JSON.stringify({ equipPayments, equippedOid, equipTargetIndex, firstEquipOutcome, reassignmentOutcome, attackInFlight, protectionObserved, opponentLifeBeforeAttack, opponentLibraryBeforeTrigger, opponentGraveyardBeforeTrigger, wolfCountBeforeTrigger, triggerOutcome })}\nview=${JSON.stringify(session.view)}`;
      expect(equipCanceled, evidence).toBe(true);
      expect(firstEquipOutcome, evidence).toBe(true);
      expect(reassignmentOutcome, evidence).toBe(true);
      expect(protectionObserved, evidence).toBe(true);
      expect(triggerOutcome, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-480).join('\n')}`, { cause });
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
