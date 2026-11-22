/** Installed-Forge proof for Sword of Feast and Famine's exact attachment and combat trigger. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(color: 'black' | 'green'): SessionSpec {
  const land = color === 'black' ? 'Swamp' : 'Forest';
  const blocker = color === 'black' ? 'Gravecrawler' : 'Hexdrinker';
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Feast and Famine pilot',
        controller: 'local',
        deck: {
          name: `z5q4-feast-famine-${color}`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Student of Warfare', count: 15 },
            { name: 'Sword of Feast and Famine', count: 15 },
          ],
        },
      },
      {
        name: `${color} blocker pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-feast-famine-${color}-blocker`,
          cards: [
            { name: land, count: 30 },
            { name: blocker, count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-sword-of-feast-and-famine-${color}-outcomes`,
    maximumTurns: 30,
  };
}

function castOption(session: ObservedSession, name: string): string | undefined {
  return session.decision?.options.find(
    (option) => option.text.startsWith(`${name}:`) && !option.text.includes('Equip'),
  )?.id;
}

forgeIt.each([
  ['black', 'Swamp', 'Gravecrawler'],
  ['green', 'Forest', 'Hexdrinker'],
] as const)(
  'equips for {2}, preserves %s protection, discards exactly one, and untaps all lands',
  async (color, land, blockerName) => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let pendingEquip = false;
    let equippedOid: string | null = null;
    let attackerAdded = false;
    let protectionObserved = false;
    let equipOutcome = false;
    let equipPaymentObserved = false;
    let equipManaPayments = 0;
    let equipPaymentInFlight = false;
    let opponentLifeBeforeAttack: number | null = null;
    let opponentHandBeforeDiscard: number | null = null;
    let discardedOid: string | null = null;
    let tappedLandsBeforeTrigger = 0;
    let discardOutcome = false;
    let untapOutcome = false;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    try {
      expect(await backend.supports(table(color))).toEqual([]);
      const opened = await backend.open(table(color));
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Feast and Famine decision');
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
          if (!pendingEquip) throw new Error(`unexpected target decision: ${decision.prompt}`);
          const target = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Student of Warfare',
          );
          if (target === undefined) throw new Error('Forge offered no exact Feast and Famine Equip target');
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          equippedOid = target.targets[0]?.oid ?? null;
          move = target.id;
          pendingEquip = false;
          equipPaymentInFlight = true;
        } else if (decision.kind === 'hand-card-selection') {
          const choice = decision.options.find((option) => option.targets.length === 1);
          if (choice === undefined) throw new Error('Forge offered no exact mandatory discard choice');
          expect(decision.seat).toBe(1);
          const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
          protectionObserved ||=
            blocker !== undefined &&
            !blocker.tapped &&
            opponentLifeBeforeAttack !== null &&
            session.view.seats[1].life === opponentLifeBeforeAttack - 3;
          opponentHandBeforeDiscard = session.view.seats[1].handSize;
          discardedOid = choice.targets[0]?.oid ?? null;
          await expect(session.submit('discard-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          staleSnapshot = session;
          staleMove = choice.id;
          move = choice.id;
        } else if (decision.kind === 'combat-attackers') {
          const equipped = session.view.seats[0].battlefield.find((card) => card.oid === equippedOid);
          const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
          const add = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === equippedOid,
          );
          if (
            !attackerAdded &&
            equipOutcome &&
            blocker !== undefined &&
            !blocker.tapped &&
            add !== undefined
          ) {
            expect(equipped).toMatchObject({ power: 3, toughness: 3 });
            opponentLifeBeforeAttack = session.view.seats[1].life;
            tappedLandsBeforeTrigger = session.view.seats[0].battlefield.filter(
              (card) => card.name === 'Plains' && card.tapped,
            ).length;
            attackerAdded = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          const blocker = session.view.seats[1].battlefield.find((card) => card.name === blockerName);
          if (attackerAdded && blocker !== undefined) {
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
          const plains = pilot.battlefield.filter((card) => card.name === 'Plains');
          const untappedPlains = plains.filter((card) => !card.tapped).length;
          const sword = pilot.battlefield.find((card) => card.name === 'Sword of Feast and Famine');
          const blocker = opponent.battlefield.find((card) => card.name === blockerName);
          if (attackerAdded && session.view.turn.step === 'COMBAT_END') protectionObserved = true;
          const opponentLands = opponent.battlefield.filter((card) => card.name === land);
          const equipped = students.find((card) => card.oid === equippedOid);
          equipOutcome ||= equipped?.power === 3 && equipped.toughness === 3;
          equipPaymentObserved ||= equipOutcome && equipManaPayments === 2;
          if (equipOutcome) equipPaymentInFlight = false;
          discardOutcome ||=
            discardedOid !== null &&
            opponentHandBeforeDiscard !== null &&
            opponent.handSize === opponentHandBeforeDiscard - 1 &&
            opponent.graveyard.some((card) => card.oid === discardedOid);
          untapOutcome ||=
            discardOutcome &&
            tappedLandsBeforeTrigger >= 2 &&
            plains.length >= tappedLandsBeforeTrigger &&
            plains.every((card) => !card.tapped);

          const equip = decision.options.find(
            (option) => option.text.startsWith('Sword of Feast and Famine:') && option.text.includes('Equip'),
          );
          move =
            decision.options.find((option) => option.text === `Play ${decision.seat === 0 ? 'Plains' : land}`)
              ?.id ??
            (decision.seat === 1 && blocker === undefined && opponentLands.some((card) => !card.tapped)
              ? castOption(session, blockerName)
              : undefined) ??
            (decision.seat === 0 && students.length === 0 && untappedPlains >= 1
              ? castOption(session, 'Student of Warfare')
              : undefined) ??
            (decision.seat === 0 && students.length > 0 && sword === undefined && untappedPlains >= 3
              ? castOption(session, 'Sword of Feast and Famine')
              : undefined) ??
            (decision.seat === 0 && sword !== undefined && equippedOid === null && untappedPlains >= 2
              ? equip?.id
              : undefined) ??
            (discardOutcome && untapOutcome
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === equip?.id) pendingEquip = true;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Feast and Famine move');
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

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(typeof equippedOid, evidence).toBe('string');
      expect(String(equippedOid), evidence).toMatch(/^forge-card-/u);
      expect(equipOutcome, evidence).toBe(true);
      expect(equipPaymentObserved, evidence).toBe(true);
      expect(protectionObserved, evidence).toBe(true);
      expect(opponentLifeBeforeAttack, evidence).not.toBeNull();
      expect(discardOutcome, evidence).toBe(true);
      expect(untapOutcome, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-360).join('\n')}`, { cause });
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
