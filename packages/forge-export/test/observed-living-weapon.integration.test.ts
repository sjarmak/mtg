/** Installed-Forge outcomes for the exact Kaldra Compleat and Batterskull Living Weapon cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { textSubmission } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

interface LivingWeaponCase {
  readonly name: 'Kaldra Compleat' | 'Batterskull';
  readonly mana: number;
  readonly power: number;
  readonly toughness: number;
  readonly seed: string;
}

function tableFor(subject: LivingWeaponCase): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${subject.name} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-${subject.seed}`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Student of Warfare', count: 10 },
            { name: subject.name, count: 20 },
          ],
        },
      },
      {
        name: 'Quiet pilot',
        controller: 'local',
        deck: { name: `z5q4-${subject.seed}-quiet`, cards: [{ name: 'Plains', count: 60 }] },
      },
    ],
    seed: `z5q4-${subject.seed}-installed-forge-entry`,
    maximumTurns: 24,
  };
}

forgeIt(
  'Batterskull attacks with vigilance and lifelink, re-equips for {5}, and returns for {3}',
  async () => {
    const subject = {
      name: 'Batterskull',
      mana: 5,
      power: 4,
      toughness: 4,
      seed: 'batterskull-lifecycle',
    } as const satisfies LivingWeaponCase;
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let casting = false;
    let castPayments = 0;
    let pendingTarget: 'cancel' | 'equip' | null = null;
    let equipPayment = false;
    let equipPayments = 0;
    let bouncePayment = false;
    let bouncePayments = 0;
    let germOid: string | null = null;
    let germName: string | null = null;
    let studentOid: string | null = null;
    let attackStaged = false;
    let lifeBeforeAttack: readonly [number, number] | null = null;
    let combatOutcome = false;
    let cancelOutcome = false;
    let equipOutcome = false;
    let bounceOutcome = false;
    let inventedRejected = false;
    let staleRejected = false;
    try {
      const table = tableFor(subject);
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Batterskull decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const equipment = local.battlefield.find((card) => card.name === 'Batterskull');
        const germ = local.battlefield.find((card) => card.name.includes('Germ'));
        const student = local.battlefield.find((card) => card.name === 'Student of Warfare');
        germOid ??= germ?.oid ?? null;
        germName ??= germ?.name ?? null;
        studentOid ??= student?.oid ?? null;
        combatOutcome ||=
          lifeBeforeAttack !== null &&
          local.life === lifeBeforeAttack[0] + 4 &&
          opponent.life === lifeBeforeAttack[1] - 4 &&
          germ?.oid === germOid &&
          germ.tapped === false;
        equipOutcome ||=
          studentOid !== null &&
          student?.oid === studentOid &&
          student.power === 5 &&
          student.toughness === 5 &&
          !local.battlefield.some((card) => card.oid === germOid);
        bounceOutcome ||=
          equipOutcome &&
          equipment === undefined &&
          local.hand?.some((card) => card.name === 'Batterskull') === true &&
          student?.power === 1 &&
          student.toughness === 1;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        let staleSession: ObservedSession | null = null;
        let staleMove: string | null = null;
        if (decision.kind === 'mana-payment') {
          const source = decision.options.find((option) => option.id.startsWith('mana-source-'));
          if (source !== undefined) {
            if (casting) castPayments += 1;
            if (equipPayment) equipPayments += 1;
            if (bouncePayment) bouncePayments += 1;
            move = source.id;
          }
        } else if (decision.kind === 'target-selection') {
          if (pendingTarget === null) throw new Error(`unexpected target decision: ${decision.prompt}`);
          if (!inventedRejected) {
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (pendingTarget === 'cancel') {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            if (cancel === undefined) throw new Error('Forge offered no Batterskull Equip cancellation');
            move = cancel.id;
            pendingTarget = null;
          } else {
            const target = decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.oid === studentOid,
            );
            if (target === undefined) throw new Error('Forge offered no exact Batterskull Equip target');
            move = target.id;
            staleSession = session;
            staleMove = target.id;
            pendingTarget = null;
          }
        } else if (decision.kind === 'combat-attackers') {
          const add = decision.options.find(
            (option) =>
              !attackStaged &&
              germOid !== null &&
              option.id.startsWith('combat-attack-add-') &&
              option.targets[0]?.oid === germOid,
          );
          if (add !== undefined) {
            attackStaged = true;
            lifeBeforeAttack = [local.life, opponent.life];
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const plains = local.battlefield.filter((card) => card.name === 'Plains');
          const untappedPlains = plains.filter((card) => !card.tapped).length;
          const castStudent = decision.options.find((option) =>
            option.text.startsWith('Student of Warfare:'),
          );
          const castBatterskull = decision.options.find((option) => option.text.startsWith('Batterskull:'));
          const equip = decision.options.find(
            (option) => option.text.startsWith('Batterskull:') && option.text.includes('Equip'),
          );
          const bounce = decision.options.find(
            (option) => option.text.startsWith('Batterskull:') && option.text.includes('Return'),
          );
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (decision.seat === 0 && student === undefined && untappedPlains >= 1
              ? castStudent?.id
              : undefined) ??
            (decision.seat === 0 && equipment === undefined && !bounceOutcome && untappedPlains >= 5
              ? castBatterskull?.id
              : undefined) ??
            (decision.seat === 0 && combatOutcome && !cancelOutcome && untappedPlains >= 5
              ? equip?.id
              : undefined) ??
            (decision.seat === 0 && cancelOutcome && !equipOutcome && untappedPlains >= 5
              ? equip?.id
              : undefined) ??
            (decision.seat === 0 && equipOutcome && !bounceOutcome && untappedPlains >= 3
              ? bounce?.id
              : undefined) ??
            (bounceOutcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === castBatterskull?.id && equipment === undefined) casting = true;
          if (move === equip?.id) {
            if (!cancelOutcome) pendingTarget = 'cancel';
            else {
              pendingTarget = 'equip';
              equipPayment = true;
            }
          }
          if (move === bounce?.id) bouncePayment = true;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Batterskull move');
        const previousGerm = session.view.seats[0].battlefield.find((card) => card.oid === germOid);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (move === 'target-cancel') {
          const currentGerm = session.view.seats[0].battlefield.find((card) => card.oid === germOid);
          cancelOutcome =
            previousGerm?.power === 4 &&
            previousGerm.toughness === 4 &&
            currentGerm?.power === 4 &&
            currentGerm.toughness === 4 &&
            equipPayments === 0;
        }
        if (casting && session.view.seats[0].battlefield.some((card) => card.name === 'Batterskull')) {
          casting = false;
        }
        if (equipPayment && equipPayments === 5) equipPayment = false;
        if (bouncePayment && bouncePayments === 3) bouncePayment = false;
        if (staleSession !== null && staleMove !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
      }

      const evidence = `${trace.slice(-500).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(germOid, evidence).toMatch(/^forge-card-/u);
      expect(germName, evidence).toBe('Phyrexian Germ Token');
      expect(studentOid, evidence).toMatch(/^forge-card-/u);
      expect(castPayments, evidence).toBe(5);
      expect(combatOutcome, evidence).toBe(true);
      expect(cancelOutcome, evidence).toBe(true);
      expect(equipPayments, evidence).toBe(5);
      expect(equipOutcome, evidence).toBe(true);
      expect(bouncePayments, evidence).toBe(3);
      expect(bounceOutcome, evidence).toBe(true);
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
  360_000,
);

forgeIt(
  'Kaldra Compleat attacks immediately, tramples in first strike, exiles, re-equips for {7}, and grants indestructible',
  async () => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Kaldra pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-kaldra-compleat-full-lifecycle',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Student of Warfare', count: 10 },
              { name: 'Kaldra Compleat', count: 20 },
            ],
          },
        },
        {
          name: 'Kaldra blockers',
          controller: 'local',
          deck: {
            name: 'z5q4-kaldra-compleat-blockers',
            cards: [
              { name: 'Plains', count: 15 },
              { name: 'Swamp', count: 10 },
              { name: 'Student of Warfare', count: 10 },
              { name: 'Wurmcoil Engine', count: 15 },
              { name: 'Damnation', count: 10 },
            ],
          },
        },
      ],
      seed: 'z5q4-kaldra-compleat-installed-forge-full-outcomes',
      maximumTurns: 32,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let casting = false;
    let castPayments = 0;
    let pendingTarget: 'cancel' | 'equip' | null = null;
    let equipPayment = false;
    let equipPayments = 0;
    let germOid: string | null = null;
    let germName: string | null = null;
    let localStudentOid: string | null = null;
    let kaldraCastTurn: number | null = null;
    let attacksStaged = 0;
    let assignedFirstBlocker = false;
    let firstAttackLife: number | null = null;
    let firstStrikeStep: string | null = null;
    let hasteOutcome = false;
    let trampleOutcome = false;
    let exileOutcome = false;
    let exileStep: string | null = null;
    let cancelOutcome = false;
    let equipOutcome = false;
    let damnationCast = false;
    let indestructibleOutcome = false;
    let inventedRejected = false;
    let staleRejected = false;
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Kaldra Compleat decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const equipment = local.battlefield.find((card) => card.name === 'Kaldra Compleat');
        const germ = local.battlefield.find((card) => card.name.includes('Germ'));
        const localStudent = local.battlefield.find((card) => card.name === 'Student of Warfare');
        const opposingStudent = opponent.battlefield.find((card) => card.name === 'Student of Warfare');
        const wurmcoil = opponent.battlefield.find((card) => card.name === 'Wurmcoil Engine');
        germOid ??= germ?.oid ?? null;
        germName ??= germ?.name ?? null;
        localStudentOid ??= localStudent?.oid ?? null;
        if (
          firstAttackLife !== null &&
          attacksStaged >= 1 &&
          opposingStudent === undefined &&
          opponent.life === firstAttackLife - 4
        ) {
          trampleOutcome = true;
        }
        if (opponent.exile.some((card) => card.name === 'Wurmcoil Engine')) {
          exileOutcome = true;
          exileStep ??= session.view.turn.step;
        }
        equipOutcome ||=
          localStudentOid !== null &&
          localStudent?.oid === localStudentOid &&
          localStudent.power === 6 &&
          localStudent.toughness === 6 &&
          !local.battlefield.some((card) => card.oid === germOid);
        indestructibleOutcome ||=
          damnationCast &&
          equipOutcome &&
          equipment !== undefined &&
          localStudent?.oid === localStudentOid &&
          localStudent.power === 6 &&
          localStudent.toughness === 6 &&
          opponent.battlefield.every((card) => card.typeLine.includes('Land'));
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        let staleSession: ObservedSession | null = null;
        let staleMove: string | null = null;
        if (decision.kind === 'mana-payment') {
          const source = decision.options.find((option) => option.id.startsWith('mana-source-'));
          if (source !== undefined) {
            if (casting) castPayments += 1;
            if (equipPayment) equipPayments += 1;
            move = source.id;
          }
        } else if (decision.kind === 'target-selection') {
          if (pendingTarget === null) throw new Error(`unexpected target decision: ${decision.prompt}`);
          if (!inventedRejected) {
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (pendingTarget === 'cancel') {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            if (cancel === undefined) throw new Error('Forge offered no Kaldra Equip cancellation');
            move = cancel.id;
            pendingTarget = null;
          } else {
            const target = decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.oid === localStudentOid,
            );
            if (target === undefined) throw new Error('Forge offered no exact Kaldra Equip target');
            move = target.id;
            staleSession = session;
            staleMove = target.id;
            pendingTarget = null;
          }
        } else if (decision.kind === 'combat-attackers') {
          const canStage =
            decision.seat === 0 &&
            germOid !== null &&
            attacksStaged < 2 &&
            (attacksStaged === 0 ? opposingStudent !== undefined : wurmcoil !== undefined);
          const add = decision.options.find(
            (option) =>
              canStage && option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === germOid,
          );
          if (add !== undefined) {
            attacksStaged += 1;
            if (attacksStaged === 1) {
              firstAttackLife = opponent.life;
              hasteOutcome = kaldraCastTurn === session.view.turn.number;
            }
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          const wanted = attacksStaged === 1 ? opposingStudent : attacksStaged === 2 ? wurmcoil : undefined;
          const block = decision.options.find(
            (option) =>
              wanted !== undefined &&
              germOid !== null &&
              option.id.startsWith('combat-block-add-') &&
              option.targets[0]?.oid === wanted.oid &&
              option.targets[1]?.oid === germOid,
          );
          move = block?.id ?? decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'combat-damage') {
          const input = decision.input;
          const suggestion = input?.suggestions?.[0];
          if (input?.kind !== 'text' || suggestion === undefined) {
            throw new Error('combat damage did not expose a complete split');
          }
          const document = JSON.parse(suggestion) as {
            readonly recipients: readonly { readonly name: string }[];
            readonly amounts: readonly number[];
          };
          const blockerName = attacksStaged === 1 ? 'Student of Warfare' : 'Wurmcoil Engine';
          assignedFirstBlocker ||= document.recipients.some(
            (recipient, index) => recipient.name === blockerName && (document.amounts[index] ?? 0) > 0,
          );
          if (attacksStaged === 1) firstStrikeStep = session.view.turn.step;
          move = textSubmission(input, suggestion);
        } else if (decision.kind === 'priority') {
          const localPlains = local.battlefield.filter((card) => card.name === 'Plains');
          const opponentPlains = opponent.battlefield.filter((card) => card.name === 'Plains');
          const opponentSwamps = opponent.battlefield.filter((card) => card.name === 'Swamp');
          const localUntapped = localPlains.filter((card) => !card.tapped).length;
          const opponentUntapped =
            opponentPlains.filter((card) => !card.tapped).length +
            opponentSwamps.filter((card) => !card.tapped).length;
          const castLocalStudent = decision.options.find((option) =>
            option.text.startsWith('Student of Warfare:'),
          );
          const castKaldra = decision.options.find((option) => option.text.startsWith('Kaldra Compleat:'));
          const castOpposingStudent = decision.options.find((option) =>
            option.text.startsWith('Student of Warfare:'),
          );
          const castWurmcoil = decision.options.find((option) => option.text.startsWith('Wurmcoil Engine:'));
          const castDamnation = decision.options.find((option) => option.text.startsWith('Damnation:'));
          const equip = decision.options.find(
            (option) => option.text.startsWith('Kaldra Compleat:') && option.text.includes('Equip'),
          );
          move =
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Plains')?.id
              : (decision.options.find((option) => option.text === 'Play Swamp')?.id ??
                decision.options.find((option) => option.text === 'Play Plains')?.id)) ??
            (decision.seat === 0 && localStudent === undefined && localUntapped >= 1
              ? castLocalStudent?.id
              : undefined) ??
            (decision.seat === 1 && opposingStudent === undefined && !trampleOutcome && opponentUntapped >= 1
              ? castOpposingStudent?.id
              : undefined) ??
            (decision.seat === 1 && wurmcoil === undefined && !exileOutcome && opponentUntapped >= 6
              ? castWurmcoil?.id
              : undefined) ??
            (decision.seat === 0 && equipment === undefined && localUntapped >= 7
              ? castKaldra?.id
              : undefined) ??
            (decision.seat === 0 && exileOutcome && !cancelOutcome && localUntapped >= 7
              ? equip?.id
              : undefined) ??
            (decision.seat === 0 && cancelOutcome && !equipOutcome && localUntapped >= 7
              ? equip?.id
              : undefined) ??
            (decision.seat === 1 && equipOutcome && !damnationCast && opponentUntapped >= 4
              ? castDamnation?.id
              : undefined) ??
            (indestructibleOutcome
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === castKaldra?.id && equipment === undefined) {
            casting = true;
            kaldraCastTurn = session.view.turn.number;
          }
          if (move === equip?.id) {
            if (!cancelOutcome) pendingTarget = 'cancel';
            else {
              pendingTarget = 'equip';
              equipPayment = true;
            }
          }
          if (move === castDamnation?.id) damnationCast = true;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Kaldra Compleat move');
        const previousGerm = session.view.seats[0].battlefield.find((card) => card.oid === germOid);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (move === 'target-cancel') {
          const currentGerm = session.view.seats[0].battlefield.find((card) => card.oid === germOid);
          cancelOutcome =
            previousGerm?.power === 5 &&
            previousGerm.toughness === 5 &&
            currentGerm?.power === 5 &&
            currentGerm.toughness === 5 &&
            equipPayments === 0;
        }
        if (casting && session.view.seats[0].battlefield.some((card) => card.name === 'Kaldra Compleat')) {
          casting = false;
        }
        if (equipPayment && equipPayments === 7) equipPayment = false;
        if (staleSession !== null && staleMove !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
      }

      const evidence = `${trace.slice(-700).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(germOid, evidence).toMatch(/^forge-card-/u);
      expect(germName, evidence).toBe('Phyrexian Germ Token');
      expect(localStudentOid, evidence).toMatch(/^forge-card-/u);
      expect(castPayments, evidence).toBe(7);
      expect(hasteOutcome, evidence).toBe(true);
      expect(firstStrikeStep, evidence).toContain('FIRST_STRIKE');
      expect(assignedFirstBlocker, evidence).toBe(true);
      expect(trampleOutcome, evidence).toBe(true);
      expect(exileOutcome, evidence).toBe(true);
      expect(exileStep, evidence).toContain('FIRST_STRIKE');
      expect(cancelOutcome, evidence).toBe(true);
      expect(equipPayments, evidence).toBe(7);
      expect(equipOutcome, evidence).toBe(true);
      expect(damnationCast, evidence).toBe(true);
      expect(indestructibleOutcome, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-700).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  420_000,
);
