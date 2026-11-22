/** Installed-Forge proof for Sword of Hearth and Home's exact attachment, blink, and search. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(color: 'green' | 'white'): SessionSpec {
  const land = color === 'green' ? 'Forest' : 'Plains';
  const blocker = color === 'green' ? 'Llanowar Elves' : 'Student of Warfare';
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Hearth and Home pilot',
        controller: 'local',
        deck: {
          name: `z5q4-hearth-home-${color}`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Student of Warfare', count: 15 },
            { name: 'Sword of Hearth and Home', count: 15 },
          ],
        },
      },
      {
        name: `${color} blocker pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-hearth-home-${color}-blocker`,
          cards: [
            { name: land, count: 30 },
            { name: blocker, count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-sword-of-hearth-and-home-${color}-outcomes`,
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
  ['green', 'Forest', 'Llanowar Elves', 'decline'],
  ['white', 'Plains', 'Student of Warfare', 'blink'],
] as const)(
  'equips for {2}, preserves %s protection, and exercises the exact blink/search branch',
  async (color, land, blockerName, branch) => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let studentOids: readonly [string, string] | null = null;
    let pendingEquip = false;
    let equipCancellationPending = false;
    let equipCanceled = false;
    let canceledObjects: readonly string[] = [];
    let canceledTappedLands = 0;
    let equippedOid: string | null = null;
    let equipManaPayments = 0;
    let equipPaymentInFlight = false;
    let equipOutcome = false;
    let attackInFlight = false;
    let protectionObserved = false;
    let targetDecisionObserved = false;
    let searchDecisionObserved = false;
    let blinkTargetOid: string | null = null;
    let selectedBasicOid: string | null = null;
    let pilotLandsBeforeTrigger: number | null = null;
    let pilotLibraryBeforeTrigger: number | null = null;
    let pilotCreaturesBeforeTrigger: number | null = null;
    let opponentLifeBeforeAttack: number | null = null;
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
        if (decision === null) throw new Error('Forge offered no Hearth and Home decision');
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
          const pilotCreatures = session.view.seats[0].battlefield.filter((card) =>
            card.typeLine.includes('Creature'),
          );
          if (pendingEquip) {
            if (studentOids === null) throw new Error('Equip began before both Students existed');
            const target = decision.options.find((option) => option.targets[0]?.oid === studentOids?.[0]);
            if (target === undefined) throw new Error('Forge omitted the exact Hearth and Home Equip target');
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
              equipCancellationPending = true;
              pendingEquip = false;
              move = cancel.id;
            } else {
              equippedOid = studentOids[0];
              pendingEquip = false;
              equipPaymentInFlight = true;
              staleSnapshot = session;
              staleMove = target.id;
              move = target.id;
            }
          } else if (attackInFlight && !targetDecisionObserved) {
            const targetChoices = decision.options.filter((option) => option.targets.length === 1);
            expect(targetChoices).toHaveLength(2);
            expect(targetChoices.map((option) => option.targets[0]?.oid).sort()).toEqual(
              pilotCreatures.map((card) => card.oid).sort(),
            );
            expect(decision.options.some((option) => option.id === 'target-none')).toBe(true);
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            targetDecisionObserved = true;
            if (branch === 'decline') {
              move = decision.options.find((option) => option.id === 'target-none')?.id;
            } else {
              blinkTargetOid = studentOids?.[1] ?? null;
              const target = targetChoices.find((option) => option.targets[0]?.oid === blinkTargetOid);
              if (target === undefined) throw new Error('Forge omitted the exact owned blink target');
              staleSnapshot = session;
              staleMove = target.id;
              move = target.id;
            }
          } else {
            throw new Error(`unexpected Hearth and Home target decision: ${decision.prompt}`);
          }
        } else if (decision.kind === 'zone-card-selection') {
          if (!targetDecisionObserved || searchDecisionObserved) {
            throw new Error(`unexpected Hearth and Home library decision: ${decision.prompt}`);
          }
          const cards = decision.options.filter((option) => option.targets.length === 1);
          expect(cards.length).toBeGreaterThan(0);
          expect(cards.every((option) => option.targets[0]?.name === 'Plains')).toBe(true);
          expect(decision.options.some((option) => option.id === 'zone-decline')).toBe(true);
          await expect(session.submit('zone-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          searchDecisionObserved = true;
          if (branch === 'decline') {
            move = decision.options.find((option) => option.id === 'zone-decline')?.id;
          } else {
            const basic = cards[0];
            if (basic === undefined) throw new Error('Forge omitted the exact basic-land choice');
            selectedBasicOid = basic.targets[0]?.oid ?? null;
            staleSnapshot = session;
            staleMove = basic.id;
            move = basic.id;
          }
        } else if (decision.kind === 'confirm-action') {
          if (branch !== 'decline' || !searchDecisionObserved) {
            throw new Error(`unexpected Hearth and Home confirmation: ${decision.prompt}`);
          }
          move = decision.options.find((option) => option.id === 'confirm-action-yes')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const equipped = session.view.seats[0].battlefield.find((card) => card.oid === equippedOid);
          const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
          const add = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === equippedOid,
          );
          if (!attackInFlight && equipOutcome && blocker !== undefined && add !== undefined) {
            expect(equipped).toMatchObject({ power: 3, toughness: 3 });
            const pilot = session.view.seats[0];
            pilotLandsBeforeTrigger = pilot.battlefield.filter((card) =>
              card.typeLine.includes('Land'),
            ).length;
            pilotLibraryBeforeTrigger = pilot.librarySize;
            pilotCreaturesBeforeTrigger = pilot.battlefield.filter((card) =>
              card.typeLine.includes('Creature'),
            ).length;
            opponentLifeBeforeAttack = session.view.seats[1].life;
            attackInFlight = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
          if (attackInFlight && blocker !== undefined) {
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
          if (studentOids === null && students.length >= 2)
            studentOids = [students[0]!.oid, students[1]!.oid];
          const plains = pilot.battlefield.filter((card) => card.name === 'Plains');
          const untappedPlains = plains.filter((card) => !card.tapped).length;
          const sword = pilot.battlefield.find((card) => card.name === 'Sword of Hearth and Home');
          const blocker = opponent.battlefield.find((card) => card.name === blockerName);
          const opponentLands = opponent.battlefield.filter((card) => card.name === land);
          if (equipCancellationPending) {
            expect(pilot.battlefield.map((card) => card.oid).sort()).toEqual(canceledObjects);
            expect(plains.filter((card) => card.tapped)).toHaveLength(canceledTappedLands);
            expect(session.view.stack).toEqual([]);
            equipCanceled = true;
            equipCancellationPending = false;
          }
          const equipped = students.find((card) => card.oid === equippedOid);
          equipOutcome ||= equipped?.power === 3 && equipped.toughness === 3 && equipManaPayments === 2;
          if (equipOutcome) equipPaymentInFlight = false;
          if (attackInFlight && session.view.turn.step === 'COMBAT_END') protectionObserved = true;
          if (
            targetDecisionObserved &&
            searchDecisionObserved &&
            session.view.stack.length === 0 &&
            pilotLandsBeforeTrigger !== null &&
            pilotLibraryBeforeTrigger !== null &&
            pilotCreaturesBeforeTrigger !== null &&
            opponentLifeBeforeAttack !== null
          ) {
            const landDelta = branch === 'blink' ? 1 : 0;
            triggerOutcome =
              opponent.life === opponentLifeBeforeAttack - 3 &&
              pilot.battlefield.filter((card) => card.typeLine.includes('Land')).length ===
                pilotLandsBeforeTrigger + landDelta &&
              pilot.librarySize === pilotLibraryBeforeTrigger - landDelta &&
              students.length === pilotCreaturesBeforeTrigger &&
              (branch === 'decline' ||
                (blinkTargetOid !== null &&
                  selectedBasicOid !== null &&
                  students.some((card) => card.oid === blinkTargetOid) &&
                  plains.some((card) => card.oid === selectedBasicOid)));
          }

          const equip = decision.options.find(
            (option) => option.text.startsWith('Sword of Hearth and Home:') && option.text.includes('Equip'),
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
              ? castOption(session, 'Sword of Hearth and Home')
              : undefined) ??
            (decision.seat === 0 && sword !== undefined && equippedOid === null && untappedPlains >= 2
              ? equip?.id
              : undefined) ??
            (triggerOutcome && protectionObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === equip?.id) pendingEquip = true;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Hearth and Home move');
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

      const evidence = `${trace.slice(-480).join('\n')}\nstate=${JSON.stringify({ equipManaPayments, equippedOid, equipCanceled, equipOutcome, attackInFlight, protectionObserved, targetDecisionObserved, searchDecisionObserved, blinkTargetOid, selectedBasicOid, pilotLandsBeforeTrigger, pilotLibraryBeforeTrigger, pilotCreaturesBeforeTrigger, opponentLifeBeforeAttack, triggerOutcome })}\nview=${JSON.stringify(session.view)}`;
      expect(equipCanceled, evidence).toBe(true);
      expect(equipOutcome, evidence).toBe(true);
      expect(protectionObserved, evidence).toBe(true);
      expect(targetDecisionObserved, evidence).toBe(true);
      expect(searchDecisionObserved, evidence).toBe(true);
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
