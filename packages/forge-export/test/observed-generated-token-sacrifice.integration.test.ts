/** Installed-Forge outcomes for the exact generated-token sacrifice cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function table(
  name: string,
  cards: SessionSpec['seats'][0]['deck']['cards'],
  maximumTurns = 30,
): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: `${name} pilot`, controller: 'local', deck: { name: `z5q4-${name}`, cards } },
      {
        name: `${name} observer`,
        controller: 'engine',
        deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-${name}-installed-forge`,
    maximumTurns,
  };
}

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  if (decision.kind === 'scry-move') {
    return decision.options.find((option) => option.id === 'scry-move-done')?.id;
  }
  if (decision.kind === 'scry-keep') return decision.options[0]?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

function traceLine(session: ObservedSession, decision: ObservedDecision): string {
  return `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
}

forgeIt(
  'Koma creates exact Coils, exposes both exact modes, and sacrifices only an issued Coil identity',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let komaOid: string | undefined;
    let firstCoilOid: string | undefined;
    let canceled = false;
    let rollbackObserved = false;
    let inventedRejected = false;
    let staleRejected = false;
    let pumpSelected = false;
    let pendingMode: 'pump' | 'tap' | null = null;
    let dayOid: string | undefined;
    let dayCast = false;
    let pumpResolvedTurn: number | undefined;
    let indestructibleOutcome = false;
    let tapSelected = false;
    let tappedTargetOid: string | undefined;
    let tapOutcome = false;
    let activationCount = 0;
    try {
      const spec = table(
        'koma-generated-token-sacrifice',
        [
          { name: 'Mana Confluence', count: 36 },
          { name: 'Koma, Cosmos Serpent', count: 12 },
          { name: 'Day of Judgment', count: 12 },
        ],
        36,
      );
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Koma decision');
        const local = session.view.seats[0];
        if (local.hand === null) throw new Error('Forge hid the Koma pilot hand');
        const koma = local.battlefield.find((card) => card.name === 'Koma, Cosmos Serpent');
        const coils = local.battlefield.filter(
          (card) => card.name.includes("Koma's Coil") && card.typeLine.includes('Serpent'),
        );
        komaOid ??= koma?.oid;
        firstCoilOid ??= coils[0]?.oid;
        if (canceled && !rollbackObserved) {
          rollbackObserved =
            komaOid !== undefined &&
            firstCoilOid !== undefined &&
            local.battlefield.some((card) => card.oid === komaOid) &&
            local.battlefield.some((card) => card.oid === firstCoilOid) &&
            session.view.stack.length === 0;
        }
        if (
          pumpSelected &&
          pumpResolvedTurn === undefined &&
          komaOid !== undefined &&
          local.battlefield.some((card) => card.oid === komaOid) &&
          session.view.stack.length === 0
        ) {
          pumpResolvedTurn = session.view.turn.number;
        }
        if (
          dayCast &&
          dayOid !== undefined &&
          !local.hand.some((card) => card.oid === dayOid) &&
          komaOid !== undefined &&
          local.battlefield.some((card) => card.oid === komaOid) &&
          session.view.stack.length === 0
        ) {
          indestructibleOutcome = true;
        }
        tapOutcome ||=
          tapSelected &&
          tappedTargetOid !== undefined &&
          [...local.battlefield, ...session.view.seats[1].battlefield].some(
            (card) => card.oid === tappedTargetOid && card.tapped,
          ) &&
          session.view.stack.length === 0;
        trace.push(traceLine(session, decision));

        let move: string | undefined;
        if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length, trace.at(-1)).toBeGreaterThanOrEqual(1);
          expect(
            candidates.every((option) => option.targets[0]?.name.includes("Koma's Coil") === true),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!canceled) {
            move = decision.options.find((option) => option.id === 'cost-sacrifice-cancel')?.id;
            canceled = move !== undefined;
            if (canceled) pendingMode = null;
          } else {
            const selected = candidates[0];
            if (selected === undefined) throw new Error('Forge offered no exact Coil sacrifice');
            if (pendingMode === 'pump') pumpSelected = true;
            if (pendingMode === 'tap') tapSelected = true;
            pendingMode = null;
            const staleSession = session;
            const advanced = await session.submit(selected.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            if (!staleRejected) {
              await expect(staleSession.submit(selected.id)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
            }
            continue;
          }
        } else if (decision.kind === 'mode-selection') {
          expect(decision.options).toHaveLength(2);
          const wanted = indestructibleOutcome ? 'Tap target permanent' : 'gains indestructible';
          const mode = decision.options.find((option) => option.text.includes(wanted));
          if (mode === undefined) throw new Error(`Forge omitted Koma mode ${wanted}`);
          pendingMode = indestructibleOutcome ? 'tap' : 'pump';
          move = mode.id;
        } else if (decision.kind === 'target-selection' && pendingMode === 'tap') {
          const target = decision.options.find(
            (option) => option.targets[0]?.name === 'Mountain' && option.targets[0]?.oid !== undefined,
          );
          if (target === undefined) throw new Error('Forge offered no opposing permanent to tap');
          tappedTargetOid = target.targets[0]?.oid;
          move = target.id;
        } else if (decision.kind === 'priority') {
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const activate = decision.options.find(
            (option) => option.text.startsWith('Koma, Cosmos Serpent:') && option.text.includes('Choose one'),
          );
          const castDay = decision.options.find((option) => option.text.startsWith('Day of Judgment:'));
          move =
            (tapOutcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ??
            (koma === undefined && lands >= 7
              ? decision.options.find((option) => option.text.startsWith('Koma, Cosmos Serpent:'))?.id
              : undefined) ??
            (koma !== undefined &&
            coils.length > 0 &&
            !pumpSelected &&
            (!canceled || session.view.turn.active === 0)
              ? activate?.id
              : undefined) ??
            (pumpResolvedTurn === session.view.turn.number && !dayCast ? castDay?.id : undefined) ??
            (indestructibleOutcome && coils.length > 0 && !tapSelected ? activate?.id : undefined);
          if (activate !== undefined && move === activate.id) activationCount += 1;
          if (castDay !== undefined && move === castDay.id) {
            const cardNumber = /^ability-(\d+)-/u.exec(castDay.id)?.[1];
            if (cardNumber === undefined) throw new Error('Forge issued an unbound Day of Judgment ability');
            dayOid = `forge-card-${cardNumber}`;
            dayCast = true;
          }
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Koma move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `pumpResolvedTurn=${String(pumpResolvedTurn)} dayCast=${String(dayCast)} dayOid=${String(dayOid)} indestructible=${String(indestructibleOutcome)}\n${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(komaOid, evidence).toMatch(/^forge-card-/u);
      expect(firstCoilOid, evidence).toMatch(/^forge-card-/u);
      expect(activationCount, evidence).toBeGreaterThanOrEqual(3);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(pumpSelected, evidence).toBe(true);
      expect(pumpResolvedTurn, evidence).toBeTypeOf('number');
      expect(dayCast, evidence).toBe(true);
      expect(indestructibleOutcome, evidence).toBe(true);
      expect(tapSelected, evidence).toBe(true);
      expect(tapOutcome, evidence).toBe(true);
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
  420_000,
);

forgeIt(
  'Retrofitter Foundry rolls a paid sacrifice back and creates the exact Servo-to-Construct chain',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let foundryOid: string | undefined;
    let servoOid: string | undefined;
    let thopterOid: string | undefined;
    let constructOid: string | undefined;
    let canceled = false;
    let rollbackObserved = false;
    let inventedRejected = false;
    let staleRejected = false;
    let selectedStage: 'servo' | 'thopter' | null = null;
    try {
      const spec = table('retrofitter-foundry-chain', [
        { name: 'Mana Confluence', count: 45 },
        { name: 'Retrofitter Foundry', count: 15 },
      ]);
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Foundry decision');
        const local = session.view.seats[0];
        const foundry = local.battlefield.find((card) => card.name === 'Retrofitter Foundry');
        const servo = local.battlefield.find((card) => card.name.includes('Servo'));
        const thopter = local.battlefield.find((card) => card.name.includes('Thopter'));
        const construct = local.battlefield.find((card) => card.name.includes('Construct'));
        foundryOid ??= foundry?.oid;
        servoOid ??= servo?.oid;
        thopterOid ??= thopter?.oid;
        constructOid ??= construct?.oid;
        if (canceled && selectedStage === null && !rollbackObserved) {
          rollbackObserved =
            foundryOid !== undefined &&
            servoOid !== undefined &&
            local.battlefield.some((card) => card.oid === foundryOid && !card.tapped) &&
            local.battlefield.some((card) => card.oid === servoOid) &&
            session.view.stack.length === 0;
        }
        const complete =
          constructOid !== undefined &&
          construct?.power === 4 &&
          construct.toughness === 4 &&
          construct.typeLine.includes('Artifact Creature') &&
          servoOid !== undefined &&
          thopterOid !== undefined &&
          !local.battlefield.some((card) => card.oid === servoOid || card.oid === thopterOid) &&
          session.view.stack.length === 0;
        trace.push(traceLine(session, decision));

        let move: string | undefined;
        if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates).toHaveLength(1);
          const selected = candidates[0];
          if (selected === undefined) throw new Error('Forge offered no Foundry sacrifice');
          if (!inventedRejected) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!canceled) {
            expect(selected.targets[0]).toMatchObject({ oid: servoOid });
            move = decision.options.find((option) => option.id === 'cost-sacrifice-cancel')?.id;
            canceled = move !== undefined;
          } else {
            selectedStage = selected.targets[0]?.oid === servoOid ? 'servo' : 'thopter';
            const staleSession = session;
            const advanced = await session.submit(selected.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            if (!staleRejected) {
              await expect(staleSession.submit(selected.id)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
            }
            continue;
          }
        } else if (decision.kind === 'priority') {
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const untappedLands = local.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const createServo = decision.options.find(
            (option) => option.text.startsWith('Retrofitter Foundry:') && option.text.includes('Servo'),
          );
          const createThopter = decision.options.find(
            (option) => option.text.startsWith('Retrofitter Foundry:') && option.text.includes('Thopter'),
          );
          const createConstruct = decision.options.find(
            (option) => option.text.startsWith('Retrofitter Foundry:') && option.text.includes('Construct'),
          );
          if (selectedStage === 'servo' && thopterOid !== undefined && session.view.stack.length === 0) {
            selectedStage = null;
          }
          if (selectedStage === 'thopter' && constructOid !== undefined && session.view.stack.length === 0) {
            selectedStage = null;
          }
          move =
            (complete ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ??
            (foundry === undefined && lands >= 1
              ? decision.options.find((option) => option.text.startsWith('Retrofitter Foundry:'))?.id
              : undefined) ??
            (foundry !== undefined && servoOid === undefined && untappedLands >= 2
              ? createServo?.id
              : undefined) ??
            (servoOid !== undefined && thopterOid === undefined && selectedStage === null
              ? createThopter?.id
              : undefined) ??
            (thopterOid !== undefined && constructOid === undefined && selectedStage === null
              ? createConstruct?.id
              : undefined);
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Foundry move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(foundryOid, evidence).toMatch(/^forge-card-/u);
      expect(servoOid, evidence).toMatch(/^forge-card-/u);
      expect(thopterOid, evidence).toMatch(/^forge-card-/u);
      expect(constructOid, evidence).toMatch(/^forge-card-/u);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
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
  420_000,
);

forgeIt(
  'Treasure Map scries three times, transforms in place, creates three Treasures, and draws for one',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let mapOid: string | undefined;
    let peakLandmarks = 0;
    let scries = 0;
    let transformed = false;
    let treasureOids: readonly string[] = [];
    let canceled = false;
    let rollbackObserved = false;
    let inventedRejected = false;
    let staleRejected = false;
    let selectedTreasureOid: string | undefined;
    let handBeforeDraw: number | undefined;
    let drawOutcome = false;
    let drawStarted = false;
    try {
      const spec = table('treasure-map-transform-draw', [
        { name: 'Mana Confluence', count: 45 },
        { name: 'Treasure Map', count: 15 },
      ]);
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Treasure Map decision');
        const local = session.view.seats[0];
        const map = local.battlefield.find(
          (card) => card.name === 'Treasure Map' || card.name === 'Treasure Cove',
        );
        mapOid ??= map?.oid;
        peakLandmarks = Math.max(peakLandmarks, map?.counters['LANDMARK'] ?? 0);
        transformed ||=
          mapOid !== undefined &&
          local.battlefield.some((card) => card.oid === mapOid && card.name === 'Treasure Cove');
        const treasures = local.battlefield.filter(
          (card) =>
            card.name.includes('Treasure') && card.oid !== mapOid && card.typeLine.includes('Artifact'),
        );
        if (treasureOids.length === 0 && treasures.length === 3)
          treasureOids = treasures.map((card) => card.oid);
        if (canceled && !rollbackObserved) {
          rollbackObserved =
            mapOid !== undefined &&
            local.battlefield.some((card) => card.oid === mapOid && !card.tapped) &&
            treasureOids.every((oid) => local.battlefield.some((card) => card.oid === oid)) &&
            session.view.stack.length === 0;
        }
        drawOutcome ||=
          selectedTreasureOid !== undefined &&
          handBeforeDraw !== undefined &&
          local.handSize === handBeforeDraw + 1 &&
          !local.battlefield.some((card) => card.oid === selectedTreasureOid) &&
          local.battlefield.filter((card) => treasureOids.includes(card.oid)).length === 2 &&
          session.view.stack.length === 0;
        trace.push(traceLine(session, decision));

        let move: string | undefined;
        if (decision.kind === 'scry-move') {
          expect(decision.options.map((option) => option.id)).toContain('scry-move-done');
          move = decision.options.find((option) => option.id === 'scry-move-done')?.id;
          scries += 1;
        } else if (decision.kind === 'scry-keep') {
          expect(decision.options).toHaveLength(1);
          move = decision.options[0]?.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates).toHaveLength(3);
          expect(
            candidates.every((option) => treasureOids.includes(option.targets[0]?.oid ?? '')),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!canceled) {
            move = decision.options.find((option) => option.id === 'cost-sacrifice-cancel')?.id;
            canceled = move !== undefined;
          } else {
            const selected = candidates[0];
            if (selected === undefined) throw new Error('Forge offered no Treasure sacrifice');
            selectedTreasureOid = selected.targets[0]?.oid;
            const staleSession = session;
            const advanced = await session.submit(selected.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            if (!staleRejected) {
              await expect(staleSession.submit(selected.id)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
            }
            continue;
          }
        } else if (decision.kind === 'priority') {
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const untappedLands = local.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const scry = decision.options.find(
            (option) => option.text.startsWith('Treasure Map:') && option.text.includes('Scry 1'),
          );
          const draw = decision.options.find(
            (option) => option.text.startsWith('Treasure Cove:') && option.text.includes('Draw a card'),
          );
          move =
            (drawOutcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ??
            (map === undefined && lands >= 2
              ? decision.options.find((option) => option.text.startsWith('Treasure Map:'))?.id
              : undefined) ??
            (!transformed && map !== undefined && !map.tapped && untappedLands >= 1 && scries < 3
              ? scry?.id
              : undefined) ??
            (transformed && !drawOutcome && !drawStarted && !map?.tapped ? draw?.id : undefined) ??
            (transformed && canceled && !drawOutcome && !map?.tapped ? draw?.id : undefined);
          if (draw !== undefined && move === draw.id) {
            handBeforeDraw = local.handSize;
            drawStarted = true;
          }
          if (canceled && session.view.stack.length === 0) drawStarted = false;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Treasure Map move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(mapOid, evidence).toMatch(/^forge-card-/u);
      expect(peakLandmarks, evidence).toBeGreaterThanOrEqual(2);
      expect(scries, evidence).toBe(3);
      expect(transformed, evidence).toBe(true);
      expect(treasureOids, evidence).toHaveLength(3);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(selectedTreasureOid, evidence).toMatch(/^forge-card-/u);
      expect(drawOutcome, evidence).toBe(true);
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
  420_000,
);
