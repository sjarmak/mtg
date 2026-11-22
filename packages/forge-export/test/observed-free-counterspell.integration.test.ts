/** Installed-Forge outcomes for the exact Daze and Force alternate-cost routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type FreeCounterspell = 'Daze' | 'Force of Negation' | 'Force of Will';

function table(card: FreeCounterspell, seed: string, withCreature = false): SessionSpec {
  const pilotCards =
    card === 'Daze'
      ? [
          { name: 'Island', count: 30 },
          { name: 'Daze', count: 30 },
        ]
      : [
          { name: 'Island', count: 20 },
          { name: 'Force of Negation', count: 20 },
          { name: 'Force of Will', count: 20 },
        ];
  const targetCards = withCreature
    ? [
        { name: 'Mountain', count: 20 },
        { name: 'Grim Lavamancer', count: 20 },
        { name: 'Lightning Bolt', count: 20 },
      ]
    : [
        { name: 'Mountain', count: 30 },
        { name: 'Lightning Bolt', count: 30 },
      ];
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: `${card} pilot`, controller: 'local', deck: { name: `${seed}-pilot`, cards: pilotCards } },
      { name: 'Target pilot', controller: 'local', deck: { name: `${seed}-target`, cards: targetCards } },
    ],
    seed,
    maximumTurns: 18,
  };
}

function optionSourceOid(optionId: string): string {
  const match = /^ability-(\d+)-/u.exec(optionId);
  if (match?.[1] === undefined) throw new Error(`unexpected ability id ${optionId}`);
  return `forge-card-${match[1]}`;
}

function traceLine(session: ObservedSession): string {
  const decision = session.decision;
  if (decision === null) return `${session.view.turn.number}/${session.view.turn.step} finished`;
  return `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
}

async function submitOrThrow(session: ObservedSession, move: string): Promise<ObservedSession> {
  const advanced = await session.submit(move);
  if (!advanced.ok) throw new Error(advanced.error.message);
  return advanced.session;
}

async function runForceOfWill(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let boltOid: string | undefined;
  let forceOid: string | undefined;
  let exiledOid: string | undefined;
  let canceled = false;
  let unknownRejected = false;
  let staleRejected = false;
  let lifeBefore = -1;
  let handBeforeCancel: string[] = [];
  let exileBeforeCancel: string[] = [];
  let outcome = false;
  try {
    const spec = table('Force of Will', 'z5q4-force-of-will-alternate');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
      trace.push(traceLine(session));
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Force of Will decision');
      const pilot = session.view.seats[0];
      const target = session.view.seats[1];
      boltOid ??= session.view.stack.find((object) => object.name === 'Lightning Bolt')?.oid;
      if (
        forceOid !== undefined &&
        exiledOid !== undefined &&
        session.view.stack.length === 0 &&
        pilot.graveyard.some((card) => card.oid === forceOid) &&
        pilot.exile.some((card) => card.oid === exiledOid) &&
        target.graveyard.some((card) => card.oid === boltOid)
      ) {
        outcome = pilot.life === lifeBefore - 1;
      }

      let move = decision.options.find((option) => option.text === 'Play first')?.id;
      if (decision.kind === 'mulligan') {
        const names = (session.view.seats[decision.seat]!.hand ?? []).map((card) => card.name);
        const blueCards = names.filter((name) => name === 'Force of Will' || name === 'Force of Negation');
        const ready =
          decision.seat === 0
            ? names.includes('Force of Will') && blueCards.length >= 2 && names.includes('Island')
            : names.includes('Lightning Bolt') && names.includes('Mountain');
        move = decision.options.find(
          (option) => option.id === (ready ? 'pregame-keep' : 'pregame-mulligan'),
        )?.id;
      } else if (decision.kind === 'priority') {
        const castBolt =
          decision.seat === 1 &&
          boltOid === undefined &&
          target.battlefield.some((card) => card.name === 'Mountain' && !card.tapped)
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const castForce =
          decision.seat === 0 && boltOid !== undefined && !outcome
            ? decision.options.find(
                (option) =>
                  option.text.startsWith('Force of Will:') && option.text.endsWith('(alternative cost)'),
              )
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.id === 'concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Island')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          castForce?.id ??
          castBolt?.id ??
          decision.options.find((option) => option.id === 'pass')?.id;
        if (castForce !== undefined && move === castForce.id) {
          forceOid = optionSourceOid(castForce.id);
          lifeBefore = pilot.life;
          if (!canceled) {
            handBeforeCancel = (pilot.hand ?? []).map((card) => card.oid).sort();
            exileBeforeCancel = pilot.exile.map((card) => card.oid).sort();
          }
        }
      } else if (decision.kind === 'target-selection') {
        move = decision.options.find((option) =>
          decision.seat === 0 ? option.targets[0]?.oid === boltOid : option.id === 'target-player-0',
        )?.id;
      } else if (decision.kind === 'cost-card-selection') {
        const cancel = decision.options.find((option) => option.id === 'cost-exile-cancel');
        const candidates = decision.options.filter(
          (option) => option.id.startsWith('cost-exile-') && option.id !== 'cost-exile-cancel',
        );
        const expected = (pilot.hand ?? [])
          .filter(
            (card) =>
              card.oid !== forceOid && (card.name === 'Force of Will' || card.name === 'Force of Negation'),
          )
          .map((card) => `cost-exile-${card.oid.replace('forge-card-', '')}`)
          .sort();
        expect(candidates.map((option) => option.id).sort(), trace.slice(-80).join('\n')).toEqual(expected);
        expect(cancel, trace.slice(-80).join('\n')).toBeDefined();
        if (!unknownRejected) {
          await expect(session.submit('cost-exile-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          unknownRejected = true;
        }
        if (!canceled) {
          session = await submitOrThrow(session, cancel!.id);
          expect(session.view.seats[0].life).toBe(lifeBefore);
          expect((session.view.seats[0]!.hand ?? []).map((card) => card.oid).sort()).toEqual(
            handBeforeCancel,
          );
          expect(session.view.seats[0].exile.map((card) => card.oid).sort()).toEqual(exileBeforeCancel);
          expect(session.view.stack.map((object) => object.oid)).toEqual([boltOid]);
          canceled = true;
          continue;
        }
        const selected = candidates[0];
        if (selected === undefined) throw new Error('Forge offered no blue exile candidate');
        exiledOid = `forge-card-${selected.id.replace('cost-exile-', '')}`;
        const stale = session;
        session = await submitOrThrow(session, selected.id);
        await expect(stale.submit(selected.id)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
        continue;
      } else if (decision.kind === 'mana-payment') {
        move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
      } else if (decision.kind === 'combat-attackers') {
        move = 'combat-attackers-commit';
      } else if (decision.kind === 'combat-blockers') {
        move = 'combat-blockers-commit';
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Force of Will move');
      session = await submitOrThrow(session, move);
    }
    const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(canceled, evidence).toBe(true);
    expect(unknownRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(outcome, evidence).toBe(true);
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-260).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

forgeIt(
  'pays Force of Will with one life and the exact other blue card, with rollback',
  async () => {
    await runForceOfWill();
  },
  200_000,
);

async function runForceOfNegation(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let creatureCast = false;
  let creatureRejected = false;
  let offTurnOffered = false;
  let setupBoltOid: string | undefined;
  let ownTurnBoltOid: string | undefined;
  let ownTurnRejected = false;
  let counteredBoltOid: string | undefined;
  let forceOid: string | undefined;
  let exiledOid: string | undefined;
  let outcome = false;
  try {
    const spec = table('Force of Negation', 'z5q4-force-of-negation-alternate', true);
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
      trace.push(traceLine(session));
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Force of Negation decision');
      const pilot = session.view.seats[0];
      const target = session.view.seats[1];
      const turn = session.view.turn;
      const stackedCreature = session.view.stack.find((card) => card.name === 'Grim Lavamancer');
      const stackedBolt = session.view.stack.find((card) => card.name === 'Lightning Bolt');
      if (turn.number === 4 && stackedBolt !== undefined) setupBoltOid ??= stackedBolt.oid;
      if (turn.number >= 5 && turn.active === 0 && stackedBolt !== undefined) {
        ownTurnBoltOid ??= stackedBolt.oid;
      }
      if (turn.number >= 6 && turn.active === 1 && stackedBolt !== undefined) {
        counteredBoltOid ??= stackedBolt.oid;
      }
      if (
        forceOid !== undefined &&
        exiledOid !== undefined &&
        counteredBoltOid !== undefined &&
        session.view.stack.length === 0 &&
        pilot.graveyard.some((card) => card.oid === forceOid) &&
        pilot.exile.some((card) => card.oid === exiledOid) &&
        target.exile.some((card) => card.oid === counteredBoltOid)
      ) {
        outcome =
          creatureRejected &&
          offTurnOffered &&
          ownTurnRejected &&
          target.battlefield.some((card) => card.name === 'Grim Lavamancer') &&
          target.graveyard.some((card) => card.oid === setupBoltOid) &&
          target.graveyard.some((card) => card.oid === ownTurnBoltOid) &&
          pilot.life === 14;
      }

      let move =
        decision.kind === 'starting-player'
          ? decision.options.find((option) => option.text === 'Let Force of Negation pilot play first')?.id
          : undefined;
      if (decision.kind === 'mulligan') {
        const names = (session.view.seats[decision.seat]!.hand ?? []).map((card) => card.name);
        const ready =
          decision.seat === 0
            ? names.includes('Force of Negation') &&
              names.filter((name) => name === 'Force of Negation' || name === 'Force of Will').length >= 2 &&
              names.includes('Island')
            : names.includes('Grim Lavamancer') &&
              names.filter((name) => name === 'Lightning Bolt').length >= 2 &&
              names.filter((name) => name === 'Mountain').length >= 2;
        move = decision.options.find(
          (option) => option.id === (ready ? 'pregame-keep' : 'pregame-mulligan'),
        )?.id;
      } else if (decision.kind === 'priority') {
        const alternate = decision.options.find(
          (option) =>
            option.text.startsWith('Force of Negation:') && option.text.endsWith('(alternative cost)'),
        );
        if (decision.seat === 0 && stackedCreature !== undefined) {
          expect(alternate, trace.slice(-80).join('\n')).toBeUndefined();
          creatureRejected = true;
        }
        if (decision.seat === 0 && turn.number === 4 && stackedBolt !== undefined) {
          expect(alternate, trace.slice(-80).join('\n')).toBeDefined();
          offTurnOffered = true;
        }
        if (decision.seat === 0 && turn.active === 0 && stackedBolt !== undefined) {
          expect(alternate, trace.slice(-80).join('\n')).toBeUndefined();
          ownTurnRejected = true;
        }
        const castCreature =
          decision.seat === 1 &&
          turn.number === 2 &&
          turn.step === 'MAIN1' &&
          !creatureCast &&
          target.battlefield.some((card) => card.name === 'Mountain' && !card.tapped)
            ? decision.options.find((option) => option.text.startsWith('Grim Lavamancer:'))
            : undefined;
        const castOwnTurnBolt =
          decision.seat === 1 &&
          turn.number >= 5 &&
          turn.active === 0 &&
          turn.step === 'MAIN1' &&
          ownTurnBoltOid === undefined &&
          offTurnOffered &&
          target.battlefield.some((card) => card.name === 'Mountain' && !card.tapped)
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const castSetupBolt =
          decision.seat === 1 &&
          turn.number === 4 &&
          turn.active === 1 &&
          turn.step === 'MAIN1' &&
          setupBoltOid === undefined &&
          creatureRejected &&
          target.battlefield.some((card) => card.name === 'Mountain' && !card.tapped)
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const castOpponentTurnBolt =
          decision.seat === 1 &&
          turn.number >= 6 &&
          turn.active === 1 &&
          turn.step === 'MAIN1' &&
          ownTurnRejected &&
          counteredBoltOid === undefined &&
          target.battlefield.some((card) => card.name === 'Mountain' && !card.tapped)
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const castForce =
          decision.seat === 0 && counteredBoltOid !== undefined && forceOid === undefined
            ? alternate
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.id === 'concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Island')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          castCreature?.id ??
          castSetupBolt?.id ??
          castOwnTurnBolt?.id ??
          castOpponentTurnBolt?.id ??
          castForce?.id ??
          decision.options.find((option) => option.id === 'pass')?.id;
        if (castCreature !== undefined && move === castCreature.id) creatureCast = true;
        if (castForce !== undefined && move === castForce.id) forceOid = optionSourceOid(castForce.id);
      } else if (decision.kind === 'target-selection') {
        move = decision.options.find((option) =>
          decision.seat === 0 ? option.targets[0]?.oid === counteredBoltOid : option.id === 'target-player-0',
        )?.id;
      } else if (decision.kind === 'cost-card-selection') {
        const candidates = decision.options.filter(
          (option) => option.id.startsWith('cost-exile-') && option.id !== 'cost-exile-cancel',
        );
        const expected = (pilot.hand ?? [])
          .filter(
            (card) =>
              card.oid !== forceOid && (card.name === 'Force of Negation' || card.name === 'Force of Will'),
          )
          .map((card) => `cost-exile-${card.oid.replace('forge-card-', '')}`)
          .sort();
        expect(candidates.map((option) => option.id).sort(), trace.slice(-100).join('\n')).toEqual(expected);
        expect(decision.options.some((option) => option.id === 'cost-exile-cancel')).toBe(true);
        const selected = candidates[0];
        if (selected === undefined) throw new Error('Forge offered no Force of Negation exile candidate');
        exiledOid = `forge-card-${selected.id.replace('cost-exile-', '')}`;
        move = selected.id;
      } else if (decision.kind === 'mana-payment') {
        move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
      } else if (decision.kind === 'combat-attackers') {
        move = 'combat-attackers-commit';
      } else if (decision.kind === 'combat-blockers') {
        move = 'combat-blockers-commit';
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Force of Negation move');
      session = await submitOrThrow(session, move);
    }
    const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(creatureRejected, evidence).toBe(true);
    expect(ownTurnRejected, evidence).toBe(true);
    expect(outcome, evidence).toBe(true);
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-340).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

forgeIt(
  'offers Force of Negation only off-turn for noncreature spells and exiles its target',
  async () => {
    await runForceOfNegation();
  },
  200_000,
);

async function runDaze(route: 'decline' | 'pay'): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let boltOid: string | undefined;
  let dazeOid: string | undefined;
  let returnedOid: string | undefined;
  let lifeBefore = -1;
  let canceled = route === 'pay';
  let unknownRejected = route === 'pay';
  let staleRejected = route === 'pay';
  let taxAnswered = false;
  let outcome = false;
  let handBeforeCancel: string[] = [];
  let battlefieldBeforeCancel: string[] = [];
  try {
    const spec = table('Daze', `z5q4-daze-alternate-${route}`);
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
      trace.push(traceLine(session));
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Daze decision');
      const pilot = session.view.seats[0];
      const target = session.view.seats[1];
      boltOid ??= session.view.stack.find((object) => object.name === 'Lightning Bolt')?.oid;
      if (
        dazeOid !== undefined &&
        returnedOid !== undefined &&
        taxAnswered &&
        session.view.stack.length === 0 &&
        pilot.graveyard.some((card) => card.oid === dazeOid) &&
        (pilot.hand ?? []).some((card) => card.oid === returnedOid) &&
        target.graveyard.some((card) => card.oid === boltOid)
      ) {
        outcome = pilot.life === lifeBefore - (route === 'pay' ? 3 : 0);
      }

      let move =
        decision.kind === 'starting-player'
          ? decision.options.find((option) =>
              decision.seat === 0
                ? option.text === 'Play first'
                : option.text === 'Let Daze pilot play first',
            )?.id
          : undefined;
      if (decision.kind === 'mulligan') {
        const names = (session.view.seats[decision.seat]!.hand ?? []).map((card) => card.name);
        const ready =
          decision.seat === 0
            ? names.includes('Daze') && names.includes('Island')
            : names.includes('Lightning Bolt') && names.includes('Mountain');
        move = decision.options.find(
          (option) => option.id === (ready ? 'pregame-keep' : 'pregame-mulligan'),
        )?.id;
      } else if (decision.kind === 'priority') {
        const mountains = target.battlefield.filter(
          (card) => card.name === 'Mountain' && !card.tapped,
        ).length;
        const castBolt =
          decision.seat === 1 && boltOid === undefined && mountains >= (route === 'pay' ? 2 : 1)
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const castDaze =
          decision.seat === 0 && boltOid !== undefined && returnedOid === undefined && !outcome
            ? decision.options.find(
                (option) => option.text.startsWith('Daze:') && option.text.endsWith('(alternative cost)'),
              )
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.id === 'concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Island')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          castDaze?.id ??
          castBolt?.id ??
          decision.options.find((option) => option.id === 'pass')?.id;
        if (castBolt !== undefined && move === castBolt.id) lifeBefore = pilot.life;
        if (castDaze !== undefined && move === castDaze.id) {
          dazeOid = optionSourceOid(castDaze.id);
          if (!canceled) {
            handBeforeCancel = (pilot.hand ?? []).map((card) => card.oid).sort();
            battlefieldBeforeCancel = pilot.battlefield.map((card) => card.oid).sort();
          }
        }
      } else if (decision.kind === 'target-selection') {
        move = decision.options.find((option) =>
          decision.seat === 0 ? option.targets[0]?.oid === boltOid : option.id === 'target-player-0',
        )?.id;
      } else if (decision.kind === 'cost-return-selection') {
        const cancel = decision.options.find((option) => option.id === 'cost-return-cancel');
        const candidates = decision.options.filter(
          (option) => option.id.startsWith('cost-return-') && option.id !== 'cost-return-cancel',
        );
        const expected = pilot.battlefield
          .filter((card) => card.name === 'Island')
          .map((card) => `cost-return-${card.oid.replace('forge-card-', '')}`)
          .sort();
        expect(candidates.map((option) => option.id).sort(), trace.slice(-100).join('\n')).toEqual(expected);
        expect(cancel, trace.slice(-100).join('\n')).toBeDefined();
        if (!unknownRejected) {
          await expect(session.submit('cost-return-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          unknownRejected = true;
        }
        if (!canceled) {
          session = await submitOrThrow(session, cancel!.id);
          expect((session.view.seats[0]!.hand ?? []).map((card) => card.oid).sort()).toEqual(
            handBeforeCancel,
          );
          expect(session.view.seats[0]!.battlefield.map((card) => card.oid).sort()).toEqual(
            battlefieldBeforeCancel,
          );
          expect(session.view.stack.map((object) => object.oid)).toEqual([boltOid]);
          canceled = true;
          dazeOid = undefined;
          continue;
        }
        const selected = candidates[0];
        if (selected === undefined) throw new Error('Forge offered no Island return candidate');
        returnedOid = `forge-card-${selected.id.replace('cost-return-', '')}`;
        const stale = session;
        session = await submitOrThrow(session, selected.id);
        if (!staleRejected) {
          await expect(stale.submit(selected.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
        continue;
      } else if (decision.kind === 'mana-payment') {
        // The payment prompt is Forge's generic mana text rather than the source
        // card name.  Bolt's own payment happens before dazeOid is assigned, so
        // this is the exact later payment decision created by Daze's UnlessCost.
        const isDazeTax = decision.seat === 1 && dazeOid !== undefined;
        move = decision.options.find((option) =>
          isDazeTax && route === 'decline'
            ? option.id === 'mana-payment-cancel'
            : option.id !== 'mana-payment-cancel',
        )?.id;
        if (isDazeTax && move !== undefined) taxAnswered = true;
      } else if (decision.kind === 'combat-attackers') {
        move = 'combat-attackers-commit';
      } else if (decision.kind === 'combat-blockers') {
        move = 'combat-blockers-commit';
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Daze move');
      session = await submitOrThrow(session, move);
    }
    const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(canceled, evidence).toBe(true);
    expect(unknownRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(taxAnswered, evidence).toBe(true);
    expect(outcome, evidence).toBe(true);
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-300).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

forgeIt(
  'returns the exact chosen Island for Daze, rolls cancellation back, and counters unpaid',
  async () => {
    await runDaze('decline');
  },
  200_000,
);

forgeIt(
  'lets the target controller pay Daze tax and resolve the exact targeted spell',
  async () => {
    await runDaze('pay');
  },
  200_000,
);

async function runOrdinaryCounterspell(card: FreeCounterspell): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  const requiredIslands = card === 'Daze' ? 2 : card === 'Force of Negation' ? 3 : 5;
  let boltOid: string | undefined;
  let counterOid: string | undefined;
  let lifeBefore = -1;
  let pilotExileBefore: string[] = [];
  let pilotLandsBefore: string[] = [];
  let ordinaryOffered = false;
  let manaSources = 0;
  let taxDeclined = card !== 'Daze';
  let outcome = false;
  try {
    const spec = table(card, `z5q4-${card.toLowerCase().replaceAll(' ', '-')}-ordinary`);
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
      trace.push(traceLine(session));
      const decision = session.decision;
      if (decision === null) throw new Error(`Forge offered no ordinary ${card} decision`);
      const pilot = session.view.seats[0];
      const target = session.view.seats[1];
      boltOid ??= session.view.stack.find((object) => object.name === 'Lightning Bolt')?.oid;
      if (
        counterOid !== undefined &&
        boltOid !== undefined &&
        session.view.stack.length === 0 &&
        pilot.graveyard.some((object) => object.oid === counterOid)
      ) {
        const boltReachedExpectedZone =
          card === 'Force of Negation'
            ? target.exile.some((object) => object.oid === boltOid)
            : target.graveyard.some((object) => object.oid === boltOid);
        outcome =
          boltReachedExpectedZone &&
          pilot.life === lifeBefore &&
          pilot.exile
            .map((object) => object.oid)
            .sort()
            .join(',') === pilotExileBefore.join(',') &&
          pilotLandsBefore.every((oid) =>
            pilot.battlefield.some((object) => object.oid === oid && object.name === 'Island'),
          );
      }

      let move = decision.options.find(
        (option) =>
          option.text === 'Play first' ||
          option.text === `Let ${card} pilot play first` ||
          option.text === 'Keep this hand',
      )?.id;
      if (decision.kind === 'mulligan') {
        const names = (session.view.seats[decision.seat]!.hand ?? []).map((object) => object.name);
        const ready =
          decision.seat === 0
            ? names.includes(card) && names.includes('Island')
            : names.includes('Lightning Bolt') && names.includes('Mountain');
        move = decision.options.find(
          (option) => option.id === (ready ? 'pregame-keep' : 'pregame-mulligan'),
        )?.id;
      } else if (decision.kind === 'priority') {
        const islands = pilot.battlefield.filter((object) => object.name === 'Island').length;
        const castBolt =
          decision.seat === 1 &&
          session.view.turn.active === 1 &&
          session.view.turn.step === 'MAIN1' &&
          boltOid === undefined &&
          islands >= requiredIslands &&
          target.battlefield.some((object) => object.name === 'Mountain' && !object.tapped)
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const ordinary =
          decision.seat === 0 && boltOid !== undefined && counterOid === undefined
            ? decision.options.find(
                (option) => option.text.startsWith(`${card}:`) && !option.text.endsWith('(alternative cost)'),
              )
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.id === 'concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Island')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          ordinary?.id ??
          castBolt?.id ??
          decision.options.find((option) => option.id === 'pass')?.id;
        if (ordinary !== undefined && move === ordinary.id) {
          ordinaryOffered = true;
          counterOid = optionSourceOid(ordinary.id);
          lifeBefore = pilot.life;
          pilotExileBefore = pilot.exile.map((object) => object.oid).sort();
          pilotLandsBefore = pilot.battlefield
            .filter((object) => object.name === 'Island')
            .map((object) => object.oid)
            .sort();
        }
      } else if (decision.kind === 'target-selection') {
        move = decision.options.find((option) =>
          decision.seat === 0 ? option.targets[0]?.oid === boltOid : option.id === 'target-player-0',
        )?.id;
      } else if (decision.kind === 'mana-payment') {
        const dazeTax = card === 'Daze' && counterOid !== undefined && decision.seat === 1;
        move = decision.options.find((option) =>
          dazeTax ? option.id === 'mana-payment-cancel' : option.id !== 'mana-payment-cancel',
        )?.id;
        if (dazeTax && move !== undefined) taxDeclined = true;
        if (!dazeTax && decision.seat === 0 && move !== undefined) manaSources += 1;
      } else if (decision.kind === 'combat-attackers') {
        move = 'combat-attackers-commit';
      } else if (decision.kind === 'combat-blockers') {
        move = 'combat-blockers-commit';
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error(`Forge offered no ordinary ${card} move`);
      session = await submitOrThrow(session, move);
    }
    const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(ordinaryOffered, evidence).toBe(true);
    expect(manaSources, evidence).toBe(requiredIslands);
    expect(taxDeclined, evidence).toBe(true);
    expect(outcome, evidence).toBe(true);
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-320).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

for (const card of ['Daze', 'Force of Negation', 'Force of Will'] as const) {
  forgeIt(
    `pays ${card}'s ordinary mana cost and preserves its alternate-cost resources`,
    async () => {
      await runOrdinaryCounterspell(card);
    },
    200_000,
  );
}
