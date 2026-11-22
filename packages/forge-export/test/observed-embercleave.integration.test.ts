/** Installed-Forge proof for Embercleave's exact combat discount and attachment lifecycle. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { textSubmission } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Embercleave pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-embercleave-exact-combat-and-equip',
        cards: [
          { name: 'Mountain', count: 32 },
          { name: 'Goblin Guide', count: 14 },
          { name: 'Embercleave', count: 14 },
        ],
      },
    },
    {
      name: 'Blocking pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-embercleave-blocking-pilot',
        cards: [
          { name: 'Plains', count: 36 },
          { name: 'Student of Warfare', count: 24 },
        ],
      },
    },
  ],
  seed: 'z5q4-embercleave-exact-installed-forge-outcomes',
  maximumTurns: 24,
};

function castOption(session: ObservedSession, name: string): string | undefined {
  // A permanent's activated abilities (e.g. Embercleave's own "Equip {3}")
  // are also labeled "<name>: ...", so a bare prefix match can return an
  // equip/activation option instead of the spell-cast option once the
  // permanent is already on the battlefield. The cast option's own text
  // always repeats the name ("Embercleave: Embercleave", "Goblin Guide:
  // Goblin Guide - Creature 2 / 2"), which no activated ability's text does.
  return session.decision?.options.find((option) => option.text.startsWith(`${name}: ${name}`))?.id;
}

forgeIt(
  'casts for four during combat with two attackers, tramples twice, cancels, and pays {3} to re-equip',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    const selectedAttackers = new Set<string>();
    let attackCommitted = false;
    let pendingTarget: 'etb' | 'equip-cancel' | 'equip' | null = null;
    let emberPaymentInFlight = false;
    let equipPaymentInFlight = false;
    let emberManaPayments = 0;
    let equipManaPayments = 0;
    let firstTarget: string | null = null;
    let secondTarget: string | null = null;
    let opponentLifeBeforeAttack: number | null = null;
    let entryOutcome = false;
    let blockedEquippedAttacker = false;
    let firstStrikeDamageAssignedToBlocker = false;
    let deferredDamage = false;
    const damageSteps = new Set<string>();
    let combatOutcome = false;
    let cancelOutcome = false;
    let equipOutcome = false;
    let inventedRejected = false;
    let staleRejected = false;
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Embercleave decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const guides = pilot.battlefield.filter((card) => card.name === 'Goblin Guide');
        const mountains = pilot.battlefield.filter((card) => card.name === 'Mountain');
        const students = opponent.battlefield.filter((card) => card.name === 'Student of Warfare');
        const plains = opponent.battlefield.filter((card) => card.name === 'Plains');
        const embercleave = pilot.battlefield.find((card) => card.name === 'Embercleave');
        const first = guides.find((card) => card.oid === firstTarget);
        const second = guides.find((card) => card.oid === secondTarget);
        entryOutcome ||=
          firstTarget !== null &&
          secondTarget === null &&
          first?.power === 3 &&
          first.toughness === 3 &&
          guides.some((card) => card.oid !== firstTarget && card.power === 2 && card.toughness === 2);
        combatOutcome ||=
          blockedEquippedAttacker &&
          opponentLifeBeforeAttack !== null &&
          opponent.life === opponentLifeBeforeAttack - 7 &&
          students.length === 0;
        equipOutcome ||=
          secondTarget !== null &&
          first?.power === 2 &&
          first.toughness === 2 &&
          second?.power === 3 &&
          second.toughness === 3;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        let staleMove: string | null = null;
        const staleSession = session;

        if (decision.kind === 'mana-payment') {
          const source = decision.options.find((option) => option.id.startsWith('mana-source-'));
          if (source !== undefined) {
            if (emberPaymentInFlight) emberManaPayments += 1;
            if (equipPaymentInFlight) equipManaPayments += 1;
            move = source.id;
          }
        } else if (decision.kind === 'target-selection') {
          if (pendingTarget === null) throw new Error(`unexpected target decision: ${decision.prompt}`);
          const guideTargets = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Goblin Guide',
          );
          expect(guideTargets).toHaveLength(2);
          expect(new Set(guideTargets.map((option) => option.targets[0]!.oid)).size).toBe(2);
          if (!inventedRejected) {
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (pendingTarget === 'equip-cancel') {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            if (cancel === undefined) throw new Error('Forge offered no Embercleave Equip cancellation');
            move = cancel.id;
            pendingTarget = null;
          } else {
            const target =
              pendingTarget === 'etb'
                ? guideTargets.find((option) => selectedAttackers.has(option.targets[0]!.oid))
                : guideTargets.find((option) => option.targets[0]?.oid !== firstTarget);
            if (target === undefined) throw new Error('Forge offered no exact Embercleave target');
            if (pendingTarget === 'etb') firstTarget = target.targets[0]?.oid ?? null;
            else secondTarget = target.targets[0]?.oid ?? null;
            pendingTarget = null;
            move = target.id;
            staleMove = target.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          const shouldAttack =
            decision.seat === 0 &&
            !attackCommitted &&
            guides.length >= 2 &&
            mountains.filter((card) => !card.tapped).length === 4 &&
            pilot.hand?.some((card) => card.name === 'Embercleave') === true;
          const additions = decision.options.filter(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              option.targets[0]?.oid !== undefined &&
              !selectedAttackers.has(option.targets[0].oid),
          );
          if (shouldAttack && selectedAttackers.size < 2) {
            const add = additions[0];
            const oid = add?.targets[0]?.oid;
            if (add === undefined || oid === undefined) throw new Error('Forge offered no exact attacker');
            selectedAttackers.add(oid);
            move = add.id;
          } else {
            const commit = decision.options.find((option) => option.id === 'combat-attackers-commit');
            if (commit === undefined) throw new Error('Forge offered no attacker commit');
            if (shouldAttack && selectedAttackers.size === 2) {
              attackCommitted = true;
              opponentLifeBeforeAttack = opponent.life;
            } else if (!attackCommitted) {
              selectedAttackers.clear();
            }
            move = commit.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          const blocker = students[0];
          const block = decision.options.find(
            (option) =>
              !blockedEquippedAttacker &&
              blocker !== undefined &&
              firstTarget !== null &&
              option.id.startsWith('combat-block-add-') &&
              option.targets[0]?.oid === blocker.oid &&
              option.targets[1]?.oid === firstTarget,
          );
          if (block !== undefined) {
            blockedEquippedAttacker = true;
            move = block.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          }
        } else if (decision.kind === 'combat-damage') {
          const input = decision.input;
          const suggestion = input?.suggestions?.[0];
          if (input?.kind !== 'text' || suggestion === undefined) {
            throw new Error('combat damage did not expose a complete split');
          }
          const document = JSON.parse(suggestion) as {
            readonly canDefer: boolean;
            readonly recipients: readonly { readonly name: string }[];
            readonly amounts: readonly number[];
          };
          expect(document.recipients).toHaveLength(document.amounts.length);
          firstStrikeDamageAssignedToBlocker ||= document.recipients.some(
            (recipient, index) =>
              recipient.name === 'Student of Warfare' && (document.amounts[index] ?? 0) > 0,
          );
          damageSteps.add(session.view.turn.step);
          if (document.canDefer && !deferredDamage) {
            deferredDamage = true;
            move = textSubmission(input, JSON.stringify({ ...document, defer: true }));
          } else {
            move = textSubmission(input, suggestion);
          }
        } else if (decision.kind === 'priority') {
          const untappedMountains = mountains.filter((card) => !card.tapped).length;
          const untappedPlains = plains.filter((card) => !card.tapped).length;
          const equip = decision.options.find(
            (option) => option.text.startsWith('Embercleave:') && option.text.includes('Equip'),
          );
          const castEmbercleave = castOption(session, 'Embercleave');
          move =
            (equipOutcome && equipManaPayments === 3
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mountain')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 1 && students.length === 0 && untappedPlains >= 1
              ? castOption(session, 'Student of Warfare')
              : undefined) ??
            (decision.seat === 0 && guides.length < 2 && untappedMountains >= 1
              ? castOption(session, 'Goblin Guide')
              : undefined) ??
            (decision.seat === 0 && attackCommitted && embercleave === undefined && untappedMountains === 4
              ? castEmbercleave
              : undefined) ??
            (decision.seat === 0 && combatOutcome && !cancelOutcome && untappedMountains >= 3
              ? equip?.id
              : undefined) ??
            (decision.seat === 0 && cancelOutcome && secondTarget === null && untappedMountains >= 3
              ? equip?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === castEmbercleave) {
            expect(session.view.turn.step).not.toBe('MAIN1');
            expect(untappedMountains).toBe(4);
            emberPaymentInFlight = true;
          }
          if (move === equip?.id) {
            if (!cancelOutcome) pendingTarget = 'equip-cancel';
            else {
              pendingTarget = 'equip';
              equipPaymentInFlight = true;
            }
          }
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Embercleave move');
        const previousFirst =
          firstTarget === null ? undefined : pilot.battlefield.find((card) => card.oid === firstTarget);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (move === 'target-cancel') {
          const stillFirst =
            firstTarget === null
              ? undefined
              : session.view.seats[0].battlefield.find((card) => card.oid === firstTarget);
          cancelOutcome =
            previousFirst?.power === 3 &&
            previousFirst.toughness === 3 &&
            stillFirst?.power === 3 &&
            stillFirst.toughness === 3 &&
            equipManaPayments === 0;
        }
        if (
          emberPaymentInFlight &&
          session.view.seats[0].battlefield.some((card) => card.name === 'Embercleave')
        ) {
          emberPaymentInFlight = false;
          pendingTarget = 'etb';
        }
        if (equipPaymentInFlight && equipManaPayments === 3) equipPaymentInFlight = false;
        if (staleMove !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
      }

      const evidence = `${trace.slice(-500).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(firstTarget, evidence).toMatch(/^forge-card-/u);
      expect(secondTarget, evidence).toMatch(/^forge-card-/u);
      expect(emberManaPayments, evidence).toBe(4);
      expect(equipManaPayments, evidence).toBe(3);
      expect(entryOutcome, evidence).toBe(true);
      expect(blockedEquippedAttacker, evidence).toBe(true);
      expect(firstStrikeDamageAssignedToBlocker, evidence).toBe(true);
      expect(deferredDamage, evidence).toBe(true);
      expect(
        [...damageSteps].some((step) => step.includes('FIRST_STRIKE')),
        evidence,
      ).toBe(true);
      expect(combatOutcome, evidence).toBe(true);
      expect(cancelOutcome, evidence).toBe(true);
      expect(equipOutcome, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-500).join('\n')}`, { cause });
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
